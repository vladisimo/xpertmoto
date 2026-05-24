/**
 * Read-only diagnostic: size the blast radius of the "captured ancillary
 * charge never decrements Booking.balanceDue" bug.
 *
 * Background
 * ----------
 * balanceDue is a stored running counter, not a value derived from the
 * payment ledger. The initial BOOKING_PAYMENT (captured up front) is
 * *excluded* from balanceDue by construction — at confirmation the balance
 * is set to `totalAmount - payOnline` (booking.ts). Ancillary charges
 * (EXTENSION / MANUAL_CHARGE / LATE_FEE / FUEL_CHARGE / DAMAGE_CHARGE /
 * INFRINGEMENT_RECOVERY / SWAP_ADJUSTMENT / SUBSCRIPTION_CHARGE / …) work
 * the opposite way: they are *added* to balanceDue when raised (status
 * PENDING), but NONE of the three capture paths — the capture-pending job,
 * bookingSettlement.captureNow, or the Stripe payment_intent.succeeded
 * webhook — decrement balanceDue when the charge is collected. So once an
 * ancillary charge captures, its increment is stranded in balanceDue
 * forever, and the customer is shown (and dunned for, via debt-reminder) a
 * balance for money already taken.
 *
 * What this prints
 * ----------------
 * For every booking not reset to a clean state (settle / cancel set
 * balanceDue to 0 and so self-heal), it compares the stored balanceDue
 * against the sum of ancillary charges still genuinely PENDING. The gap
 * that is explained by SUCCEEDED ancillary charges is the suspected
 * phantom balance. Nothing is written — this only reports.
 *
 * Usage:
 *   npx tsx scripts/diagnose-balance-due-drift.ts            # dry-run report
 *   npx tsx scripts/diagnose-balance-due-drift.ts --csv      # CSV report
 *   npx tsx scripts/diagnose-balance-due-drift.ts --apply    # correct balanceDue
 *
 * --apply sets each flagged booking's balanceDue to (stored − phantom),
 * i.e. it removes only the portion proven to be backed by captured money,
 * leaving any genuinely-PENDING charges in place. Each correction writes an
 * AuditLog row (action: payment.balance_due_backfill) for traceability and
 * is idempotent — re-running after the code fix finds nothing to correct.
 */
import { PrismaClient, type PaymentType, type PaymentStatus } from "@prisma/client";

const prisma = new PrismaClient();

// Charge types that are ADDED to balanceDue when raised (PENDING) and so
// must be removed from it when captured. BOOKING_PAYMENT is deliberately
// excluded — it never enters balanceDue. Bond + gift-card + payout +
// credit/refund types are not customer-owed ancillary charges.
const ANCILLARY_CHARGE_TYPES: PaymentType[] = [
  "EXTENSION",
  "MANUAL_CHARGE",
  "LATE_FEE",
  "FUEL_CHARGE",
  "DAMAGE_CHARGE",
  "INFRINGEMENT_RECOVERY",
  "SWAP_ADJUSTMENT",
  "SUBSCRIPTION_CHARGE",
  "CLEANING_FEE",
  "ADDON_CHARGE",
  "ZONE_SURCHARGE",
  "FUEL_DELIVERY_FEE",
];

const n = (d: { toString(): string } | number | null | undefined) =>
  d == null ? 0 : Number(d.toString());
const r2 = (x: number) => Math.round(x * 100) / 100;

async function main() {
  const asCsv = process.argv.includes("--csv");
  const apply = process.argv.includes("--apply");

  const bookings = await prisma.booking.findMany({
    where: { balanceDue: { gt: 0 } },
    select: {
      id: true,
      bookingReference: true,
      // id retained for the --apply path
      // (bookingReference is for human-readable output)
      status: true,
      balanceDue: true,
      payments: {
        where: { type: { in: ANCILLARY_CHARGE_TYPES } },
        select: { type: true, status: true, amount: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  type Row = {
    id: string;
    ref: string;
    status: string;
    storedBalance: number;
    pendingAncillary: number; // genuinely still owed
    capturedAncillary: number; // collected — should NOT be in balanceDue
    suspectedPhantom: number; // part of balanceDue explained by captured money
    corrected: number; // what balanceDue becomes after removing the phantom
  };

  const rows: Row[] = [];
  for (const b of bookings) {
    let pending = 0;
    let captured = 0;
    for (const p of b.payments) {
      const amt = n(p.amount);
      if (p.status === ("PENDING" satisfies PaymentStatus)) pending += amt;
      else if (p.status === ("SUCCEEDED" satisfies PaymentStatus)) captured += amt;
      // REFUNDED / PARTIALLY_REFUNDED / FAILED are intentionally ignored:
      // a refunded charge's offsetting REFUND row + the original net out,
      // and FAILED/voided charges are decremented elsewhere already.
    }
    const stored = n(b.balanceDue);
    // The portion of the stored balance that is NOT backed by a still-owed
    // PENDING charge, but IS covered by money already captured, is the
    // phantom left behind by the missing decrement.
    const unexplained = r2(stored - pending);
    const phantom = r2(Math.max(0, Math.min(unexplained, captured)));
    if (phantom >= 0.01) {
      rows.push({
        id: b.id,
        ref: b.bookingReference,
        status: b.status,
        storedBalance: r2(stored),
        pendingAncillary: r2(pending),
        capturedAncillary: r2(captured),
        suspectedPhantom: phantom,
        corrected: r2(stored - phantom),
      });
    }
  }

  if (asCsv) {
    console.log("ref,status,storedBalance,pendingAncillary,capturedAncillary,suspectedPhantom");
    for (const r of rows) {
      console.log(
        [r.ref, r.status, r.storedBalance, r.pendingAncillary, r.capturedAncillary, r.suspectedPhantom].join(","),
      );
    }
  } else {
    console.log(`Scanned ${bookings.length} bookings with balanceDue > 0.`);
    console.log(`Flagged ${rows.length} with a suspected phantom balance:\n`);
    for (const r of rows.slice(0, 50)) {
      console.log(
        `  ${r.ref.padEnd(22)} ${r.status.padEnd(14)} ` +
          `stored=$${r.storedBalance.toFixed(2).padStart(9)}  ` +
          `pending=$${r.pendingAncillary.toFixed(2).padStart(9)}  ` +
          `captured=$${r.capturedAncillary.toFixed(2).padStart(9)}  ` +
          `phantom=$${r.suspectedPhantom.toFixed(2).padStart(9)}`,
      );
    }
    if (rows.length > 50) console.log(`  … and ${rows.length - 50} more (use --csv for the full list).`);
    const totalPhantom = r2(rows.reduce((s, r) => s + r.suspectedPhantom, 0));
    console.log(`\nTotal suspected phantom balance across flagged bookings: $${totalPhantom.toFixed(2)}`);
  }

  if (!apply) {
    if (!asCsv && rows.length > 0) {
      console.log("\nDry run — no rows written. Re-run with --apply to correct balanceDue.");
    }
    return;
  }

  let corrected = 0;
  for (const r of rows) {
    await prisma.$transaction(async (tx) => {
      await tx.booking.update({
        where: { id: r.id },
        data: { balanceDue: r.corrected },
      });
      await tx.auditLog.create({
        data: {
          action: "payment.balance_due_backfill",
          entity: "Booking",
          entityId: r.id,
          previousData: { balanceDue: r.storedBalance },
          newData: {
            balanceDue: r.corrected,
            removedPhantom: r.suspectedPhantom,
            capturedAncillary: r.capturedAncillary,
            pendingAncillary: r.pendingAncillary,
            reason: "Captured ancillary charge never decremented balanceDue (one-off backfill).",
          },
        },
      });
    });
    corrected += 1;
    console.log(`  corrected ${r.ref}: $${r.storedBalance.toFixed(2)} → $${r.corrected.toFixed(2)}`);
  }
  console.log(`\nApplied ${corrected} correction(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
