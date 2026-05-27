/**
 * One-shot backfill: issue *supplementary* DECREASE adjustment notes so the
 * tax invoice for every cancelled / no-show booking is credited down to the
 * consideration the business actually retained for a supply never rendered.
 *
 * Why: the cancellation path used to size the DECREASE to the cash refunded,
 * not the change in consideration. For deposit bookings (payOnlineAmount <
 * totalAmount) that left the invoice overstating consideration for a service
 * never provided; in the no-refund window no note was issued at all. The
 * go-forward fix lives in booking-cancellation.ts + no-show-detector.ts via
 * `buildSupplyNotProvidedDecrease`; this script corrects the history.
 *
 * Target net consideration per booking:
 *   - CANCELLED → retained = amountPaid − Σ(non-failed REFUND payments)
 *                 (the admin fee, or the full deposit in the no-refund window)
 *   - NO_SHOW   → retained = 0 (rental credited to $0; the no-show fee /
 *                 bond forfeiture is a separate punitive charge)
 *
 *   targetDecrease = invoiceTotal − clamp(retained, 0, invoiceTotal)
 *
 * AdjustmentNotes are immutable (MUST NOT be hard-deleted / edited), so we
 * never touch existing notes — we issue a supplementary DECREASE for the gap:
 *
 *   gap = targetDecrease − Σ(existing non-void CANCELLATION/REFUND DECREASE
 *                            notes on the invoice)
 *
 * Skipped when gap ≤ $0.01. Re-running is a no-op (the gap closes to 0 once
 * the supplementary note exists). The customer email is suppressed by default
 * — pass --email to send the corrected credit notes.
 *
 * Usage:
 *   npx tsx scripts/backfill-cancellation-adjustments.ts            # dry-run
 *   npx tsx scripts/backfill-cancellation-adjustments.ts --apply    # write
 *   npx tsx scripts/backfill-cancellation-adjustments.ts --apply --email
 */
import { PrismaClient } from "@prisma/client";

import { aud, roundCents } from "@/lib/money";
import { issueAdjustmentNote } from "@/server/services/invoice-lifecycle";

const prisma = new PrismaClient();

async function main() {
  const apply = process.argv.includes("--apply");
  const sendEmail = process.argv.includes("--email");

  const bookings = await prisma.booking.findMany({
    where: {
      status: { in: ["CANCELLED", "NO_SHOW"] },
      deletedAt: null,
      invoices: { some: { deletedAt: null, status: { not: "VOID" } } },
    },
    select: {
      id: true,
      bookingReference: true,
      status: true,
      amountPaid: true,
      payments: {
        where: { type: "REFUND", status: { not: "FAILED" } },
        select: { amount: true },
      },
      invoices: {
        where: { deletedAt: null, status: { not: "VOID" } },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          invoiceNumber: true,
          totalAmount: true,
          adjustmentNotes: {
            where: { status: { not: "VOID" }, type: "DECREASE" },
            select: { reason: true, totalAmount: true },
          },
        },
      },
    },
  });

  console.log(
    `Found ${bookings.length} cancelled/no-show bookings with a live invoice`,
  );

  let issued = 0;
  let skipped = 0;
  let errors = 0;

  for (const b of bookings) {
    try {
      const invoice = b.invoices[0];
      if (!invoice) {
        skipped++;
        continue;
      }
      const invoiceTotal = aud(invoice.totalAmount);

      // Cash kept as rental consideration on the invoice.
      const refunded = b.payments.reduce(
        (acc, p) => acc.add(aud(p.amount)),
        aud(0),
      );
      const retained =
        b.status === "NO_SHOW"
          ? aud(0)
          : roundCents(aud(b.amountPaid).minus(refunded));
      const retainedClamped = retained.lessThan(0)
        ? aud(0)
        : retained.greaterThan(invoiceTotal)
          ? invoiceTotal
          : retained;
      const targetDecrease = roundCents(invoiceTotal.minus(retainedClamped));

      // Credit already issued against this invoice for the cancellation/refund.
      const existingDecrease = invoice.adjustmentNotes
        .filter((n) => n.reason === "CANCELLATION" || n.reason === "REFUND")
        .reduce((acc, n) => acc.add(aud(n.totalAmount)), aud(0));

      const gap = roundCents(targetDecrease.minus(existingDecrease));
      if (gap.lessThanOrEqualTo(0.01)) {
        skipped++;
        continue;
      }

      const label = `${b.bookingReference} (${invoice.invoiceNumber}, ${b.status}): invoiceTotal=${invoiceTotal.toFixed(2)} retained=${retainedClamped.toFixed(2)} target=${targetDecrease.toFixed(2)} existing=${existingDecrease.toFixed(2)} → supplementary DECREASE ${gap.toFixed(2)}`;

      if (!apply) {
        console.log(`[dry-run] ${label}`);
        issued++;
        continue;
      }

      await issueAdjustmentNote({
        invoiceId: invoice.id,
        type: "DECREASE",
        reason: "CANCELLATION",
        description:
          "Cancellation credit — correction (rental not provided; consideration written down)",
        lineItems: [
          {
            description: "Cancellation — rental not provided (correction)",
            detail: `Supplementary credit to net invoice to retained consideration A$${retainedClamped.toFixed(2)}`,
            quantity: 1,
            unitPrice: gap.toNumber(),
            totalPrice: gap.toNumber(),
            gstIncluded: true,
          },
        ],
        paymentId: null,
        skipCustomerEmail: !sendEmail,
      });
      issued++;
      console.log(label);
    } catch (err) {
      errors++;
      console.error(`error processing booking ${b.id} (${b.bookingReference}):`, err);
    }
  }

  console.log(
    `\n${apply ? "Backfill complete" : "Dry-run complete"} — ${issued} ${apply ? "issued" : "would issue"}, ${skipped} skipped (already correct / nothing to credit), ${errors} errors`,
  );
  if (!apply) {
    console.log("\nRe-run with --apply to actually issue the supplementary notes.");
    console.log("Add --email to also send the corrected credit notes to customers.");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
