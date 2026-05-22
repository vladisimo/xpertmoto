#!/usr/bin/env tsx
/**
 * Import a historical Stripe transaction into the Payment + BondLedger
 * tables. Useful when the nightly reconciliation job surfaces an
 * `UnmatchedTransaction` row and we want to hydrate the corresponding
 * XPERT Moto Payment row rather than let it sit as unmatched.
 *
 * Usage:
 *   tsx scripts/import-stripe-transaction.ts <payment_intent_id> <booking_reference>
 *
 * Safety:
 *   - Read-only on Stripe (retrieve only).
 *   - Refuses to overwrite an existing Payment row for the same PI id.
 *   - Flags the UnmatchedTransaction row as resolved if present.
 */

import { prisma } from "../src/lib/prisma";
import { retrievePaymentIntent } from "../src/lib/stripe";

async function main() {
  const [piId, bookingReference] = process.argv.slice(2);
  if (!piId || !bookingReference) {
    console.error(
      "Usage: tsx scripts/import-stripe-transaction.ts <pi_id> <booking_reference>",
    );
    process.exit(2);
  }

  const existing = await prisma.payment.findFirst({
    where: { stripePaymentIntentId: piId },
    select: { id: true, status: true, reference: true },
  });
  if (existing) {
    console.error(
      `Payment already exists for ${piId}: ${existing.reference} (${existing.status}). Refusing to duplicate.`,
    );
    process.exit(1);
  }

  const booking = await prisma.booking.findFirst({
    where: { bookingReference },
    select: { id: true, customerId: true },
  });
  if (!booking) {
    console.error(`Booking ${bookingReference} not found.`);
    process.exit(1);
  }

  const pi = await retrievePaymentIntent(piId);
  if (!pi) {
    console.error(`Stripe returned no PaymentIntent for ${piId} (stub mode or missing).`);
    process.exit(1);
  }
  if (pi.status !== "succeeded") {
    console.error(
      `PaymentIntent ${piId} is in status ${pi.status} — only imports succeeded charges.`,
    );
    process.exit(1);
  }

  const row = await prisma.payment.create({
    data: {
      reference: `IMPORT-${piId.slice(-8)}`,
      customerId: booking.customerId,
      bookingId: booking.id,
      type: "BOOKING_PAYMENT",
      method: "STRIPE",
      amount: pi.amountCents / 100,
      gstAmount: pi.amountCents / 100 / 11, // GST-inclusive 10%
      status: "SUCCEEDED",
      stripePaymentIntentId: pi.id,
      stripeChargeId: pi.latestChargeId,
      processedAt: new Date(),
      notes: `Imported from Stripe dashboard via scripts/import-stripe-transaction.ts`,
    },
  });

  // Mark the corresponding UnmatchedTransaction row resolved if present.
  await prisma.unmatchedTransaction.updateMany({
    where: { externalId: piId, resolvedAt: null },
    data: {
      resolvedAt: new Date(),
      resolvedNote: `Imported as Payment ${row.id}`,
    },
  });

  console.log(`✓ Imported Payment ${row.id} (${row.reference}) for booking ${bookingReference}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
