import { prisma } from "@/lib/prisma";

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
  // Sum gstAmount on SUCCEEDED BOOKING_PAYMENT + EXTENSION + ADDON_CHARGE
  // + MANUAL_CHARGE + LATE_FEE + FUEL_CHARGE + DAMAGE_CHARGE rows. REFUND
  // rows net against — we use the negative of their gstAmount (refunds
  // return tax collected to the ATO).
  const salesRows = await prisma.payment.aggregate({
    where: {
      status: "SUCCEEDED",
      processedAt: { gte: args.from, lt: args.to },
      type: {
        in: [
          "BOOKING_PAYMENT",
          "EXTENSION",
          "ADDON_CHARGE",
          "MANUAL_CHARGE",
          "LATE_FEE",
          "FUEL_CHARGE",
          "DAMAGE_CHARGE",
          "CLEANING_FEE",
        ],
      },
    },
    _sum: { amount: true, gstAmount: true },
  });
  const refundRows = await prisma.payment.aggregate({
    where: {
      status: { in: ["SUCCEEDED", "REFUNDED"] },
      processedAt: { gte: args.from, lt: args.to },
      type: "REFUND",
    },
    _sum: { amount: true, gstAmount: true },
  });

  const g1Total = Number(salesRows._sum.amount ?? 0) - Number(refundRows._sum.amount ?? 0);
  const gstCollected =
    Number(salesRows._sum.gstAmount ?? 0) - Number(refundRows._sum.gstAmount ?? 0);

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
