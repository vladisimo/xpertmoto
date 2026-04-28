/**
 * Ticket routing — decides depot, assignee, priority, and the notify plan
 * for a new SupportTicket. Pure business logic kept out of the tRPC
 * router so it's trivially unit-testable.
 *
 * Depot inference cascade:
 *   1. explicit depotId if the caller passed one
 *   2. booking.depotId when a booking is linked
 *   3. customer's most recent booking depotId
 *   4. null → PAYMENT pool or unassigned bucket
 *
 * Assignment: round-robin among active STAFF/MANAGER at the depot,
 * ordered by (openTicketCount ASC, lastAssignedAt ASC) so load balances
 * naturally without a cron job.
 */

import type { PrismaClient, SupportCategory } from "@prisma/client";
import { resolveChannels, type ChannelPlan } from "./support-channel-matrix";
import { mentionsRoadsideBreakdown } from "./support-ai";

export type RouteTicketInput = {
  category: SupportCategory;
  body: string;
  summary: string;
  explicitDepotId?: string | null;
  bookingId?: string | null;
  customerId?: string | null;
  /** Caller's explicit urgency flag — e.g. form checkbox. */
  userMarkedUrgent?: boolean;
  /** Used during testing to pin "now"; falls back to Date.now(). */
  now?: Date;
};

export type RouteTicketOutput = {
  depotId: string | null;
  assigneeId: string | null;
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  channels: ChannelPlan;
  outsideHours: boolean;
  onCallUserId: string | null;
  adminPoolUserIds: string[];
};

export async function routeTicket(
  prisma: PrismaClient,
  input: RouteTicketInput,
): Promise<RouteTicketOutput> {
  const now = input.now ?? new Date();
  const depotId = await resolveDepotId(prisma, input);

  const priority = resolvePriority(input);
  const outsideHours = depotId ? !(await isWithinOperatingHours(prisma, depotId, now)) : false;

  let assigneeId: string | null = null;
  let onCallUserId: string | null = null;
  if (depotId && (input.category === "BREAKDOWN" || input.category === "ABANDONED_VEHICLE")) {
    assigneeId = await pickAssignee(prisma, depotId);
    onCallUserId = await resolveOnCall(prisma, depotId);
  }

  const adminPoolUserIds =
    input.category === "PAYMENT" ? await listAdminPool(prisma) : [];

  const channels = resolveChannels({ category: input.category, priority, outsideHours });

  return {
    depotId,
    assigneeId,
    priority,
    channels,
    outsideHours,
    onCallUserId,
    adminPoolUserIds,
  };
}

function resolvePriority(input: RouteTicketInput): "LOW" | "NORMAL" | "HIGH" | "URGENT" {
  if (input.category === "GENERAL") return "LOW";
  if (input.category === "PAYMENT") return "NORMAL";
  // BREAKDOWN / ABANDONED_VEHICLE
  if (input.userMarkedUrgent || mentionsRoadsideBreakdown(input.body)) return "URGENT";
  return "HIGH";
}

async function resolveDepotId(
  prisma: PrismaClient,
  input: RouteTicketInput,
): Promise<string | null> {
  if (input.explicitDepotId) return input.explicitDepotId;
  if (input.bookingId) {
    const b = await prisma.booking.findUnique({
      where: { id: input.bookingId },
      select: { depotId: true },
    });
    if (b?.depotId) return b.depotId;
  }
  if (input.customerId) {
    const latest = await prisma.booking.findFirst({
      where: { customerId: input.customerId },
      orderBy: { createdAt: "desc" },
      select: { depotId: true },
    });
    if (latest?.depotId) return latest.depotId;
  }
  return null;
}

async function pickAssignee(prisma: PrismaClient, depotId: string): Promise<string | null> {
  const candidates = await prisma.user.findMany({
    where: {
      depotId,
      role: { in: ["STAFF", "MANAGER"] },
      status: "ACTIVE",
    },
    select: {
      id: true,
      _count: {
        select: {
          supportTicketsAsAssignee: {
            where: { status: { in: ["OPEN", "ASSIGNED", "PENDING_CUSTOMER"] } },
          },
        },
      },
    },
  });
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a._count.supportTicketsAsAssignee - b._count.supportTicketsAsAssignee);
  return candidates[0]!.id;
}

async function resolveOnCall(
  prisma: PrismaClient,
  depotId: string,
): Promise<string | null> {
  const depot = await prisma.depot.findUnique({
    where: { id: depotId },
    select: { onCallUserId: true },
  });
  if (depot?.onCallUserId) return depot.onCallUserId;
  const mgr = await prisma.user.findFirst({
    where: { depotId, role: "MANAGER", status: "ACTIVE" },
    select: { id: true },
  });
  return mgr?.id ?? null;
}

async function listAdminPool(prisma: PrismaClient): Promise<string[]> {
  const rows = await prisma.user.findMany({
    where: { role: { in: ["ADMIN", "SUPER_ADMIN"] }, status: "ACTIVE" },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/**
 * Fast operating-hours check. Reads the DepotOperatingHours row for
 * the current weekday and compares HH:mm strings. Timezone respected
 * via `depot.timezone` — we format `now` into that tz and compare.
 */
export async function isWithinOperatingHours(
  prisma: PrismaClient,
  depotId: string,
  now: Date,
): Promise<boolean> {
  const depot = await prisma.depot.findUnique({
    where: { id: depotId },
    select: { timezone: true },
  });
  const tz = depot?.timezone ?? "Australia/Brisbane";
  const local = new Intl.DateTimeFormat("en-AU", {
    timeZone: tz,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const weekdayStr = local.find((p) => p.type === "weekday")?.value ?? "Mon";
  const hourStr = local.find((p) => p.type === "hour")?.value ?? "09";
  const minStr = local.find((p) => p.type === "minute")?.value ?? "00";
  const dow = weekdayMap[weekdayStr] ?? 1;
  const nowHhMm = `${hourStr.padStart(2, "0")}:${minStr}`;

  const hours = await prisma.depotOperatingHours.findFirst({
    where: { depotId, dayOfWeek: dow },
  });
  if (!hours || hours.isClosed) return false;
  return nowHhMm >= hours.openTime && nowHhMm < hours.closeTime;
}
