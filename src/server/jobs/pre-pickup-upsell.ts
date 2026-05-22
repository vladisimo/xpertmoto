import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { sendNotification } from "@/server/services/notification-sender";
import { getQueue, registerWorker } from "./queue";

const QUEUE = "pre-pickup-upsell" as const;

/**
 * Lever 7: pre-pickup excess-reduction upsell.
 *
 * Runs every hour and targets CONFIRMED bookings where pickup is ~24h
 * away. For bookings whose insurance is Basic (or none), surface an
 * excess-reduction offer. One-tap acceptance hits the booking router's
 * `addInsuranceMidRental` mutation via the link in the email.
 *
 * Idempotency: uses a 2-hour window (23–25h out) and checks that we
 * haven't already sent EXCESS_UPSELL_OFFER for this booking in the
 * last 20 hours via the Notification table — avoids spamming if the
 * job is replayed.
 */

const WINDOW_HOURS = 24;
const WINDOW_SPAN_HOURS = 2;

export type PrePickupUpsellResult = {
  scanned: number;
  offered: number;
  skipped: number;
};

function hoursAgo(h: number, ref = new Date()): Date {
  return new Date(ref.getTime() - h * 60 * 60 * 1000);
}

export async function runPrePickupUpsell(
  now: Date = new Date(),
): Promise<PrePickupUpsellResult> {
  const counters: PrePickupUpsellResult = { scanned: 0, offered: 0, skipped: 0 };
  const windowStart = new Date(
    now.getTime() + (WINDOW_HOURS - WINDOW_SPAN_HOURS / 2) * 60 * 60 * 1000,
  );
  const windowEnd = new Date(
    now.getTime() + (WINDOW_HOURS + WINDOW_SPAN_HOURS / 2) * 60 * 60 * 1000,
  );

  const bookings = await prisma.booking.findMany({
    where: {
      status: "CONFIRMED",
      pickupDateTime: { gte: windowStart, lte: windowEnd },
    },
    include: {
      customer: { select: { id: true, firstName: true, email: true } },
      category: { select: { id: true, name: true } },
      insurance: {
        include: { insuranceOption: true },
        orderBy: { addedAt: "desc" },
        take: 1,
      },
    },
  });

  counters.scanned = bookings.length;

  // Premium / $0-excess products are off-target.
  const allInsurance = await prisma.insuranceOption.findMany({
    where: { isActive: true },
    orderBy: { excessAmount: "asc" },
  });
  const zeroExcess = allInsurance[0];
  if (!zeroExcess) {
    logger.info("pre-pickup-upsell: no insurance products configured — exiting");
    return counters;
  }

  for (const b of bookings) {
    const current = b.insurance[0];
    const currentExcess = current ? Number(current.insuranceOption.excessAmount) : Infinity;
    // Already on the lowest-excess plan? Nothing to upsell.
    if (currentExcess <= Number(zeroExcess.excessAmount)) {
      counters.skipped += 1;
      continue;
    }

    const recentOffer = await prisma.notification.findFirst({
      where: {
        userId: b.customerId,
        type: "EXCESS_UPSELL_OFFER",
        createdAt: { gt: hoursAgo(20, now) },
        data: { path: ["bookingReference"], equals: b.bookingReference } as unknown as never,
      },
      select: { id: true },
    });
    if (recentOffer) {
      counters.skipped += 1;
      continue;
    }

    const acceptUrl =
      (process.env.APP_URL ?? "https://xpertmoto.com.au") +
      `/dashboard/bookings/${b.id}?upsellInsuranceId=${zeroExcess.id}`;
    const dailyRate = Number(zeroExcess.dailyRate);
    const totalDays = b.durationDays;

    await sendNotification({
      userId: b.customerId,
      type: "EXCESS_UPSELL_OFFER",
      channels: ["EMAIL", "PUSH"],
      subject: `Ride worry-free — drop your excess to $${Number(zeroExcess.excessAmount).toFixed(0)}`,
      title: "One-tap excess reduction",
      body: `Your booking ${b.bookingReference} has a $${currentExcess.toFixed(0)} excess. For $${dailyRate.toFixed(0)}/day (${(dailyRate * totalDays).toFixed(0)} total) you can drop it to $${Number(zeroExcess.excessAmount).toFixed(0)}. Tap to add: ${acceptUrl}`,
      bookingId: b.id,
      data: {
        bookingReference: b.bookingReference,
        offeredInsuranceId: zeroExcess.id,
        offeredDailyRate: dailyRate,
        offeredExcess: Number(zeroExcess.excessAmount),
        currentExcess,
      },
    });
    counters.offered += 1;
  }

  logger.info(counters, "pre-pickup-upsell finished");
  return counters;
}

export function startPrePickupUpsellScheduler() {
  registerWorker(QUEUE, async () => runPrePickupUpsell());
  const q = getQueue(QUEUE);
  if (!q) return;
  q.add(
    "hourly",
    {},
    { repeat: { pattern: "0 * * * *", tz: "Australia/Brisbane" }, jobId: "repeat-hourly" },
  );
}
