import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import {
  bondAuthHorizonDays,
  ensureFreshBondHold,
} from "@/server/services/bond";
import { sendNotification } from "@/server/services/notification-sender";
import { getQueue, monitorCron, registerWorker } from "./queue";

const QUEUE = "bond-auth-expiry-check" as const;

/**
 * Daily rolling re-hold. Card-network authorisations expire silently
 * (~7 days Visa, ~30 MC/Amex); Stripe can't extend them. For every HELD
 * bond within ALERT_LEAD_DAYS of its brand horizon (INCLUDING already
 * expired — those need a re-hold most of all):
 *
 *   - Live hire (CHECKED_OUT / ACTIVE / OVERDUE) or held-as-backstop
 *     (RETURNED): re-authorise off-session from the saved card via
 *     ensureFreshBondHold — a fresh manual-capture PI replaces the dying
 *     one, no human involved. Managers are alerted ONLY when the re-auth
 *     fails (declined / no saved card / 3DS-required with nobody present).
 *
 *   - CONFIRMED (pre-pickup): skip — the check-out flow refreshes the hold
 *     when the customer is standing at the counter (3DS fallback possible),
 *     and a lapse before pickup carries no exposure.
 *
 * Previously this job only emailed managers and skipped already-expired
 * holds entirely; every Visa hire past ~day 6 silently lost its bond.
 */
export async function runBondAuthExpiryCheck(): Promise<{
  scanned: number;
  reauthorized: number;
  failed: number;
  alerted: number;
  skippedPrePickup: number;
}> {
  const { getSetting, SETTING_DEFAULTS } = await import("@/lib/settings");
  const leadDays = await getSetting(
    "payment.bondReauthLeadDays",
    SETTING_DEFAULTS["payment.bondReauthLeadDays"],
  );

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
          // Loss-terminated hires land COMPLETED, but a HELD_FOR_CLAIM bond
          // disposition means the hold is deliberately kept alive for the
          // incident claim — the keep-alive predicate below includes them.
          termination: { select: { bondDisposition: true } },
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

  const result = { scanned: 0, reauthorized: 0, failed: 0, alerted: 0, skippedPrePickup: 0 };

  for (const bond of candidates) {
    result.scanned += 1;
    const brand =
      bond.booking.customer?.customerProfile?.stripePaymentMethodBrand ?? null;
    const horizon = bondAuthHorizonDays(brand);
    const authorizedAt = bond.authorizedAt ?? bond.createdAt;
    const ageDays = (Date.now() - authorizedAt.getTime()) / 86_400_000;
    const daysLeft = horizon - ageDays;
    // Act on soon-to-expire AND already-expired holds. (The old `daysLeft < 0`
    // skip meant expired holds silently stopped being tracked at all.)
    if (daysLeft > leadDays) continue;

    const bookingStatus = bond.booking.status;
    // Live hires, held-as-backstop returns, AND loss-terminated bookings
    // whose bond is explicitly held for an incident claim (Area 2:
    // termination.bondDisposition = HELD_FOR_CLAIM). Without the latter the
    // hold would silently lapse before the claim settles — COMPLETED is not
    // otherwise in the keep-alive set.
    const heldForClaim =
      bond.booking.termination?.bondDisposition === "HELD_FOR_CLAIM";
    if (
      ["CHECKED_OUT", "ACTIVE", "OVERDUE", "RETURNED"].includes(bookingStatus) ||
      heldForClaim
    ) {
      const outcome = await ensureFreshBondHold(prisma, {
        bookingId: bond.booking.id,
        minRemainingDays: leadDays,
        reason: "rolling-reauth",
      });
      if (outcome.ok) {
        if (outcome.action === "reauthorized") {
          result.reauthorized += 1;
          logger.info(
            { bookingId: bond.booking.id, reference: bond.booking.bookingReference },
            "bond-auth-expiry: hold re-authorised off-session",
          );
        }
        continue;
      }
      // Re-auth failed (decline / no PM / 3DS with nobody present) — this is
      // the case that genuinely needs a human. One alert per bond per 24h.
      result.failed += 1;
      const alerted = await alertManagersOnce(bond.id, {
        subject: `Bond re-authorisation FAILED — ${bond.booking.bookingReference}`,
        body:
          `The bond hold on booking ${bond.booking.bookingReference} (${brand ?? "unknown"} card) ` +
          `is ${daysLeft < 0 ? "already expired" : `expiring in ~${Math.max(0, Math.ceil(daysLeft)).toFixed(0)} day(s)`} ` +
          `and the automatic off-session re-hold failed (${outcome.action}${"errorCode" in outcome && outcome.errorCode ? `: ${outcome.errorCode}` : ""}). ` +
          `Capture any damage charges now, ask the customer for a new card, or accept that the hold lapses. ` +
          `Booking status: ${bookingStatus}.`,
        bookingId: bond.booking.id,
        data: {
          bondLedgerId: bond.id,
          cardBrand: brand,
          daysLeft,
          failureAction: outcome.action,
        },
      });
      if (alerted) result.alerted += 1;
      continue;
    }

    if (bookingStatus === "CONFIRMED") {
      // Pre-pickup lapse is expected and harmless — check-out re-holds with
      // the customer present. Audit once for traceability, don't spam staff.
      result.skippedPrePickup += 1;
      continue;
    }
    // Terminal statuses with a HELD bond are bond-auto-release's problem.
  }

  logger.info(result, "bond-auth-expiry-check completed");
  return result;
}

/** Manager fan-out with a 23h audit-log dedup (one alert per bond per day). */
async function alertManagersOnce(
  bondLedgerId: string,
  notification: {
    subject: string;
    body: string;
    bookingId: string;
    data: { [key: string]: string | number | boolean | null };
  },
): Promise<boolean> {
  const recent = await prisma.auditLog.findFirst({
    where: {
      action: "bond.reauth_failed_alert",
      entityId: bondLedgerId,
      timestamp: { gt: new Date(Date.now() - 23 * 60 * 60 * 1000) },
    },
    select: { id: true },
  });
  if (recent) return false;

  const managers = await prisma.user.findMany({
    where: { role: { in: ["MANAGER", "ADMIN", "SUPER_ADMIN"] }, status: "ACTIVE" },
    select: { id: true },
  });
  for (const m of managers) {
    await sendNotification({
      userId: m.id,
      type: "INCIDENT_REPORTED",
      channels: ["IN_APP", "EMAIL"],
      subject: notification.subject,
      title: "Bond re-authorisation failed",
      body: notification.body,
      bookingId: notification.bookingId,
      data: notification.data,
    });
  }
  await prisma.auditLog.create({
    data: {
      category: "JOB",
      action: "bond.reauth_failed_alert",
      entity: "BondLedger",
      entityId: bondLedgerId,
      status: "SUCCESS",
      newData: JSON.parse(JSON.stringify(notification.data)),
    },
  });
  return true;
}

export function startBondAuthExpiryCheckScheduler() {
  registerWorker(QUEUE, async () => runBondAuthExpiryCheck());
  monitorCron(QUEUE, "30 8 * * *");
  const q = getQueue(QUEUE);
  if (!q) return;
  q.add(
    "daily",
    {},
    { repeat: { pattern: "30 8 * * *", tz: "Australia/Brisbane" }, jobId: "repeat-daily" },
  );
}
