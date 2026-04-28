/**
 * Daily identity-document expiry alerts.
 *
 * Two document types, different windows:
 *   - Driver's licence: 30 / 14 / 7 days before expiry.
 *   - Passport: 90 / 30 / 7 days before expiry (passports cost more and
 *     are typically renewed months ahead).
 *
 * Exactly one notification per customer per (documentKind, windowDays) is
 * ever sent — dedup-keyed on Notification.data.
 *
 * The file is still named `licence-expiry.ts` and the BullMQ queue is still
 * `licence-expiry` so Redis state and scheduler registrations don't have to
 * be renamed, but the function and exports now cover both document types.
 * `runLicenceExpiryAlerts` is retained as a re-export for any external caller.
 */

import { prisma } from "@/lib/prisma";
import { sendNotification } from "@/server/services/notification-sender";

import { getQueue, registerWorker } from "./queue";

const QUEUE = "licence-expiry" as const;

const LICENCE_WINDOWS = [30, 14, 7] as const;
const PASSPORT_WINDOWS = [90, 30, 7] as const;

type DocumentKind = "licence" | "passport";

/** Send at most one notification per (customer, document kind, window). */
async function alreadySent(
  userId: string,
  kind: DocumentKind,
  windowDays: number,
): Promise<boolean> {
  // First match on the modern shape (documentKind present). This is the
  // dedup key for rows written by this generalised job.
  const modern = await prisma.notification.findFirst({
    where: {
      userId,
      type: kind === "licence" ? "LICENCE_EXPIRING" : "PASSPORT_EXPIRING",
      data: { path: ["windowDays"], equals: windowDays },
      AND: [{ data: { path: ["documentKind"], equals: kind } }],
    },
  });
  if (modern) return true;

  // Back-compat for licence notifications written before the generalisation
  // — they have windowDays but no documentKind. Treat them as already-sent.
  if (kind === "licence") {
    const legacy = await prisma.notification.findFirst({
      where: {
        userId,
        type: "LICENCE_EXPIRING",
        data: { path: ["windowDays"], equals: windowDays },
      },
    });
    if (legacy) return true;
  }
  return false;
}

async function runLicencePass(now: Date): Promise<number> {
  let sent = 0;
  for (const days of LICENCE_WINDOWS) {
    const windowEnd = new Date(now);
    windowEnd.setDate(windowEnd.getDate() + days);
    const windowStart = new Date(now);
    windowStart.setDate(windowStart.getDate() + days - 1);

    const expiring = await prisma.customerProfile.findMany({
      where: {
        licenceExpiry: { gte: windowStart, lte: windowEnd },
      },
      include: {
        user: { select: { id: true, firstName: true, email: true, deletedAt: true } },
      },
    });

    for (const p of expiring) {
      if (!p.licenceExpiry || !p.user || p.user.deletedAt) continue;
      if (await alreadySent(p.user.id, "licence", days)) continue;

      await sendNotification({
        userId: p.user.id,
        type: "LICENCE_EXPIRING",
        channels: ["EMAIL"],
        subject: `Your driver's licence is expiring soon`,
        title: `Licence expiring in ${days} days`,
        body: `Hi ${p.user.firstName}, our records show your driver's licence expires on ${p.licenceExpiry.toLocaleDateString("en-AU")}. Please update us with the new licence before your next booking so we can keep you on the road.`,
        data: {
          windowDays: days,
          documentKind: "licence",
          expiryDate: p.licenceExpiry.toISOString(),
        },
      });
      sent++;
    }
  }
  return sent;
}

async function runPassportPass(now: Date): Promise<number> {
  let sent = 0;
  for (const days of PASSPORT_WINDOWS) {
    const windowEnd = new Date(now);
    windowEnd.setDate(windowEnd.getDate() + days);
    const windowStart = new Date(now);
    windowStart.setDate(windowStart.getDate() + days - 1);

    const expiring = await prisma.customerProfile.findMany({
      where: {
        passportExpiry: { gte: windowStart, lte: windowEnd },
      },
      include: {
        user: { select: { id: true, firstName: true, email: true, deletedAt: true } },
      },
    });

    for (const p of expiring) {
      if (!p.passportExpiry || !p.user || p.user.deletedAt) continue;
      if (await alreadySent(p.user.id, "passport", days)) continue;

      await sendNotification({
        userId: p.user.id,
        type: "PASSPORT_EXPIRING",
        channels: ["EMAIL"],
        subject: `Your passport is expiring soon`,
        title: `Passport expiring in ${days} days`,
        body: `Hi ${p.user.firstName}, our records show your passport expires on ${p.passportExpiry.toLocaleDateString("en-AU")}. If you rely on your passport as your ID for hire, please update us with the new passport before your next booking.`,
        data: {
          windowDays: days,
          documentKind: "passport",
          expiryDate: p.passportExpiry.toISOString(),
        },
      });
      sent++;
    }
  }
  return sent;
}

/**
 * Run both the licence and passport expiry passes. Returns the total count
 * of notifications dispatched this run.
 */
export async function runIdentityExpiryAlerts(): Promise<number> {
  const now = new Date();
  const licenceCount = await runLicencePass(now);
  const passportCount = await runPassportPass(now);
  return licenceCount + passportCount;
}

/**
 * @deprecated Use `runIdentityExpiryAlerts`. Retained as a shim for any
 * external caller still importing the old name.
 */
export const runLicenceExpiryAlerts = runIdentityExpiryAlerts;

export function startLicenceExpiryScheduler() {
  registerWorker(QUEUE, async () => runIdentityExpiryAlerts());
  const q = getQueue(QUEUE);
  if (!q) return;
  q.add(
    "daily",
    {},
    { repeat: { pattern: "0 8 * * *", tz: "Australia/Brisbane" }, jobId: "repeat-daily" },
  );
}

/** New name. `startLicenceExpiryScheduler` is retained as an alias. */
export const startIdentityExpiryScheduler = startLicenceExpiryScheduler;
