/**
 * One-shot backfill: create the missing INFRINGEMENT_RECOVERY Payment +
 * AdjustmentNote + balanceDue update for every Infringement that was
 * marked CUSTOMER_CHARGED before the helper landed (April 2026).
 *
 * Why: prior to the helper, the e-toll auto-sync set Infringement.status
 * to CUSTOMER_CHARGED without creating the corresponding Payment row,
 * so the staff Payments console + customer portal never saw the
 * outstanding amount. This script fixes that retroactively.
 *
 * Idempotent: skips any Infringement that already has an INFR-${ref}
 * Payment row, regardless of payment status.
 *
 * Usage:
 *   npx tsx scripts/backfill-infringement-recovery-payments.ts          # dry-run
 *   npx tsx scripts/backfill-infringement-recovery-payments.ts --apply  # actually write
 */
import { PrismaClient } from "@prisma/client";

import { applyInfringementRecoveryCharge } from "@/server/services/infringement-charge";

const prisma = new PrismaClient();

async function main() {
  const apply = process.argv.includes("--apply");

  const candidates = await prisma.infringement.findMany({
    where: {
      status: "CUSTOMER_CHARGED",
      customerId: { not: null },
      deletedAt: null,
    },
    select: {
      id: true,
      referenceNumber: true,
      type: true,
      issuer: true,
      amount: true,
      adminFee: true,
      bookingId: true,
      customerId: true,
    },
  });

  console.log(`Found ${candidates.length} CUSTOMER_CHARGED infringements`);

  let createdCount = 0;
  let alreadyChargedCount = 0;
  let errors = 0;

  for (const inf of candidates) {
    const reference = `INFR-${inf.referenceNumber}`;
    const existing = await prisma.payment.findUnique({
      where: { reference },
      select: { id: true, status: true },
    });
    if (existing) {
      alreadyChargedCount++;
      continue;
    }

    if (!apply) {
      console.log(
        `[dry-run] would create Payment ${reference} for inf ${inf.id} (booking=${inf.bookingId ?? "—"}, amount=${Number(inf.amount) + Number(inf.adminFee)})`,
      );
      createdCount++;
      continue;
    }

    try {
      const result = await applyInfringementRecoveryCharge({
        prisma,
        infringement: {
          id: inf.id,
          referenceNumber: inf.referenceNumber,
          type: inf.type,
          issuer: inf.issuer,
          amount: inf.amount,
          adminFee: inf.adminFee,
          bookingId: inf.bookingId,
          customerId: inf.customerId,
        },
      });
      if (result.alreadyExisted) {
        alreadyChargedCount++;
      } else {
        createdCount++;
        console.log(
          `created Payment ${reference} → ${result.paymentId} (amount=${result.amount})`,
        );
      }
    } catch (err) {
      errors++;
      console.error(`error processing inf ${inf.id} (${reference}):`, err);
    }
  }

  console.log(
    `\n${apply ? "Backfill complete" : "Dry-run complete"} — ${createdCount} created, ${alreadyChargedCount} already had payments, ${errors} errors`,
  );
  if (!apply) {
    console.log("\nRe-run with --apply to actually write the Payments.");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
