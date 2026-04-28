import { prisma } from "@/lib/prisma";
import { sendNotification } from "@/server/services/notification-sender";
import { getQueue, registerWorker } from "./queue";

const QUEUE = "bond-auth-expiry-check" as const;

// Per-brand authorisation TTL windows. Stripe won't report these explicitly;
// they're set by the card network:
//   - Visa:       ~7 days (can extend to 30 with certain merchant categories)
//   - Mastercard: ~30 days
//   - Amex:       ~30 days
//   - Others:     assume 7 days (conservative)
// We alert managers when a HELD bond is within 2 days of the assumed
// horizon so they can capture early or accept that the auth will drop.
const BRAND_AUTH_DAYS: Record<string, number> = {
  visa: 7,
  mastercard: 30,
  amex: 30,
  discover: 30,
  jcb: 30,
  unionpay: 7,
  diners: 14,
};
const DEFAULT_AUTH_DAYS = 7;
const ALERT_LEAD_DAYS = 2;

/**
 * Daily sweep: find active bond holds whose Stripe authorisation is
 * about to expire. Notify managers so they can either capture any
 * damage charges now or release the bond before the auth drops silently.
 *
 * Without this sweep a Visa bond 6 days old could drop off the customer's
 * card on day 7, leaving us with no recourse if a damage claim lands on
 * day 8. This doesn't extend the auth (Stripe doesn't support that for
 * card-present rails) — it just keeps humans informed.
 */
export async function runBondAuthExpiryCheck(): Promise<number> {
  const candidates = await prisma.bondLedger.findMany({
    where: {
      status: "HELD",
      stripePaymentIntentId: { not: null },
    },
    include: {
      booking: {
        select: {
          id: true,
          bookingReference: true,
          status: true,
          vehicleId: true,
          customer: {
            select: {
              id: true,
              customerProfile: { select: { stripePaymentMethodBrand: true } },
            },
          },
        },
      },
    },
  });

  let alertsSent = 0;
  for (const bond of candidates) {
    const brand = (
      bond.booking.customer?.customerProfile?.stripePaymentMethodBrand ?? ""
    ).toLowerCase();
    const horizon = BRAND_AUTH_DAYS[brand] ?? DEFAULT_AUTH_DAYS;
    const ageDays = (Date.now() - bond.createdAt.getTime()) / (1000 * 60 * 60 * 24);
    const daysLeft = horizon - ageDays;
    if (daysLeft > ALERT_LEAD_DAYS || daysLeft < 0) continue;

    // Don't spam — one alert per bond per 24h.
    const recent = await prisma.auditLog.findFirst({
      where: {
        action: "bond.auth_expiry_alert",
        entityId: bond.id,
        timestamp: { gt: new Date(Date.now() - 23 * 60 * 60 * 1000) },
      },
      select: { id: true },
    });
    if (recent) continue;

    const managers = await prisma.user.findMany({
      where: { role: { in: ["MANAGER", "ADMIN", "SUPER_ADMIN"] }, status: "ACTIVE" },
      select: { id: true },
    });
    for (const m of managers) {
      await sendNotification({
        userId: m.id,
        type: "INCIDENT_REPORTED",
        channels: ["IN_APP", "EMAIL"],
        subject: `Bond authorisation expiring — ${bond.booking.bookingReference}`,
        title: "Bond authorisation expiring soon",
        body: `The bond hold on booking ${bond.booking.bookingReference} (${brand || "unknown brand"} card) will expire in ~${Math.max(0, Math.ceil(daysLeft))} day(s). Capture any damage charges now, or accept that the auth will drop off the customer's card. Booking status: ${bond.booking.status}.`,
        data: {
          bookingId: bond.booking.id,
          bondLedgerId: bond.id,
          cardBrand: brand,
          daysLeft,
        },
      });
    }
    await prisma.auditLog.create({
      data: {
        category: "JOB",
        action: "bond.auth_expiry_alert",
        entity: "BondLedger",
        entityId: bond.id,
        status: "SUCCESS",
        newData: {
          bookingId: bond.booking.id,
          brand,
          ageDays,
          horizon,
          daysLeft,
        },
      },
    });
    alertsSent += 1;
  }
  return alertsSent;
}

export function startBondAuthExpiryCheckScheduler() {
  registerWorker(QUEUE, async () => runBondAuthExpiryCheck());
  const q = getQueue(QUEUE);
  if (!q) return;
  q.add(
    "daily",
    {},
    { repeat: { pattern: "30 8 * * *", tz: "Australia/Brisbane" }, jobId: "repeat-daily" },
  );
}
