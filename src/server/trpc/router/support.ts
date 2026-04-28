import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  createTRPCRouter,
  publicProcedure,
  protectedProcedure,
  staffProcedure,
  adminProcedure,
  trpcRateLimit,
} from "../trpc";
import { getSupportConfig } from "@/lib/support-config";
import { routeTicket } from "@/server/services/support-routing";
import { enqueueSupportNotify } from "@/server/jobs/support-notify";
import { generateTicketNumber } from "@/server/services/support-ticket-number";
import { scrubCardDigits } from "@/server/services/support-ai";
import { computeSupportMetrics } from "@/server/services/support-metrics";
import { recordIncidentForCustomer } from "@/server/services/revenue-aggregator";
import { generateIncidentNumber, withUniqueRetry } from "@/lib/id-gen";
import type { SupportTicketStatus } from "@prisma/client";
import {
  captureCustomerId,
  readCapturedCustomerId,
} from "@/server/services/audit";

const CategorySchema = z.enum(["ABANDONED_VEHICLE", "BREAKDOWN", "PAYMENT", "GENERAL"]);
const PrioritySchema = z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]);
const TicketStatusSchema = z.enum(["OPEN", "ASSIGNED", "PENDING_CUSTOMER", "RESOLVED", "CLOSED"]);
const FeedbackKindSchema = z.enum(["CSAT", "AI_HELPFUL", "AI_NOT_HELPFUL"]);

function ensureEnabled() {
  if (!getSupportConfig().enabled) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Support feature is disabled." });
  }
}

export const supportRouter = createTRPCRouter({
  // ---------------------------------------------------------------------
  // Public entry points — widget + guest checkout
  // ---------------------------------------------------------------------

  config: publicProcedure.query(() => {
    const cfg = getSupportConfig();
    return {
      enabled: cfg.enabled,
      aiEnabled: cfg.aiEnabled,
      feedbackEnabled: cfg.feedbackEnabled,
    };
  }),

  startConversation: publicProcedure
    .input(
      z.object({
        bookingReference: z.string().optional(),
        guest: z
          .object({
            name: z.string().min(1).max(120),
            email: z.string().email(),
            phone: z.string().optional(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      ensureEnabled();

      let customerId = ctx.session?.user?.id ?? null;
      let bookingId: string | null = null;
      let depotId: string | null = null;

      if (input.bookingReference) {
        const booking = await ctx.prisma.booking.findUnique({
          where: { bookingReference: input.bookingReference },
          select: { id: true, depotId: true, customerId: true },
        });
        if (booking) {
          bookingId = booking.id;
          depotId = booking.depotId;
          if (!customerId) customerId = booking.customerId;
        }
      }
      if (customerId && !depotId) {
        const latest = await ctx.prisma.booking.findFirst({
          where: { customerId },
          orderBy: { createdAt: "desc" },
          select: { depotId: true },
        });
        depotId = latest?.depotId ?? null;
      }

      const conv = await ctx.prisma.supportConversation.create({
        data: {
          customerId,
          bookingId,
          depotId,
          guestName: !customerId ? input.guest?.name : undefined,
          guestEmail: !customerId ? input.guest?.email : undefined,
          guestPhone: !customerId ? input.guest?.phone : undefined,
        },
      });
      return { conversationId: conv.id };
    }),

  myConversation: publicProcedure
    .input(z.object({ conversationId: z.string() }))
    .query(async ({ ctx, input }) => {
      const conv = await ctx.prisma.supportConversation.findUnique({
        where: { id: input.conversationId },
        include: {
          messages: { orderBy: { createdAt: "asc" } },
          ticket: true,
        },
      });
      if (!conv) throw new TRPCError({ code: "NOT_FOUND" });
      // Only allow the owning customer or a guest with the conversation id.
      if (conv.customerId && conv.customerId !== ctx.session?.user?.id) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      return conv;
    }),

  sendUserMessage: publicProcedure
    .input(
      z.object({
        conversationId: z.string(),
        body: z.string().min(1).max(4000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      ensureEnabled();
      const conv = await ctx.prisma.supportConversation.findUnique({
        where: { id: input.conversationId },
      });
      if (!conv) throw new TRPCError({ code: "NOT_FOUND" });
      if (conv.customerId && conv.customerId !== ctx.session?.user?.id) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const body = scrubCardDigits(input.body);
      await ctx.prisma.supportMessage.create({
        data: {
          conversationId: conv.id,
          senderRole: "CUSTOMER",
          body,
        },
      });
      await ctx.prisma.supportConversation.update({
        where: { id: conv.id },
        data: { lastMessageAt: new Date() },
      });
      return { ok: true };
    }),

  createTicket: publicProcedure
    .use(trpcRateLimit({ bucket: "support:create", limit: 10, windowSec: 60 * 60 }))
    .input(
      z.object({
        conversationId: z.string(),
        category: CategorySchema,
        summary: z.string().min(3).max(120),
        description: z.string().min(1).max(4000),
        urgency: z.boolean().default(false),
        photoKeys: z.array(z.string()).max(8).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      ensureEnabled();
      const conv = await ctx.prisma.supportConversation.findUnique({
        where: { id: input.conversationId },
      });
      if (!conv) throw new TRPCError({ code: "NOT_FOUND" });
      if (conv.customerId && conv.customerId !== ctx.session?.user?.id) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const description = scrubCardDigits(input.description);
      const routing = await routeTicket(ctx.prisma, {
        category: input.category,
        body: description,
        summary: input.summary,
        bookingId: conv.bookingId,
        customerId: conv.customerId,
        userMarkedUrgent: input.urgency,
      });
      const ticketNumber = await generateTicketNumber(ctx.prisma);
      const ticket = await ctx.prisma.supportTicket.create({
        data: {
          ticketNumber,
          conversationId: conv.id,
          category: input.category,
          priority: routing.priority,
          depotId: routing.depotId,
          assigneeId: routing.assigneeId,
          customerId: conv.customerId,
          linkedBookingId: conv.bookingId,
          summary: input.summary,
          description,
          status: routing.assigneeId ? "ASSIGNED" : "OPEN",
        },
      });
      await ctx.prisma.supportMessage.create({
        data: {
          conversationId: conv.id,
          senderRole: "SYSTEM",
          body: `Ticket ${ticketNumber} raised (${input.category}). ${
            routing.priority === "URGENT" ? "Marked URGENT — on-call notified." : "Depot staff notified."
          }`,
        },
      });
      await enqueueSupportNotify(
        { ticketId: ticket.id, event: "ticket_created" },
        { priorityJob: routing.priority === "URGENT" },
      );
      return { ticketId: ticket.id, ticketNumber, priority: ticket.priority };
    }),

  submitFeedback: publicProcedure
    .input(
      z.object({
        conversationId: z.string(),
        kind: FeedbackKindSchema,
        rating: z.number().int().min(0).max(5),
        comment: z.string().max(1000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      ensureEnabled();
      const conv = await ctx.prisma.supportConversation.findUnique({
        where: { id: input.conversationId },
        include: { ticket: true },
      });
      if (!conv) throw new TRPCError({ code: "NOT_FOUND" });
      if (conv.customerId && conv.customerId !== ctx.session?.user?.id) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      // Idempotent per (conversationId, kind) via the unique constraint.
      await ctx.prisma.supportFeedback.upsert({
        where: {
          conversationId_kind: { conversationId: conv.id, kind: input.kind },
        },
        create: {
          conversationId: conv.id,
          ticketId: conv.ticket?.id ?? null,
          kind: input.kind,
          rating: input.rating,
          comment: input.comment,
        },
        update: { rating: input.rating, comment: input.comment },
      });
      return { ok: true };
    }),

  // ---------------------------------------------------------------------
  // Customer portal
  // ---------------------------------------------------------------------

  myTickets: protectedProcedure
    .input(
      z
        .object({
          status: TicketStatusSchema.optional(),
          cursor: z.string().optional(),
          take: z.number().min(1).max(50).default(20),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const take = input?.take ?? 20;
      const items = await ctx.prisma.supportTicket.findMany({
        where: {
          customerId: ctx.user.id,
          ...(input?.status ? { status: input.status } : {}),
        },
        include: { depot: true, linkedBooking: true },
        take: take + 1,
        ...(input?.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        orderBy: { createdAt: "desc" },
      });
      const nextCursor = items.length > take ? items.pop()!.id : null;
      return { items, nextCursor };
    }),

  myTicketDetail: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const t = await ctx.prisma.supportTicket.findUnique({
        where: { id: input.id },
        include: {
          depot: true,
          linkedBooking: true,
          conversation: {
            include: {
              messages: {
                where: { isInternalNote: false },
                orderBy: { createdAt: "asc" },
              },
            },
          },
          feedback: true,
        },
      });
      if (!t) throw new TRPCError({ code: "NOT_FOUND" });
      if (t.customerId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN" });
      return t;
    }),

  // ---------------------------------------------------------------------
  // Staff back-office
  // ---------------------------------------------------------------------

  listTickets: staffProcedure
    .input(
      z
        .object({
          status: TicketStatusSchema.optional(),
          category: CategorySchema.optional(),
          priority: PrioritySchema.optional(),
          depotId: z.string().optional(),
          assigneeId: z.string().optional(),
          take: z.number().min(1).max(100).default(25),
          cursor: z.string().optional(),
        })
        .default({}),
    )
    .query(async ({ ctx, input }) => {
      const scope = input;
      const take = scope.take ?? 25;
      // Depot scope: STAFF limited to their own depot; MANAGER+ can filter.
      const userRole = ctx.user.role;
      const userDepot = ctx.user.depotId ?? null;
      let depotFilter = scope.depotId;
      if (userRole === "STAFF") {
        depotFilter = userDepot ?? undefined;
      }
      const items = await ctx.prisma.supportTicket.findMany({
        where: {
          ...(scope.status ? { status: scope.status } : {}),
          ...(scope.category ? { category: scope.category } : {}),
          ...(scope.priority ? { priority: scope.priority } : {}),
          ...(depotFilter ? { depotId: depotFilter } : {}),
          ...(scope.assigneeId ? { assigneeId: scope.assigneeId } : {}),
        },
        include: {
          depot: true,
          assignee: { select: { id: true, firstName: true, lastName: true } },
          customer: { select: { id: true, firstName: true, lastName: true, email: true } },
          conversation: { select: { id: true, guestName: true, guestEmail: true } },
        },
        take: take + 1,
        ...(scope.cursor ? { cursor: { id: scope.cursor }, skip: 1 } : {}),
        orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
      });
      const nextCursor = items.length > take ? items.pop()!.id : null;
      return { items, nextCursor };
    }),

  ticketDetail: staffProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const t = await ctx.prisma.supportTicket.findUnique({
        where: { id: input.id },
        include: {
          depot: true,
          assignee: { select: { id: true, firstName: true, lastName: true, email: true } },
          customer: true,
          linkedBooking: true,
          linkedIncident: true,
          conversation: {
            include: {
              messages: { orderBy: { createdAt: "asc" } },
              customer: true,
            },
          },
          notes: {
            include: { user: { select: { id: true, firstName: true, lastName: true } } },
            orderBy: { createdAt: "desc" },
          },
          feedback: true,
        },
      });
      if (!t) throw new TRPCError({ code: "NOT_FOUND" });
      // Enforce depot scope for STAFF (MANAGER+ see everything).
      if (ctx.user.role === "STAFF" && t.depotId && t.depotId !== ctx.user.depotId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      return t;
    }),

  addReply: staffProcedure
    .input(
      z.object({
        id: z.string(),
        body: z.string().min(1).max(4000),
        asInternalNote: z.boolean().default(false),
      }),
    )
    .meta({ audit: { customerIdPath: readCapturedCustomerId } })
    .mutation(async ({ ctx, input }) => {
      const t = await ctx.prisma.supportTicket.findUnique({
        where: { id: input.id },
      });
      if (!t) throw new TRPCError({ code: "NOT_FOUND" });
      captureCustomerId(ctx, t.customerId);
      if (input.asInternalNote) {
        await ctx.prisma.supportTicketNote.create({
          data: {
            ticketId: t.id,
            userId: ctx.user.id,
            body: input.body,
            isInternal: true,
          },
        });
        return { ok: true, internal: true };
      }
      await ctx.prisma.supportMessage.create({
        data: {
          conversationId: t.conversationId,
          senderRole: "STAFF",
          senderUserId: ctx.user.id,
          body: input.body,
        },
      });
      const updateData: {
        updatedAt: Date;
        firstResponseAt?: Date;
        status?: SupportTicketStatus;
      } = { updatedAt: new Date() };
      if (!t.firstResponseAt) updateData.firstResponseAt = new Date();
      if (t.status === "OPEN") updateData.status = "ASSIGNED";
      await ctx.prisma.supportTicket.update({ where: { id: t.id }, data: updateData });
      await ctx.prisma.supportConversation.update({
        where: { id: t.conversationId },
        data: { lastMessageAt: new Date() },
      });
      await enqueueSupportNotify({ ticketId: t.id, event: "ticket_customer_reply" });
      return { ok: true, internal: false };
    }),

  assignTicket: staffProcedure
    .input(z.object({ id: z.string(), assigneeId: z.string() }))
    .meta({ audit: { customerIdPath: readCapturedCustomerId } })
    .mutation(async ({ ctx, input }) => {
      const t = await ctx.prisma.supportTicket.findUnique({
        where: { id: input.id },
      });
      if (!t) throw new TRPCError({ code: "NOT_FOUND" });
      captureCustomerId(ctx, t.customerId);
      await ctx.prisma.supportTicket.update({
        where: { id: t.id },
        data: {
          assigneeId: input.assigneeId,
          status: t.status === "OPEN" ? "ASSIGNED" : t.status,
        },
      });
      await enqueueSupportNotify({ ticketId: t.id, event: "ticket_assigned" });
      return { ok: true };
    }),

  setPriority: staffProcedure
    .input(z.object({ id: z.string(), priority: PrioritySchema }))
    .meta({ audit: { customerIdPath: readCapturedCustomerId } })
    .mutation(async ({ ctx, input }) => {
      const t = await ctx.prisma.supportTicket.findUnique({
        where: { id: input.id },
        select: { customerId: true },
      });
      captureCustomerId(ctx, t?.customerId);
      return ctx.prisma.supportTicket.update({
        where: { id: input.id },
        data: { priority: input.priority },
      });
    }),

  setStatus: staffProcedure
    .input(z.object({ id: z.string(), status: TicketStatusSchema }))
    .meta({ audit: { customerIdPath: readCapturedCustomerId } })
    .mutation(async ({ ctx, input }) => {
      const ticket = await ctx.prisma.supportTicket.findUnique({
        where: { id: input.id },
        select: { customerId: true },
      });
      captureCustomerId(ctx, ticket?.customerId);
      const data: {
        status: SupportTicketStatus;
        resolvedAt?: Date;
        closedAt?: Date;
      } = { status: input.status };
      if (input.status === "RESOLVED") data.resolvedAt = new Date();
      if (input.status === "CLOSED") data.closedAt = new Date();
      const updated = await ctx.prisma.supportTicket.update({
        where: { id: input.id },
        data,
      });
      if (input.status === "RESOLVED") {
        await enqueueSupportNotify({
          ticketId: updated.id,
          event: "ticket_resolved",
        });
      }
      return updated;
    }),

  createLinkedIncident: staffProcedure
    .input(
      z.object({
        id: z.string(),
        severity: z.enum(["MINOR", "MODERATE", "MAJOR", "TOTAL_LOSS"]).default("MINOR"),
        description: z.string().min(1).max(2000).optional(),
      }),
    )
    .meta({ audit: { customerIdPath: readCapturedCustomerId } })
    .mutation(async ({ ctx, input }) => {
      const t = await ctx.prisma.supportTicket.findUnique({
        where: { id: input.id },
        include: { linkedBooking: true },
      });
      if (!t) throw new TRPCError({ code: "NOT_FOUND" });
      captureCustomerId(ctx, t.customerId);
      if (!t.linkedBooking?.vehicleId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Linked booking with a vehicle is required to create an incident.",
        });
      }
      const incidentType = t.category === "BREAKDOWN" ? "BREAKDOWN" : "OTHER";
      const incident = await withUniqueRetry(
        () =>
          ctx.prisma.$transaction(async (tx) => {
            const inc = await tx.incident.create({
              data: {
                incidentNumber: generateIncidentNumber(),
                vehicleId: t.linkedBooking!.vehicleId!,
                bookingId: t.linkedBooking!.id,
                customerId: t.customerId,
                type: incidentType,
                severity: input.severity,
                dateTime: new Date(),
                description: input.description ?? t.description,
                reportedById: ctx.user.id,
              },
            });
            await recordIncidentForCustomer(tx, t.customerId);
            await tx.supportTicket.update({
              where: { id: t.id },
              data: { linkedIncidentId: inc.id },
            });
            return inc;
          }),
        { constraintFields: ["incidentNumber"] },
      );
      return incident;
    }),

  // Pending-work tile on the staff dashboard.
  dashboardPending: staffProcedure.query(async ({ ctx }) => {
    const depotId = ctx.user.depotId;
    const where = {
      status: { in: ["OPEN", "ASSIGNED", "PENDING_CUSTOMER"] as SupportTicketStatus[] },
      ...(ctx.user.role === "STAFF" && depotId ? { depotId } : {}),
    };
    const [total, urgent, high, oldest] = await Promise.all([
      ctx.prisma.supportTicket.count({ where }),
      ctx.prisma.supportTicket.count({ where: { ...where, priority: "URGENT" } }),
      ctx.prisma.supportTicket.count({ where: { ...where, priority: "HIGH" } }),
      ctx.prisma.supportTicket.findMany({
        where,
        include: {
          customer: { select: { firstName: true, lastName: true } },
          conversation: { select: { guestName: true } },
          depot: { select: { name: true } },
        },
        orderBy: { createdAt: "asc" },
        take: 5,
      }),
    ]);
    return { total, urgent, high, oldest };
  }),

  stats: staffProcedure.query(async ({ ctx }) => {
    const depotId = ctx.user.depotId;
    const openStatuses: SupportTicketStatus[] = ["OPEN", "ASSIGNED", "PENDING_CUSTOMER"];
    const where = {
      status: { in: openStatuses },
      ...(ctx.user.role === "STAFF" && depotId ? { depotId } : {}),
    };

    const now = new Date();
    const day = 86400000;
    const under24 = new Date(now.getTime() - day);
    const under3d = new Date(now.getTime() - 3 * day);

    const [open, byPriorityRaw, byCategoryRaw, under24h, under3dCount, over3dCount, unassigned, oldest] =
      await Promise.all([
        ctx.prisma.supportTicket.count({ where }),
        ctx.prisma.supportTicket.groupBy({
          by: ["priority"],
          where,
          _count: { _all: true },
        }),
        ctx.prisma.supportTicket.groupBy({
          by: ["category"],
          where,
          _count: { _all: true },
        }),
        ctx.prisma.supportTicket.count({ where: { ...where, createdAt: { gte: under24 } } }),
        ctx.prisma.supportTicket.count({
          where: { ...where, createdAt: { gte: under3d, lt: under24 } },
        }),
        ctx.prisma.supportTicket.count({ where: { ...where, createdAt: { lt: under3d } } }),
        ctx.prisma.supportTicket.count({ where: { ...where, assigneeId: null } }),
        ctx.prisma.supportTicket.findFirst({
          where,
          orderBy: { createdAt: "asc" },
          select: { createdAt: true },
        }),
      ]);

    const priorityMap: Record<string, number> = {};
    for (const r of byPriorityRaw) priorityMap[r.priority] = r._count._all;
    const categoryMap: Record<string, number> = {};
    for (const r of byCategoryRaw) categoryMap[r.category] = r._count._all;

    return {
      open,
      unassigned,
      byPriority: {
        low: priorityMap.LOW ?? 0,
        normal: priorityMap.NORMAL ?? 0,
        high: priorityMap.HIGH ?? 0,
        urgent: priorityMap.URGENT ?? 0,
      },
      byCategory: categoryMap,
      aged: { under24h, under3d: under3dCount, over3d: over3dCount },
      oldestOpenAt: oldest?.createdAt?.toISOString() ?? null,
    };
  }),

  customerTickets: staffProcedure
    .input(z.object({ customerId: z.string() }))
    .query(async ({ ctx, input }) =>
      ctx.prisma.supportTicket.findMany({
        where: { customerId: input.customerId },
        include: { depot: true, linkedBooking: { select: { bookingReference: true } } },
        orderBy: { createdAt: "desc" },
      }),
    ),

  // ---------------------------------------------------------------------
  // Admin metrics + PAYMENT handoff
  // ---------------------------------------------------------------------

  escalateToAdmin: staffProcedure
    .input(z.object({ id: z.string(), reason: z.string().min(1).max(500) }))
    .meta({ audit: { customerIdPath: readCapturedCustomerId } })
    .mutation(async ({ ctx, input }) => {
      const t = await ctx.prisma.supportTicket.findUnique({
        where: { id: input.id },
      });
      if (!t) throw new TRPCError({ code: "NOT_FOUND" });
      captureCustomerId(ctx, t.customerId);
      await ctx.prisma.supportTicketNote.create({
        data: {
          ticketId: t.id,
          userId: ctx.user.id,
          body: `Escalated to admin. Reason: ${input.reason}`,
          isInternal: true,
        },
      });
      await ctx.prisma.supportTicket.update({
        where: { id: t.id },
        data: { category: "PAYMENT", depotId: null, assigneeId: null, status: "OPEN" },
      });
      await enqueueSupportNotify({ ticketId: t.id, event: "ticket_created" });
      return { ok: true };
    }),

  adminMetrics: adminProcedure
    .input(
      z.object({
        from: z.coerce.date(),
        to: z.coerce.date(),
        depotId: z.string().optional(),
        category: CategorySchema.optional(),
      }),
    )
    .query(async ({ ctx, input }) =>
      computeSupportMetrics(ctx.prisma, {
        from: input.from,
        to: input.to,
        depotId: input.depotId,
        category: input.category,
      }),
    ),

  adminStats: adminProcedure
    .input(
      z.object({
        from: z.coerce.date(),
        to: z.coerce.date(),
        depotId: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const metrics = await computeSupportMetrics(ctx.prisma, {
        from: input.from,
        to: input.to,
        depotId: input.depotId,
      });
      const byPriorityRaw = await ctx.prisma.supportTicket.groupBy({
        by: ["priority"],
        where: {
          createdAt: { gte: input.from, lte: input.to },
          ...(input.depotId ? { depotId: input.depotId } : {}),
        },
        _count: { _all: true },
      });
      const priorityMap: Record<string, number> = {};
      for (const r of byPriorityRaw) priorityMap[r.priority] = r._count._all;
      return {
        ticketsOpened: metrics.ticketsOpened,
        byPriority: {
          low: priorityMap.LOW ?? 0,
          normal: priorityMap.NORMAL ?? 0,
          high: priorityMap.HIGH ?? 0,
          urgent: priorityMap.URGENT ?? 0,
        },
        avgFirstResponseMinutes: metrics.avgFirstResponseMinutes,
        avgResolutionMinutes: metrics.avgResolutionMinutes,
        csat: metrics.csat,
        aiDeflectionRate: metrics.aiDeflectionRate,
        aiHelpfulRate: metrics.aiHelpfulRate,
        llmCostAud: metrics.llmCostAud,
        llmCostAudLast24h: metrics.llmCostAudLast24h,
      };
    }),

  listDepotStaff: staffProcedure
    .input(z.object({ depotId: z.string().optional() }).optional())
    .query(({ ctx, input }) =>
      ctx.prisma.user.findMany({
        where: {
          role: { in: ["STAFF", "MANAGER"] },
          status: "ACTIVE",
          ...(input?.depotId ? { depotId: input.depotId } : {}),
        },
        select: { id: true, firstName: true, lastName: true, email: true, role: true, depotId: true },
        orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      }),
    ),
});
