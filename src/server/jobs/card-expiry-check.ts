import { prisma } from "@/lib/prisma";
import { sendNotification } from "@/server/services/notification-sender";
import { getQueue, registerWorker } from "./queue";

const QUEUE = "card-expiry-check" as const;
const WARN_THRESHOLDS_DAYS = [30, 14, 7, 1] as const;

/**
 * Returns true when a card with (expMonth, expYear) will expire on or
 * before `horizon`. Month is 1-12; cards stop working at the END of their
 * expiry month, so we model that as midnight on day 1 of the following
 * month. A December-2026 card is still valid through 2026-12-31 23:59.
 */
export function cardExpiresBy(
  expMonth: number,
  expYear: number,
  horizon: Date,
): boolean {
  const cardExpiresAt = new Date(Date.UTC(expYear, expMonth, 1));
  return cardExpiresAt.getTime() <= horizon.getTime();
}

/**
 * Daily sweep. For every customer with an ACTIVE recurring
 * `BookingBillingPlan`, compare the saved card's expiry against the
 * plan's remaining charges. If the card will expire before the last
 * scheduled charge, email the customer with a "Please update your card"
 * link at 30/14/7/1 days before expiry. One notification per threshold
 * per customer (dedup via `sendNotification` dedupKey).
 */
export async function runCardExpiryCheck(): Promise<number> {
  const plans = await prisma.bookingBillingPlan.findMany({
    where: { status: "ACTIVE" },
    include: {
      booking: {
        select: {
          bookingReference: true,
          customer: {
            select: {
              id: true,
              firstName: true,
              customerProfile: {
                select: {
                  stripePaymentMethodBrand: true,
                  stripePaymentMethodExpMonth: true,
                  stripePaymentMethodExpYear: true,
                },
              },
            },
          },
        },
      },
    },
  });

  let sent = 0;
  for (const plan of plans) {
    const profile = plan.booking.customer.customerProfile;
    const expMonth = profile?.stripePaymentMethodExpMonth;
    const expYear = profile?.stripePaymentMethodExpYear;
    if (!expMonth || !expYear) continue;

    // Last scheduled charge date: lastChargedAt (or nextChargeAt if none
    // yet) + remaining periods * typical period length. Estimating month
    // length as 31 days is deliberately pessimistic so the alert fires
    // earlier rather than later.
    const remaining = plan.periodsTotal - plan.periodsCompleted;
    if (remaining <= 0) continue;
    const periodMs =
      plan.frequency === "WEEKLY"
        ? 7 * 86_400_000
        : plan.frequency === "FORTNIGHTLY"
          ? 14 * 86_400_000
          : 31 * 86_400_000;
    const lastCharge = new Date(
      plan.nextChargeAt.getTime() + (remaining - 1) * periodMs,
    );

    for (const days of WARN_THRESHOLDS_DAYS) {
      const horizon = new Date(Date.now() + days * 86_400_000);
      if (!cardExpiresBy(expMonth, expYear, lastCharge)) break;
      if (!cardExpiresBy(expMonth, expYear, horizon)) continue;

      const res = await sendNotification({
        userId: plan.booking.customer.id,
        type: "PAYMENT_RECEIVED",
        channels: ["EMAIL"],
        subject: `Your card expires soon — action needed for ${plan.booking.bookingReference}`,
        title: "Card on file expires soon",
        body: `Hi ${plan.booking.customer.firstName ?? "there"},\n\nThe card we have on file for your Scootering booking ${plan.booking.bookingReference} expires ${String(expMonth).padStart(2, "0")}/${expYear}. Your rental has ${remaining} more scheduled charge(s) — the last one on ${lastCharge.toLocaleDateString("en-AU")}.\n\nPlease sign in and update your card: ${process.env.APP_URL ?? "https://scootering.com.au"}/dashboard/profile\n\nIf we can't take the next recurring charge, we'll send you a one-off "Pay now" link — but updating your card is the smoothest path.\n\n— Scootering`,
        bookingId: plan.bookingId,
        dedupKey: `card-expiry-warn-${days}d:${plan.id}`,
        data: {
          expMonth,
          expYear,
          bookingReference: plan.booking.bookingReference,
          daysUntilExpiry: days,
        },
      });
      if (res.results.some((r) => r.status === "SENT")) sent += 1;
      break; // only fire the most urgent threshold that matches
    }
  }
  return sent;
}

export function startCardExpiryCheckScheduler() {
  registerWorker(QUEUE, async () => runCardExpiryCheck());
  const q = getQueue(QUEUE);
  if (!q) return;
  q.add(
    "daily",
    {},
    { repeat: { pattern: "0 9 * * *", tz: "Australia/Brisbane" }, jobId: "repeat-daily" },
  );
}
