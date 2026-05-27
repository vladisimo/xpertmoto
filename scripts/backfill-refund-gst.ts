/**
 * One-shot backfill: set the missing GST credit on historical REFUND Payment
 * rows that were written with gstAmount = 0.
 *
 * Why: two refund paths (booking-settlement.refund and the cancellation
 * service) used to hardcode gstAmount: 0 on the REFUND row. Because the
 * GST/BAS export nets refund GST out of GST collected
 * (src/server/services/gst-bas-export.ts), those zero-GST refunds overstated
 * the reported GST liability. The creation paths are now fixed; this script
 * corrects the history so BAS reconciles.
 *
 * How GST is recomputed per refund:
 *   - parentPaymentId set  → proportional to the source charge's GST:
 *                            parent.gstAmount × (refund.amount / parent.amount)
 *   - no parent (cancellation refund) → gstFromInclusive(refund.amount),
 *                            i.e. the GST-inclusive booking refund / 11.
 *
 * Idempotent + safe: only touches REFUND rows whose gstAmount is currently 0,
 * and only when the recomputed credit is > 0 (so a genuinely GST-free refund —
 * e.g. reversing a GST-free charge — is left at 0). Re-running is a no-op.
 *
 * Usage:
 *   npx tsx scripts/backfill-refund-gst.ts          # dry-run
 *   npx tsx scripts/backfill-refund-gst.ts --apply  # actually write
 */
import { PrismaClient } from "@prisma/client";

import { aud, gstFromInclusive, roundCents, times } from "@/lib/money";

const prisma = new PrismaClient();

async function main() {
  const apply = process.argv.includes("--apply");

  const refunds = await prisma.payment.findMany({
    where: { type: "REFUND", gstAmount: 0, deletedAt: null },
    select: {
      id: true,
      reference: true,
      amount: true,
      parentPaymentId: true,
      parentPayment: { select: { amount: true, gstAmount: true } },
    },
  });

  console.log(`Found ${refunds.length} REFUND rows with gstAmount = 0`);

  let updated = 0;
  let skippedZero = 0;
  let errors = 0;

  for (const r of refunds) {
    try {
      const refundAmount = Number(r.amount);
      let gst = aud(0);
      if (r.parentPayment && Number(r.parentPayment.amount) > 0) {
        // Proportional to the slice of the source charge being reversed.
        gst = roundCents(
          times(aud(r.parentPayment.gstAmount), refundAmount / Number(r.parentPayment.amount)),
        );
      } else {
        // Cancellation refund of GST-inclusive booking money (10%).
        gst = gstFromInclusive(refundAmount);
      }

      if (gst.lessThanOrEqualTo(0)) {
        skippedZero++;
        continue;
      }

      if (!apply) {
        console.log(
          `[dry-run] ${r.reference}: amount=${refundAmount.toFixed(2)} → gst ${gst.toFixed(2)} (${r.parentPaymentId ? "proportional" : "gstFromInclusive"})`,
        );
        updated++;
        continue;
      }

      await prisma.payment.update({
        where: { id: r.id },
        data: { gstAmount: gst },
      });
      updated++;
      console.log(`${r.reference}: gstAmount set to ${gst.toFixed(2)}`);
    } catch (err) {
      errors++;
      console.error(`error processing refund ${r.id} (${r.reference}):`, err);
    }
  }

  console.log(
    `\n${apply ? "Backfill complete" : "Dry-run complete"} — ${updated} ${apply ? "updated" : "would update"}, ${skippedZero} left at 0 (GST-free), ${errors} errors`,
  );
  if (!apply) {
    console.log("\nRe-run with --apply to actually write the GST credits.");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
