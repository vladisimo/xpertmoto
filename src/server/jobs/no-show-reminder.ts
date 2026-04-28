import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { getSettings } from "@/lib/settings";
import { sendNotification } from "@/server/services/notification-sender";
import { getQueue, registerWorker } from "./queue";

/**
 * Pre-cutoff no-show warning.
 *
 * Pairs with `no-show-detector.ts`: while that job marks bookings as
 * NO_SHOW once the grace window has expired, this one fires a final
 * EMAIL + SMS warning shortly before the cutoff so the customer has a
 * last chance to call the depot or arrive.
 *
 * Configuration (SystemSetting):
 *   - `booking.noShowGraceHours`             (default 2h)
 *   - `booking.noShowReminderMinutesBefore`  (default 30 min)
 *
 * Window: a CONFIRMED booking with no `actualPickupDateTime` whose
 * `pickupDateTime` falls in
 *   `[ now - graceHours*60min, now - (graceHours*60 - reminderMin) min ]`
 * is past pickup but still inside the last `reminderMin` minutes of the
 * grace window. Fired once per booking — idempotency uses an existing
 * `BOOKING_NO_SHOW_WARNING` Notification row to short-circuit repeats.
 *
 * Schedule: every 15 minutes — same cadence as overdue-check. Cheap
 * scan, low-cardinality candidates.
 */

const QUEUE = "no-show-reminder" as const;

export async function runNoShowReminder(opts: { graceHours?: number; reminderMinutesBefore?: number } = {}): Promise<{
  scanned: number;
  warned: number;
}> {
  const cfg = await getSettings([
    "booking.noShowGraceHours",
    "booking.noShowReminderMinutesBefore",
    "notification.enableEmail",
    "notification.enableSms",
  ] as const);
  const graceHours = opts.graceHours ?? cfg["booking.noShowGraceHours"];
  const reminderMin = opts.reminderMinutesBefore ?? cfg["booking.noShowReminderMinutesBefore"];

  // Window: a booking's pickup is at least (grace - reminderMin) old
  // and at most `grace` old. Clamp the upper bound to `now` so an
  // operator misconfig (reminderMin > grace*60) can't broadcast warnings
  // to customers whose pickup hasn't happened yet.
  const now = Date.now();
  const cutoffEarliestPickup = new Date(now - graceHours * 60 * 60 * 1000);
  const reminderUpperBound = now - Math.max(0, graceHours * 60 - reminderMin) * 60 * 1000;
  const cutoffLatestPickup = new Date(Math.min(now, reminderUpperBound));

  const candidates = await prisma.booking.findMany({
    where: {
      status: "CONFIRMED",
      actualPickupDateTime: null,
      pickupDateTime: { gt: cutoffEarliestPickup, lte: cutoffLatestPickup },
    },
    select: {
      id: true,
      bookingReference: true,
      customerId: true,
      pickupDateTime: true,
      bondAmount: true,
      pickupDepot: { select: { name: true, phone: true } },
    },
  });

  const channels: ("EMAIL" | "SMS")[] = [];
  if (cfg["notification.enableEmail"]) channels.push("EMAIL");
  if (cfg["notification.enableSms"]) channels.push("SMS");

  let warned = 0;
  for (const b of candidates) {
    if (!b.customerId) continue;
    const already = await prisma.notification.findFirst({
      where: { type: "BOOKING_NO_SHOW_WARNING", data: { path: ["bookingId"], equals: b.id } },
      select: { id: true },
    });
    if (already) continue;
    if (channels.length === 0) continue;

    const bondAud = Number(b.bondAmount ?? 0);
    const depotPhone = b.pickupDepot?.phone ?? null;
    const depotName = b.pickupDepot?.name ?? "the depot";
    const minutesLeft = Math.max(
      1,
      Math.round((b.pickupDateTime.getTime() + graceHours * 60 * 60 * 1000 - now) / 60000),
    );
    const phoneLine = depotPhone ? ` Call ${depotName} on ${depotPhone}.` : "";
    const bondLine =
      bondAud > 0
        ? ` Your A$${bondAud.toFixed(2)} bond will be forfeited if you don't arrive in time.`
        : "";

    try {
      await sendNotification({
        userId: b.customerId,
        type: "BOOKING_NO_SHOW_WARNING",
        channels,
        subject: `Final reminder: pick up booking ${b.bookingReference} or it will be cancelled`,
        title: `Pick up ${b.bookingReference} now`,
        body: `Your booking ${b.bookingReference} was scheduled to start at ${b.pickupDateTime.toISOString()}. We'll mark it as a no-show in about ${minutesLeft} minute${minutesLeft === 1 ? "" : "s"}.${bondLine}${phoneLine}`,
        bookingId: b.id,
        data: {
          bookingId: b.id,
          bookingReference: b.bookingReference,
          minutesUntilCutoff: minutesLeft,
          bondAud,
        },
        dedupKey: `no-show-warning:${b.id}`,
      });
      warned += 1;
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), bookingId: b.id },
        "no-show-reminder: send failed",
      );
    }
  }

  logger.info({ scanned: candidates.length, warned }, "no-show-reminder completed");
  return { scanned: candidates.length, warned };
}

export function startNoShowReminderScheduler() {
  registerWorker(QUEUE, async () => runNoShowReminder());
  const q = getQueue(QUEUE);
  if (!q) return;
  q.add(
    "every-15min",
    {},
    { repeat: { pattern: "*/15 * * * *", tz: "Australia/Brisbane" }, jobId: "repeat-15min" },
  );
}
