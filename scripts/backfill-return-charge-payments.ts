/**
 * One-shot backfill: create the missing PENDING Payment rows for a
 * specific booking whose return assessment was signed before
 * return.finalise learned to materialise them.
 *
 * For the named booking, this will:
 *   - create one Payment{type:DAMAGE_CHARGE, status:PENDING} per STANDARD
 *     damage charge with amount > 0 that has no capturedPaymentId yet,
 *     and link it back via DamageCharge.capturedPaymentId
 *   - create one Payment{type:LATE_FEE, status:PENDING} if the assessment
 *     stamped a positive lateFeeAmount and no LATE-<assessmentId> row exists
 *   - create one Payment{type:FUEL_CHARGE, status:PENDING} if the
 *     assessment stamped a positive fuelChargeAmount and no
 *     FUEL-<assessmentId> row exists
 *
 * Idempotent — references are deterministic (`DMG-<chargeId>`,
 * `LATE-<assessmentId>`, `FUEL-<assessmentId>`) and the script skips any
 * row that already exists.
 *
 * Usage:
 *   npx tsx scripts/backfill-return-charge-payments.ts SCT-20260428-5885          # dry-run
 *   npx tsx scripts/backfill-return-charge-payments.ts SCT-20260428-5885 --apply  # actually write
 */
import { PrismaClient } from "@prisma/client";
import { gstFromInclusive } from "@/lib/money";

const prisma = new PrismaClient();

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const ref = args.find((a) => !a.startsWith("--"));
  if (!ref) {
    console.error("usage: backfill-return-charge-payments.ts <bookingReference> [--apply]");
    process.exit(1);
  }

  const booking = await prisma.booking.findUnique({
    where: { bookingReference: ref },
    include: {
      returnAssessments: {
        where: { status: { in: ["SIGNED", "FINALISED"] } },
        orderBy: { version: "desc" },
        take: 1,
        include: { damageCharges: true },
      },
    },
  });

  if (!booking) {
    console.error(`booking ${ref} not found`);
    process.exit(1);
  }
  const assessment = booking.returnAssessments[0];
  if (!assessment) {
    console.error(`booking ${ref} has no SIGNED/FINALISED return assessment`);
    process.exit(1);
  }

  console.log(`booking ${booking.bookingReference} (${booking.id})`);
  console.log(`assessment ${assessment.assessmentNumber} status=${assessment.status}`);
  console.log(
    `  damageCharges=${assessment.damageCharges.length} ` +
      `lateFee=$${Number(assessment.lateFeeAmount).toFixed(2)} ` +
      `fuelCharge=$${Number(assessment.fuelChargeAmount).toFixed(2)} ` +
      `cleaningFee=$${Number(booking.cleaningFee ?? 0).toFixed(2)} ` +
      `customerTotalDueNow=$${Number(assessment.customerTotalDueNow).toFixed(2)}`,
  );

  const plan: Array<{ kind: string; reference: string; amount: number; chargeId?: string }> = [];

  for (const c of assessment.damageCharges.filter((x) => x.resolution === "STANDARD")) {
    const amount = Number(c.amount);
    if (amount <= 0) continue;
    const reference = `DMG-${c.id}`;
    if (c.capturedPaymentId) {
      console.log(`  skip ${reference}: already linked to payment ${c.capturedPaymentId}`);
      continue;
    }
    const existing = await prisma.payment.findUnique({ where: { reference } });
    if (existing) {
      console.log(`  skip ${reference}: payment row already exists (${existing.id})`);
      continue;
    }
    plan.push({ kind: "DAMAGE_CHARGE", reference, amount, chargeId: c.id });
  }

  const lateFee = Number(assessment.lateFeeAmount);
  if (lateFee > 0) {
    const reference = `LATE-${assessment.id}`;
    const existing = await prisma.payment.findUnique({ where: { reference } });
    if (existing) {
      console.log(`  skip ${reference}: payment row already exists (${existing.id})`);
    } else {
      plan.push({ kind: "LATE_FEE", reference, amount: lateFee });
    }
  }

  const fuelCharge = Number(assessment.fuelChargeAmount);
  if (fuelCharge > 0) {
    const reference = `FUEL-${assessment.id}`;
    const existing = await prisma.payment.findUnique({ where: { reference } });
    if (existing) {
      console.log(`  skip ${reference}: payment row already exists (${existing.id})`);
    } else {
      plan.push({ kind: "FUEL_CHARGE", reference, amount: fuelCharge });
    }
  }

  if (plan.length === 0) {
    console.log("nothing to backfill — every charge is already represented by a Payment row.");
    return;
  }

  console.log(`\nplan: ${apply ? "APPLY" : "DRY-RUN"} — ${plan.length} new Payment row(s):`);
  for (const p of plan) {
    console.log(`  ${p.kind.padEnd(14)} ${p.reference}  $${p.amount.toFixed(2)}`);
  }
  const total = plan.reduce((acc, p) => acc + p.amount, 0);
  console.log(`  total $${total.toFixed(2)}\n`);

  if (!apply) {
    console.log("dry-run — re-run with --apply to write.");
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const p of plan) {
      const payment = await tx.payment.create({
        data: {
          reference: p.reference,
          customerId: booking.customerId,
          bookingId: booking.id,
          type: p.kind as "DAMAGE_CHARGE" | "LATE_FEE" | "FUEL_CHARGE",
          method: "STRIPE",
          amount: p.amount,
          gstAmount: gstFromInclusive(p.amount),
          status: "PENDING",
          notes:
            p.kind === "DAMAGE_CHARGE"
              ? `Backfill — DamageCharge ${p.chargeId} on booking ${booking.bookingReference}`
              : p.kind === "LATE_FEE"
                ? `Backfill — late return fee on ${booking.bookingReference}`
                : `Backfill — refuel charge on ${booking.bookingReference}`,
        },
      });
      if (p.chargeId) {
        await tx.damageCharge.update({
          where: { id: p.chargeId },
          data: { capturedPaymentId: payment.id },
        });
      }
      console.log(`  created Payment ${payment.id} (${payment.reference})`);
    }
  });
  console.log("\ndone. capture-pending-payments job will pick these up on its next tick.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
