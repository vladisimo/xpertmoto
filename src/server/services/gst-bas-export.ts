import { prisma } from "@/lib/prisma";
import { roundCents } from "@/lib/money";
import { paymentNetWeight } from "@/lib/payment-labels";

/**
 * The settled-cash payment statuses: an original charge that has since been
 * partially or fully refunded still represents money that settled on Stripe —
 * its GST belongs in "collected", and the matching REFUND row (weighted -1)
 * nets the reversal back out. Same basis as the reconciliation service and the
 * Invoices view. (Filtering `SUCCEEDED` only would silently drop GST on any
 * charge once it had been refunded.)
 */
const SETTLED_PAYMENT_STATUSES = ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED"] as const;

export interface GstSummaryDepot {
  depotId: string;
  depotName: string;
  /** Net revenue incl. GST attributed to this depot. */
  revenue: number;
  /** Net GST for this depot (collected − refunded). */
  gst: number;
}

export interface GstSummary {
  /** Net cash collected incl. GST (inflows − refunds/credits). */
  totalRevenueInc: number;
  /** totalRevenueInc − netGst. */
  totalRevenueEx: number;
  /** GST on inflows. */
  gstCollected: number;
  /** GST returned to the ATO on refunds/credits (positive magnitude). */
  gstOnRefunds: number;
  /** gstCollected − gstOnRefunds — the amount to lodge on the BAS. */
  netGst: number;
  byDepot: GstSummaryDepot[];
}

const UNASSIGNED_DEPOT_ID = "__unassigned__";

/**
 * Single source of truth for GST/BAS figures, on a payment-ledger cash basis.
 *
 * Sums stored `Payment.gstAmount` weighted by `paymentNetWeight` (inflows +1,
 * refunds/credits/payouts -1, bond authorisations 0) over settled payments in
 * the window, grouped by the booking's depot. Replaces the old booking-invoice
 * aggregation that double-counted unpaid bookings as revenue while netting
 * refunds straight off the Payment table (an asymmetry that produced $0
 * revenue but a non-zero refund GST).
 *
 * Window is keyed on `processedAt` (when money actually moved), so PENDING
 * refunds — which have no `processedAt` — are naturally excluded.
 */
export async function computeGstSummary(args: {
  from: Date;
  to: Date;
  depotId?: string;
}): Promise<GstSummary> {
  const payments = await prisma.payment.findMany({
    where: {
      status: { in: SETTLED_PAYMENT_STATUSES as unknown as string[] } as never,
      processedAt: { gte: args.from, lte: args.to },
      deletedAt: null,
      ...(args.depotId ? { booking: { depotId: args.depotId } } : {}),
    },
    select: {
      type: true,
      amount: true,
      gstAmount: true,
      booking: { select: { depotId: true, depot: { select: { name: true } } } },
    },
  });

  let gstCollected = 0;
  let gstOnRefunds = 0;
  let totalRevenueInc = 0;
  const depots = new Map<string, { name: string; revenue: number; gst: number }>();

  for (const p of payments) {
    const w = paymentNetWeight(p.type);
    if (w === 0) continue; // bond holds/releases are authorisations, not cash
    const amount = Number(p.amount);
    const gst = Number(p.gstAmount);

    totalRevenueInc += w * amount;
    if (w === 1) gstCollected += gst;
    else gstOnRefunds += gst;

    const depotId = p.booking?.depotId ?? UNASSIGNED_DEPOT_ID;
    const name = p.booking?.depot?.name ?? "Unassigned";
    const bucket = depots.get(depotId) ?? { name, revenue: 0, gst: 0 };
    bucket.revenue += w * amount;
    bucket.gst += w * gst;
    depots.set(depotId, bucket);
  }

  const netGst = roundCents(gstCollected - gstOnRefunds).toNumber();
  const totalInc = roundCents(totalRevenueInc).toNumber();

  return {
    totalRevenueInc: totalInc,
    totalRevenueEx: roundCents(totalInc - netGst).toNumber(),
    gstCollected: roundCents(gstCollected).toNumber(),
    gstOnRefunds: roundCents(gstOnRefunds).toNumber(),
    netGst,
    byDepot: [...depots.entries()].map(([depotId, d]) => ({
      depotId,
      depotName: d.name,
      revenue: roundCents(d.revenue).toNumber(),
      gst: roundCents(d.gst).toNumber(),
    })),
  };
}

/**
 * BAS (Business Activity Statement) quarterly GST export for the ATO.
 *
 * Returns CSV text matching the standard columns needed for a
 * GST-cash-basis Simpler BAS lodgement:
 *   - Period (YYYY-QN or YYYY-MM for monthly)
 *   - G1  Total sales (including GST)
 *   - G2  Export sales (always 0 — we're AU-only)
 *   - G3  Other GST-free sales
 *   - G10 Capital purchases
 *   - G11 Non-capital purchases (not tracked here — manual entry)
 *   - 1A  GST on sales (our GST collected)
 *   - 1B  GST on purchases (not tracked here)
 *   - 7   Tax withheld (not applicable)
 *
 * XPERT Moto only computes 1A (GST collected on rental revenue) and
 * feeds it into Xero / MYOB alongside manually entered 1B expense data.
 */
export async function generateBasCsv(args: {
  from: Date;
  to: Date;
  periodLabel: string;
}): Promise<string> {
  // Net revenue and GST come from the shared payment-ledger computation
  // (computeGstSummary): every cash inflow's gstAmount counts as collected,
  // every refund/credit nets back out, bond authorisations are excluded.
  const summary = await computeGstSummary({ from: args.from, to: args.to });
  const g1Total = summary.totalRevenueInc;
  const gstCollected = summary.netGst;

  const header = [
    "Period",
    "G1 Total sales (incl. GST)",
    "G2 Export sales",
    "G3 Other GST-free sales",
    "G10 Capital purchases",
    "1A GST on sales",
    "1B GST on purchases",
    "7 Tax withheld",
  ];
  const row = [
    args.periodLabel,
    g1Total.toFixed(2),
    "0.00",
    "0.00",
    "0.00", // manual entry — not tracked here
    gstCollected.toFixed(2),
    "0.00", // manual entry — not tracked here
    "0.00",
  ];
  return [header.join(","), row.join(",")].join("\n") + "\n";
}

/**
 * Convenience: compute the calendar quarter start/end (AEST/AEDT boundary
 * irrelevant for BAS — periods are calendar-based).
 */
export function quarterBoundaries(year: number, quarter: 1 | 2 | 3 | 4): {
  from: Date;
  to: Date;
  label: string;
} {
  const startMonth = (quarter - 1) * 3;
  const from = new Date(Date.UTC(year, startMonth, 1));
  const to = new Date(Date.UTC(year, startMonth + 3, 1));
  return { from, to, label: `${year}-Q${quarter}` };
}
