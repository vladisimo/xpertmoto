import { prisma } from "@/lib/prisma";
import { gstFromInclusive, roundCents } from "@/lib/money";
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
  /** 1B input-tax credit on Stripe processing fees (GST-inclusive in AU). */
  gstOnStripeFees: number;
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
      // Half-open window [from, to): quarterBoundaries hands the NEXT
      // period's first instant as `to`, so an inclusive upper bound counted
      // a payment landing exactly on the boundary in BOTH quarters.
      processedAt: { gte: args.from, lt: args.to },
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

  const addToDepot = (
    booking: { depotId: string | null; depot: { name: string } | null } | null,
    revenueDelta: number,
    gstDelta: number,
  ) => {
    const depotId = booking?.depotId ?? UNASSIGNED_DEPOT_ID;
    const name = booking?.depot?.name ?? "Unassigned";
    const bucket = depots.get(depotId) ?? { name, revenue: 0, gst: 0 };
    bucket.revenue += revenueDelta;
    bucket.gst += gstDelta;
    depots.set(depotId, bucket);
  };

  for (const p of payments) {
    const w = paymentNetWeight(p.type);
    if (w === 0) continue; // bond holds/releases are authorisations, not cash
    // Gift cards get bespoke Div-100 voucher treatment below: the PURCHASE
    // is not a supply (cash in, but out of G1 until redeemed) and the
    // REDEMPTION row is a negative internal transfer whose face value would
    // otherwise corrupt G1 downward.
    if (p.type === "GIFT_CARD_PURCHASE" || p.type === "GIFT_CARD_REDEMPTION") continue;
    const amount = Number(p.amount);
    const gst = Number(p.gstAmount);

    totalRevenueInc += w * amount;
    if (w === 1) gstCollected += gst;
    else gstOnRefunds += gst;

    addToDepot(p.booking, w * amount, w * gst);
  }

  // Div 100 vouchers: GST attaches when the voucher is REDEEMED against a
  // supply, regardless of when the cash came in. Each redemption's face
  // value enters G1 as a sale with its GST share in 1A — this is the slice
  // of the booking no card payment ever carried.
  const redemptions = await prisma.payment.findMany({
    where: {
      type: "GIFT_CARD_REDEMPTION",
      status: "SUCCEEDED",
      processedAt: { gte: args.from, lt: args.to },
      deletedAt: null,
      ...(args.depotId ? { booking: { depotId: args.depotId } } : {}),
    },
    select: {
      amount: true,
      booking: { select: { depotId: true, depot: { select: { name: true } } } },
    },
  });
  for (const r of redemptions) {
    const face = Math.abs(Number(r.amount));
    const gst = gstFromInclusive(face).toNumber();
    totalRevenueInc += face;
    gstCollected += gst;
    addToDepot(r.booking, face, gst);
  }

  // 1B input-tax credit: Stripe's AU processing fees are GST-inclusive.
  // Windowed on the balance transaction date (when the fee was levied).
  const feeAgg = await prisma.stripeFeeLedger.aggregate({
    where: { balanceTxnCreatedAt: { gte: args.from, lt: args.to } },
    _sum: { feeAmountCents: true },
  });
  const gstOnStripeFees = roundCents(
    gstFromInclusive((feeAgg._sum.feeAmountCents ?? 0) / 100),
  ).toNumber();

  const netGst = roundCents(gstCollected - gstOnRefunds).toNumber();
  const totalInc = roundCents(totalRevenueInc).toNumber();

  return {
    totalRevenueInc: totalInc,
    totalRevenueEx: roundCents(totalInc - netGst).toNumber(),
    gstCollected: roundCents(gstCollected).toNumber(),
    gstOnRefunds: roundCents(gstOnRefunds).toNumber(),
    netGst,
    gstOnStripeFees,
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
    // Stripe processing-fee input credits; other purchases remain manual.
    summary.gstOnStripeFees.toFixed(2),
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
  // `to` is the NEXT quarter's first instant — computeGstSummary applies it
  // as a half-open `lt` bound, so boundary-instant payments land in exactly
  // one quarter.
  const to = new Date(Date.UTC(year, startMonth + 3, 1));
  return { from, to, label: `${year}-Q${quarter}` };
}
