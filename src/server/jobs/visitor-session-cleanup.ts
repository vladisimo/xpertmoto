import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { getQueue, registerWorker } from "./queue";
import { scoreEngagement } from "@/lib/analytics/engagement";

const QUEUE = "visitor-session-cleanup" as const;
const ORPHAN_RETENTION_DAYS = 30;
const IP_HASH_RETENTION_DAYS = 30;
const PAGE_VIEW_RETENTION_DAYS = 90;
const EVENT_RETENTION_DAYS = 60;
const FINALISE_IDLE_MS = 10 * 60 * 1000;
export const ATTRIBUTION_WINDOW_MS = 72 * 60 * 60 * 1000;
const BOUNCE_DURATION_S = 15;

/**
 * Pure outcome-derivation logic — extracted so it can be unit tested
 * without a Prisma connection. Rules must match the finalise pass below.
 */
export function deriveVisitorOutcome(input: {
  totalPageViews: number;
  durationSeconds: number;
  wizardHighestStep: number | null;
  convertedBookingId: string | null;
}): "BOUNCED" | "ABANDONED_WIZARD" | "CONVERTED" | "LEFT" {
  if (input.convertedBookingId) return "CONVERTED";
  if (input.totalPageViews <= 1 && input.durationSeconds < BOUNCE_DURATION_S) return "BOUNCED";
  if ((input.wizardHighestStep ?? 0) >= 1) return "ABANDONED_WIZARD";
  return "LEFT";
}

/**
 * Pure interaction-outcome derivation. Same rules as the finalise pass.
 */
export function deriveInteractionOutcome(input: {
  attributedBookingId: string | null;
  staffMessageCount: number;
  lastSenderRole: "CUSTOMER" | "STAFF" | "AI" | "SYSTEM" | null;
}): "CONVERTED" | "NO_RESPONSE" | "ABANDONED" | "RESOLVED" {
  if (input.attributedBookingId) return "CONVERTED";
  if (input.staffMessageCount === 0) return "NO_RESPONSE";
  if (input.lastSenderRole === "CUSTOMER") return "ABANDONED";
  return "RESOLVED";
}

/**
 * Finalises `VisitorSession` rows idle for ≥10 minutes: computes duration,
 * closes the last open page view, derives `outcome` and attributes a
 * `convertedBookingId` when a matching Booking was created within 72h of
 * `lastSeenAt`. Idempotent — only touches rows with `endedAt IS NULL`.
 *
 * Booking attribution is gated on `wizardHighestStep >= 1` — a logged-in
 * user browsing unrelated pages then booking via another session will not
 * be wrongly attributed to this one.
 */
export async function runVisitorSessionFinalise(): Promise<{ finalised: number }> {
  const cutoff = new Date(Date.now() - FINALISE_IDLE_MS);
  const pending = await prisma.visitorSession.findMany({
    where: { endedAt: null, lastSeenAt: { lt: cutoff } },
    select: {
      id: true,
      userId: true,
      startedAt: true,
      lastSeenAt: true,
      totalPageViews: true,
      wizardHighestStep: true,
    },
    take: 500,
  });
  let finalised = 0;
  for (const s of pending) {
    const durationSeconds = Math.max(
      0,
      Math.round((s.lastSeenAt.getTime() - s.startedAt.getTime()) / 1000),
    );
    let convertedBookingId: string | null = null;
    if (s.userId && (s.wizardHighestStep ?? 0) >= 1) {
      const booking = await prisma.booking.findFirst({
        where: {
          customerId: s.userId,
          createdAt: {
            gte: s.startedAt,
            lte: new Date(s.lastSeenAt.getTime() + ATTRIBUTION_WINDOW_MS),
          },
        },
        select: { id: true },
        orderBy: { createdAt: "asc" },
      });
      convertedBookingId = booking?.id ?? null;
    }
    const outcome = deriveVisitorOutcome({
      totalPageViews: s.totalPageViews,
      durationSeconds,
      wizardHighestStep: s.wizardHighestStep,
      convertedBookingId,
    });

    await prisma.visitorPageView.updateMany({
      where: { sessionId: s.id, leftAt: null },
      data: { leftAt: s.lastSeenAt },
    });

    // Aggregate engagement signals from this session's events. Two
    // cheap queries (count + max) stay off the per-row hot path
    // because the finalise pass runs every few minutes, not per
    // heartbeat.
    const [eventCount, scrollMaxRow] = await Promise.all([
      prisma.visitorEvent.count({ where: { sessionId: s.id } }),
      prisma.visitorEvent.aggregate({
        where: { sessionId: s.id, kind: "SCROLL_DEPTH", numericValue: { not: null } },
        _max: { numericValue: true },
      }),
    ]);
    const maxScrollDepth = scrollMaxRow._max.numericValue ?? null;
    const engagementScore = scoreEngagement({
      durationSeconds,
      totalPageViews: s.totalPageViews,
      eventCount,
      maxScrollDepth,
      wizardHighestStep: s.wizardHighestStep,
      converted: !!convertedBookingId,
    });

    await prisma.visitorSession.update({
      where: { id: s.id },
      data: {
        endedAt: s.lastSeenAt,
        durationSeconds,
        outcome,
        convertedBookingId,
        maxScrollDepth,
        engagementScore,
      },
    });
    finalised++;
  }
  return { finalised };
}

/**
 * Finalises `SupportConversation` rows that have been quiet for ≥72h —
 * computes `firstStaffResponseAt`, `firstResponseSeconds`, attributes a
 * booking, and assigns the `interactionOutcome`. Idempotent.
 */
export async function runSupportConversationFinalise(): Promise<{ finalised: number }> {
  const cutoff = new Date(Date.now() - ATTRIBUTION_WINDOW_MS);
  const pending = await prisma.supportConversation.findMany({
    where: { interactionOutcome: null, lastMessageAt: { lt: cutoff } },
    select: {
      id: true,
      customerId: true,
      createdAt: true,
      lastMessageAt: true,
    },
    take: 500,
  });
  let finalised = 0;
  for (const c of pending) {
    const messages = await prisma.supportMessage.findMany({
      where: { conversationId: c.id },
      select: { senderRole: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    const firstStaff = messages.find((m) => m.senderRole === "STAFF");
    const firstStaffResponseAt = firstStaff?.createdAt ?? null;
    const firstResponseSeconds = firstStaffResponseAt
      ? Math.max(0, Math.round((firstStaffResponseAt.getTime() - c.createdAt.getTime()) / 1000))
      : null;

    let attributedBookingId: string | null = null;
    if (c.customerId) {
      const booking = await prisma.booking.findFirst({
        where: {
          customerId: c.customerId,
          createdAt: {
            gte: c.createdAt,
            lte: new Date(c.lastMessageAt.getTime() + ATTRIBUTION_WINDOW_MS),
          },
        },
        select: { id: true },
        orderBy: { createdAt: "asc" },
      });
      attributedBookingId = booking?.id ?? null;
    }

    const staffMessageCount = messages.filter((m) => m.senderRole === "STAFF").length;
    const lastSenderRole = messages[messages.length - 1]?.senderRole ?? null;
    const outcome = deriveInteractionOutcome({
      attributedBookingId,
      staffMessageCount,
      lastSenderRole,
    });

    await prisma.supportConversation.update({
      where: { id: c.id },
      data: {
        firstStaffResponseAt,
        firstResponseSeconds,
        attributedBookingId,
        interactionOutcome: outcome,
      },
    });
    finalised++;
  }
  return { finalised };
}

/**
 * Prunes orphan `VisitorSession` rows (no attached conversation) that
 * haven't been seen in ≥30 days, drops stored `ipHash` values older than
 * 30 days, prunes `VisitorPageView` rows older than 90 days, and prunes
 * `VisitorEvent` rows older than 60 days.
 */
export async function runVisitorSessionCleanup(): Promise<{
  deleted: number;
  ipHashesPurged: number;
  pageViewsDeleted: number;
  eventsDeleted: number;
  finalisedSessions: number;
  finalisedConversations: number;
}> {
  const { finalised: finalisedSessions } = await runVisitorSessionFinalise();
  const { finalised: finalisedConversations } = await runSupportConversationFinalise();

  const orphanCutoff = new Date(Date.now() - ORPHAN_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const ipCutoff = new Date(Date.now() - IP_HASH_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const pageViewCutoff = new Date(Date.now() - PAGE_VIEW_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const eventCutoff = new Date(Date.now() - EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const deleted = await prisma.visitorSession.deleteMany({
    where: { conversationId: null, lastSeenAt: { lt: orphanCutoff } },
  });

  const ipHashesPurged = await prisma.visitorSession.updateMany({
    where: { ipHash: { not: null }, lastSeenAt: { lt: ipCutoff } },
    data: { ipHash: null },
  });

  const pageViewsDeleted = await prisma.visitorPageView.deleteMany({
    where: { enteredAt: { lt: pageViewCutoff } },
  });

  const eventsDeleted = await prisma.visitorEvent.deleteMany({
    where: { occurredAt: { lt: eventCutoff } },
  });

  logger.info(
    {
      deleted: deleted.count,
      ipHashesPurged: ipHashesPurged.count,
      pageViewsDeleted: pageViewsDeleted.count,
      eventsDeleted: eventsDeleted.count,
      finalisedSessions,
      finalisedConversations,
    },
    "visitor-session-cleanup: completed",
  );
  return {
    deleted: deleted.count,
    ipHashesPurged: ipHashesPurged.count,
    pageViewsDeleted: pageViewsDeleted.count,
    eventsDeleted: eventsDeleted.count,
    finalisedSessions,
    finalisedConversations,
  };
}

export function startVisitorSessionCleanupScheduler() {
  registerWorker(QUEUE, async () => runVisitorSessionCleanup());
  const q = getQueue(QUEUE);
  if (!q) return;
  q.add(
    "daily",
    {},
    {
      repeat: { pattern: "17 3 * * *", tz: "Australia/Brisbane" },
      jobId: "visitor-session-cleanup-daily",
    },
  );
}
