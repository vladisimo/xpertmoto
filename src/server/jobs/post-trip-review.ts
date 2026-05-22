import { render } from "@react-email/render";
import { createElement } from "react";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { sendNotification } from "@/server/services/notification-sender";
import { ensureReferralCode } from "@/server/services/referral";
import { awardLoyaltyPoints } from "@/server/services/loyalty";
import { getSetting, SETTING_DEFAULTS } from "@/lib/settings";
import { getBranding } from "@/lib/branding";
import PostTripReviewEmail from "../../../emails/post-trip-review";
import { getQueue, registerWorker } from "./queue";

const QUEUE = "post-trip-review" as const;

/**
 * Lever 5 + Lever 10: post-trip review + referral + next-booking
 * cross-sell.
 *
 * Runs hourly. Finds bookings completed 18–30 hours ago that haven't
 * yet received a POST_TRIP_REVIEW_REQUEST. Emits one email containing:
 *   - Review capture CTA (rating + comment via magic-link, no login)
 *   - Unique next-booking discount code
 *   - Referral code prompt
 *   - Gift card teaser
 *
 * Also awards loyalty points when the booking completes — kept here
 * because this job is the first reliably-scheduled point in post-trip
 * lifecycle and it's idempotent via the POST_TRIP_REVIEW_REQUEST
 * Notification dedupe.
 */

const NEXT_BOOKING_DISCOUNT_PCT = 15;
const NEXT_BOOKING_WINDOW_DAYS = 60;

export type PostTripReviewResult = {
  scanned: number;
  emailed: number;
  pointsAwarded: number;
  skipped: number;
};

export async function runPostTripReview(
  now: Date = new Date(),
): Promise<PostTripReviewResult> {
  const counters: PostTripReviewResult = {
    scanned: 0,
    emailed: 0,
    pointsAwarded: 0,
    skipped: 0,
  };
  const windowStart = new Date(now.getTime() - 30 * 60 * 60 * 1000);
  const windowEnd = new Date(now.getTime() - 18 * 60 * 60 * 1000);

  const bookings = await prisma.booking.findMany({
    where: {
      status: "COMPLETED",
      updatedAt: { gte: windowStart, lte: windowEnd },
    },
    include: {
      customer: { include: { customerProfile: true } },
      category: true,
      pickupDepot: true,
    },
  });

  counters.scanned = bookings.length;

  for (const b of bookings) {
    const alreadySent = await prisma.notification.findFirst({
      where: {
        userId: b.customerId,
        type: "POST_TRIP_REVIEW_REQUEST",
        data: { path: ["bookingReference"], equals: b.bookingReference } as unknown as never,
      },
      select: { id: true },
    });
    if (alreadySent) {
      counters.skipped += 1;
      continue;
    }

    // Lever 9: award loyalty points. Rate comes from loyalty.pointsPerDollar.
    try {
      const pointsPerDollar = await getSetting(
        "loyalty.pointsPerDollar",
        SETTING_DEFAULTS["loyalty.pointsPerDollar"],
      );
      const pointsAwarded = await awardLoyaltyPoints(prisma, {
        userId: b.customerId,
        bookingId: b.id,
        points: Math.floor(Number(b.totalAmount) * pointsPerDollar),
        reason: `Booking ${b.bookingReference}`,
      });
      if (pointsAwarded > 0) counters.pointsAwarded += 1;
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), bookingId: b.id },
        "post-trip-review: loyalty award failed",
      );
    }

    // Unique next-booking discount code.
    const discountCode = `RIDE-AGAIN-${b.bookingReference.slice(-6).toUpperCase()}`;
    await prisma.discount.upsert({
      where: { code: discountCode },
      update: {},
      create: {
        code: discountCode,
        description: `Post-trip thank-you discount for ${b.bookingReference}`,
        type: "PERCENTAGE",
        value: NEXT_BOOKING_DISCOUNT_PCT,
        maxUses: 1,
        validFrom: now,
        validTo: new Date(now.getTime() + NEXT_BOOKING_WINDOW_DAYS * 86400_000),
        isActive: true,
      },
    });

    // Ensure customer has a referral code for the share CTA.
    const referralCode = await ensureReferralCode(prisma, b.customerId);
    const appUrl = process.env.APP_URL ?? "https://xpertmoto.com.au";
    const reviewUrl = `${appUrl}/reviews/new?booking=${b.bookingReference}`;

    const { siteName } = await getBranding();
    const html = await render(
      createElement(PostTripReviewEmail, {
        customerName: b.customer.firstName,
        bookingReference: b.bookingReference,
        categoryName: b.category.name,
        depotName: b.pickupDepot.name,
        reviewUrl,
        nextBookingDiscountCode: discountCode,
        nextBookingDiscountPct: NEXT_BOOKING_DISCOUNT_PCT,
        giftCardUrl: `${appUrl}/gift-cards`,
        referralCode,
        referralUrl: `${appUrl}/?ref=${referralCode}`,
        referralReward: "$20 off",
        siteName,
      }),
    );

    await sendNotification({
      userId: b.customerId,
      type: "POST_TRIP_REVIEW_REQUEST",
      channels: ["EMAIL"],
      subject: `How was your ${siteName} ride?`,
      title: "Rate your ride",
      html,
      body: `Thanks for riding with ${siteName}! Leave a review: ${reviewUrl} — and here's ${NEXT_BOOKING_DISCOUNT_PCT}% off your next booking: code ${discountCode} (valid ${NEXT_BOOKING_WINDOW_DAYS} days).`,
      bookingId: b.id,
      data: {
        bookingReference: b.bookingReference,
        discountCode,
        referralCode,
      },
    });

    counters.emailed += 1;
  }

  logger.info(counters, "post-trip-review finished");
  return counters;
}

export function startPostTripReviewScheduler() {
  registerWorker(QUEUE, async () => runPostTripReview());
  const q = getQueue(QUEUE);
  if (!q) return;
  q.add(
    "hourly",
    {},
    { repeat: { pattern: "15 * * * *", tz: "Australia/Brisbane" }, jobId: "repeat-hourly-review" },
  );
}
