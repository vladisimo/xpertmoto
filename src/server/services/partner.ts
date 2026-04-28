import type { PrismaClient } from "@prisma/client";
import { logger } from "@/lib/logger";

/**
 * Lever 4: partner attribution + commission ledger helpers.
 *
 * `attachByTrackingCode` is called from the booking-creation path to
 * snap-attribute a booking to a partner when the customer arrived with
 * ?ref=<code>. Writes both the denormalised partnerId/partnerCode on
 * the booking and a PartnerTransaction row seeded with the current
 * commissionPct snapshot so retroactive rate changes don't shift
 * payouts.
 */

export type AttachResult = {
  attached: boolean;
  partnerId?: string;
  commissionAmount?: number;
};

export async function attachByTrackingCode(
  prisma: PrismaClient,
  args: { bookingId: string; trackingCode: string },
): Promise<AttachResult> {
  const partner = await prisma.partner.findUnique({
    where: { trackingCode: args.trackingCode.toUpperCase() },
  });
  if (!partner || !partner.isActive) {
    logger.warn(
      { trackingCode: args.trackingCode },
      "partner.attachByTrackingCode: code not matched to active partner",
    );
    return { attached: false };
  }

  const booking = await prisma.booking.findUniqueOrThrow({
    where: { id: args.bookingId },
  });
  const bookingTotal = Number(booking.totalAmount);
  const commissionPct = Number(partner.commissionPct);
  const commissionAmount =
    Math.round(((bookingTotal * commissionPct) / 100) * 100) / 100;

  await prisma.$transaction(async (tx) => {
    await tx.booking.update({
      where: { id: booking.id },
      data: { partnerId: partner.id, partnerCode: args.trackingCode.toUpperCase() },
    });
    await tx.partnerTransaction.upsert({
      where: {
        bookingId_partnerId: { bookingId: booking.id, partnerId: partner.id },
      },
      update: { bookingTotal, commissionAmount, commissionPct },
      create: {
        partnerId: partner.id,
        bookingId: booking.id,
        bookingTotal,
        commissionPct,
        commissionAmount,
        status: booking.status === "COMPLETED" ? "PAYABLE" : "PENDING",
      },
    });
  });

  return { attached: true, partnerId: partner.id, commissionAmount };
}

/**
 * Called when a booking transitions to COMPLETED. Flips any PENDING
 * PartnerTransaction row(s) for the booking to PAYABLE so admin can
 * settle them.
 */
export async function markPartnerTransactionsPayable(
  prisma: PrismaClient,
  bookingId: string,
): Promise<number> {
  const result = await prisma.partnerTransaction.updateMany({
    where: { bookingId, status: "PENDING" },
    data: { status: "PAYABLE" },
  });
  return result.count;
}
