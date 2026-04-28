import { TRPCError } from "@trpc/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";

import { htmlToText } from "@/lib/email";
import { segmentCreateSchema, segmentFiltersSchema } from "@/lib/validators/segment";
import {
  categoryForType,
} from "@/server/services/consent";
import {
  sendNotification,
  type AttachmentRef,
} from "@/server/services/notification-sender";
import {
  buildSegmentWhere,
  evaluateSegment,
} from "@/server/services/segment-evaluator";
import { skipAutoAudit, writeAuditAsync } from "@/server/services/audit";

import {
  adminProcedure,
  createTRPCRouter,
  managerProcedure,
  staffProcedure,
} from "../trpc";

const channelEnum = z.enum(["EMAIL", "SMS", "IN_APP", "PUSH"]);
const templateFormatEnum = z.enum(["PLAIN_TEXT", "HTML"]);
const notificationTypeEnum = z.enum([
  "BOOKING_CONFIRMATION",
  "BOOKING_MODIFIED",
  "BOOKING_EXTENDED",
  "BOOKING_CANCELLED",
  "BOOKING_REMINDER",
  "BOOKING_CHECKED_OUT",
  "BOOKING_DUE_TODAY",
  "BOOKING_OVERDUE",
  "BOOKING_OVERDUE_ESCALATION",
  "BOOKING_NO_SHOW_WARNING",
  "BOOKING_COMPLETED",
  "PAYMENT_RECEIVED",
  "INVOICE_ISSUED",
  "BOND_HELD",
  "BOND_RELEASED",
  "BOND_CAPTURED",
  "LEASE_AGREEMENT_COPY",
  "RETURN_PAPERWORK_COPY",
  "INSPECTION_REPORT_COPY",
  "PROFILE_UPDATED_SELF",
  "PROFILE_UPDATED_STAFF",
  "LICENCE_EXPIRING",
  "INCIDENT_REPORTED",
  "INFRINGEMENT_NOMINATED",
  "WORK_ORDER_ASSIGNED",
  "VEHICLE_EXPIRY",
  "REGO_EXPIRING",
  "LOW_FLEET_AVAILABILITY",
  "DAILY_OPS_SUMMARY",
  "WEEKLY_REVENUE_SUMMARY",
  "NEW_CUSTOMER_REGISTERED",
  "MARKETING_PROMOTIONAL",
  "MARKETING_NEWSLETTER",
  "MARKETING_WINBACK",
  "MARKETING_BIRTHDAY",
  "MARKETING_ANNIVERSARY",
  "SUPPORT_TICKET_ASSIGNED",
  "SUPPORT_TICKET_URGENT",
  "SUPPORT_TICKET_CUSTOMER_REPLY",
  "SUPPORT_TICKET_RESOLVED",
  "CUSTOM",
]);
const categoryEnum = z.enum(["TRANSACTIONAL", "ACCOUNT", "OPERATIONAL", "MARKETING"]);
const campaignStatusEnum = z.enum([
  "DRAFT",
  "SCHEDULED",
  "SENDING",
  "SENT",
  "CANCELLED",
  "FAILED",
]);
const recipientStatusEnum = z.enum([
  "PENDING",
  "SENT",
  "DELIVERED",
  "BOUNCED",
  "FAILED",
  "OPT_OUT",
  "UNSUBSCRIBED",
]);

/**
 * CommunicationLog.attachmentRefs is JSON, written by both the current
 * AttachmentRef shape and the legacy variants (lease-agreement /
 * return-paperwork / inspection-report). Strip down to what the resolver
 * understands today; legacy entries are silently dropped on resend so a
 * historical log row still sends — just without the documents the new
 * resolver can't fetch.
 */
function parseLoggedAttachmentRefs(raw: unknown): AttachmentRef[] {
  if (!Array.isArray(raw)) return [];
  const out: AttachmentRef[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const kind = r.kind;
    if (kind === "invoice" && typeof r.invoiceId === "string") {
      out.push({ kind: "invoice", invoiceId: r.invoiceId });
    } else if (
      kind === "adjustment-note" &&
      typeof r.adjustmentNoteId === "string"
    ) {
      out.push({ kind: "adjustment-note", adjustmentNoteId: r.adjustmentNoteId });
    } else if (
      kind === "rental-agreement" &&
      typeof r.agreementId === "string"
    ) {
      out.push({ kind: "rental-agreement", agreementId: r.agreementId });
    } else if (
      kind === "return-assessment" &&
      typeof r.assessmentId === "string"
    ) {
      out.push({ kind: "return-assessment", assessmentId: r.assessmentId });
    } else if (kind === "receipt" && typeof r.paymentId === "string") {
      out.push({ kind: "receipt", paymentId: r.paymentId });
    }
    // Legacy kinds (lease-agreement, return-paperwork, inspection-report)
    // intentionally fall through.
  }
  return out;
}

export const communicationRouter = createTRPCRouter({
  // -------------------------------------------------------------------------
  // STATS
  // -------------------------------------------------------------------------
  stats: staffProcedure
    .input(z.object({ range: z.enum(["today", "7d", "30d"]).default("today") }).optional())
    .query(async ({ ctx, input }) => {
      const range = input?.range ?? "today";
      const now = new Date();
      const rangeStart = new Date(now);
      if (range === "today") rangeStart.setHours(0, 0, 0, 0);
      else if (range === "7d") rangeStart.setDate(rangeStart.getDate() - 7);
      else rangeStart.setDate(rangeStart.getDate() - 30);

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const [byStatusRaw, byChannelRaw, failedToday, bouncedToday, openedCount] = await Promise.all([
        ctx.prisma.communicationLog.groupBy({
          by: ["status"],
          where: { sentAt: { gte: rangeStart } },
          _count: { _all: true },
        }),
        ctx.prisma.communicationLog.groupBy({
          by: ["channel"],
          where: { sentAt: { gte: rangeStart } },
          _count: { _all: true },
        }),
        ctx.prisma.communicationLog.count({
          where: { sentAt: { gte: todayStart }, status: "FAILED" },
        }),
        ctx.prisma.communicationLog.count({
          where: { sentAt: { gte: todayStart }, status: "BOUNCED" },
        }),
        ctx.prisma.communicationLog.count({
          where: { sentAt: { gte: rangeStart }, openedAt: { not: null } },
        }),
      ]);

      const statusMap: Record<string, number> = {};
      for (const b of byStatusRaw) statusMap[b.status] = b._count._all;
      const sent = statusMap.SENT ?? 0;
      const delivered = statusMap.DELIVERED ?? 0;
      const bounced = statusMap.BOUNCED ?? 0;
      const failed = statusMap.FAILED ?? 0;
      const sentInRange = sent + delivered + bounced + failed;
      const deliveryRate = sentInRange > 0 ? delivered / sentInRange : 0;

      const channelMap: Record<string, number> = {};
      for (const b of byChannelRaw) channelMap[b.channel] = b._count._all;

      return {
        sentInRange,
        deliveryRate,
        byStatus: { sent, delivered, bounced, failed },
        byChannel: {
          email: channelMap.EMAIL ?? 0,
          sms: channelMap.SMS ?? 0,
          inApp: channelMap.IN_APP ?? 0,
          push: channelMap.PUSH ?? 0,
        },
        failedToday,
        bouncedToday,
        openedCount,
      };
    }),

  // -------------------------------------------------------------------------
  // LOG
  // -------------------------------------------------------------------------
  logList: staffProcedure
    .input(
      z.object({
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
        channel: channelEnum.optional(),
        category: categoryEnum.optional(),
        status: recipientStatusEnum.optional(),
        type: notificationTypeEnum.optional(),
        customerId: z.string().optional(),
        campaignId: z.string().optional(),
        search: z.string().optional(),
        take: z.number().min(1).max(200).default(50),
        cursor: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const items = await ctx.prisma.communicationLog.findMany({
        where: {
          ...(input.from || input.to
            ? { sentAt: { ...(input.from ? { gte: input.from } : {}), ...(input.to ? { lte: input.to } : {}) } }
            : {}),
          ...(input.channel ? { channel: input.channel } : {}),
          ...(input.category ? { category: input.category } : {}),
          ...(input.status ? { status: input.status } : {}),
          ...(input.type ? { type: input.type } : {}),
          ...(input.customerId ? { customerId: input.customerId } : {}),
          ...(input.campaignId ? { campaignId: input.campaignId } : {}),
          ...(input.search
            ? {
                OR: [
                  { subject: { contains: input.search, mode: "insensitive" } },
                  { body: { contains: input.search, mode: "insensitive" } },
                  { customer: { email: { contains: input.search, mode: "insensitive" } } },
                ],
              }
            : {}),
        },
        include: {
          customer: { select: { id: true, email: true, phone: true, firstName: true, lastName: true } },
          campaign: { select: { id: true, name: true } },
        },
        take: input.take + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        orderBy: { sentAt: "desc" },
      });
      const nextCursor = items.length > input.take ? items.pop()!.id : null;
      return { items, nextCursor };
    }),

  logDetail: staffProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const log = await ctx.prisma.communicationLog.findUnique({
        where: { id: input.id },
        include: {
          customer: { select: { id: true, email: true, phone: true, firstName: true, lastName: true } },
          campaign: { select: { id: true, name: true, templateId: true } },
        },
      });
      if (!log) throw new TRPCError({ code: "NOT_FOUND" });
      return log;
    }),

  logResend: managerProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const log = await ctx.prisma.communicationLog.findUnique({ where: { id: input.id } });
      if (!log || !log.customerId) throw new TRPCError({ code: "NOT_FOUND" });
      // Carry forward whatever PDFs the original send delivered (tax
      // invoice, receipt, rental agreement, etc). The schema for
      // `AttachmentRef` changed — old rows used `lease-agreement` /
      // `return-paperwork` shapes; the resolver only understands the
      // current shape, so we filter to the supported kinds and silently
      // drop legacy entries. The body still ships either way.
      const attachments = parseLoggedAttachmentRefs(log.attachmentRefs);
      return sendNotification({
        userId: log.customerId,
        type: log.type,
        category: log.category,
        channels: [log.channel],
        subject: log.subject ?? undefined,
        body: log.body,
        templateKey: log.templateUsed ?? undefined,
        bookingId: log.bookingId ?? undefined,
        attachments: attachments.length > 0 ? attachments : undefined,
        sentById: ctx.user.id,
      });
    }),

  // -------------------------------------------------------------------------
  // TEMPLATES
  // -------------------------------------------------------------------------
  templateList: staffProcedure
    .input(
      z.object({
        category: categoryEnum.optional(),
        includeArchived: z.boolean().default(false),
      }),
    )
    .query(({ ctx, input }) =>
      ctx.prisma.notificationTemplate.findMany({
        where: {
          ...(input.category ? { category: input.category } : {}),
          ...(input.includeArchived ? {} : { archivedAt: null }),
        },
        orderBy: [{ category: "asc" }, { name: "asc" }],
      }),
    ),

  templateGet: staffProcedure
    .input(z.object({ id: z.string().optional(), type: notificationTypeEnum.optional() }))
    .query(async ({ ctx, input }) => {
      if (!input.id && !input.type) throw new TRPCError({ code: "BAD_REQUEST", message: "id or type required" });
      const template = await ctx.prisma.notificationTemplate.findFirst({
        where: input.id ? { id: input.id } : { type: input.type },
      });
      if (!template) throw new TRPCError({ code: "NOT_FOUND" });
      return template;
    }),

  templateUpsert: adminProcedure
    .input(
      z.object({
        id: z.string().optional(),
        key: z.string().min(1),
        type: notificationTypeEnum.optional(),
        category: categoryEnum,
        name: z.string().min(1),
        description: z.string().optional(),
        channels: z.array(channelEnum).min(1),
        subject: z.string().optional(),
        bodyTemplate: z.string().min(1),
        emailBodyHtml: z.string().optional().nullable(),
        format: templateFormatEnum.default("PLAIN_TEXT"),
        variables: z.array(z.string()).default([]),
        defaultAttachments: z.unknown().optional(),
        isActive: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const normalisedEmailHtml =
        input.emailBodyHtml && input.emailBodyHtml.trim().length > 0
          ? input.emailBodyHtml
          : null;
      if (input.id) {
        const prior = await ctx.prisma.notificationTemplate.findUnique({ where: { id: input.id } });
        if (!prior) throw new TRPCError({ code: "NOT_FOUND" });
        await ctx.prisma.notificationTemplateVersion.create({
          data: {
            templateId: prior.id,
            subject: prior.subject,
            bodyTemplate: prior.bodyTemplate,
            emailBodyHtml: prior.emailBodyHtml,
            format: prior.format,
            channels: prior.channels,
            variables: prior.variables,
            updatedById: ctx.user.id,
          },
        });
        return ctx.prisma.notificationTemplate.update({
          where: { id: input.id },
          data: {
            key: input.key,
            type: input.type,
            category: input.category,
            name: input.name,
            description: input.description ?? null,
            channels: input.channels,
            subject: input.subject ?? null,
            bodyTemplate: input.bodyTemplate,
            emailBodyHtml: normalisedEmailHtml,
            format: input.format,
            variables: input.variables,
            defaultAttachments: (input.defaultAttachments as Prisma.InputJsonValue | undefined) ?? undefined,
            isActive: input.isActive,
            updatedById: ctx.user.id,
          },
        });
      }
      return ctx.prisma.notificationTemplate.create({
        data: {
          key: input.key,
          type: input.type,
          category: input.category,
          name: input.name,
          description: input.description ?? null,
          channels: input.channels,
          subject: input.subject ?? null,
          bodyTemplate: input.bodyTemplate,
          emailBodyHtml: normalisedEmailHtml,
          format: input.format,
          variables: input.variables,
          defaultAttachments: (input.defaultAttachments as Prisma.InputJsonValue | undefined) ?? undefined,
          isActive: input.isActive,
          createdById: ctx.user.id,
          updatedById: ctx.user.id,
        },
      });
    }),

  templateArchive: adminProcedure
    .input(z.object({ id: z.string(), archived: z.boolean().default(true) }))
    .mutation(({ ctx, input }) =>
      ctx.prisma.notificationTemplate.update({
        where: { id: input.id },
        data: { archivedAt: input.archived ? new Date() : null, updatedById: ctx.user.id },
      }),
    ),

  templateVersions: staffProcedure
    .input(z.object({ templateId: z.string() }))
    .query(({ ctx, input }) =>
      ctx.prisma.notificationTemplateVersion.findMany({
        where: { templateId: input.templateId },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
    ),

  templateRestoreVersion: adminProcedure
    .input(z.object({ versionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const version = await ctx.prisma.notificationTemplateVersion.findUnique({
        where: { id: input.versionId },
      });
      if (!version) throw new TRPCError({ code: "NOT_FOUND" });
      return ctx.prisma.notificationTemplate.update({
        where: { id: version.templateId },
        data: {
          subject: version.subject,
          bodyTemplate: version.bodyTemplate,
          emailBodyHtml: version.emailBodyHtml,
          format: version.format,
          channels: version.channels,
          variables: version.variables,
          updatedById: ctx.user.id,
        },
      });
    }),

  templatePreview: staffProcedure
    .input(
      z.object({
        templateId: z.string().optional(),
        bodyTemplate: z.string().optional(),
        subject: z.string().optional(),
        format: templateFormatEnum.optional(),
        variables: z.record(z.string(), z.string()).default({}),
      }),
    )
    .query(async ({ ctx, input }) => {
      let subject = input.subject ?? "";
      let body = input.bodyTemplate ?? "";
      let format: "PLAIN_TEXT" | "HTML" = input.format ?? "PLAIN_TEXT";
      if (input.templateId) {
        const t = await ctx.prisma.notificationTemplate.findUnique({ where: { id: input.templateId } });
        if (!t) throw new TRPCError({ code: "NOT_FOUND" });
        subject = input.subject ?? t.subject ?? "";
        body = input.bodyTemplate ?? t.bodyTemplate;
        format = input.format ?? t.format;
      }
      // Auto-inject branding vars alongside caller-supplied sample values so
      // the preview looks like what will actually ship — `{{logoUrl}}`,
      // `{{termsUrl}}`, legal name, etc. resolve even in the admin editor.
      const { getEmailBrandingVars } = await import("@/lib/email-branding-vars");
      const brandingVars = await getEmailBrandingVars();
      const mergedVars: Record<string, string> = { ...brandingVars, ...input.variables };
      // Subject is always rendered as plain text — HTML in a subject line
      // is never what an author wants and many providers strip it anyway.
      const renderedSubject = renderTemplate(subject, mergedVars, "PLAIN_TEXT");
      const renderedBody = renderTemplate(body, mergedVars, format);
      const placeholders = new Set([
        ...extractPlaceholders(subject),
        ...extractPlaceholders(body),
      ]);
      const suppliedIncludingBranding = new Set(Object.keys(mergedVars));
      const suppliedFromCaller = new Set(Object.keys(input.variables));
      const missingVariables = [...placeholders].filter((p) => !suppliedIncludingBranding.has(p));
      // "Unused" only flags caller-supplied keys; branding vars are always
      // available even when the template doesn't reference them.
      const unusedVariables = [...suppliedFromCaller].filter((s) => !placeholders.has(s));
      return {
        subject: renderedSubject,
        body: renderedBody,
        format,
        missingVariables,
        unusedVariables,
      };
    }),

  // -------------------------------------------------------------------------
  // AUTOMATIONS
  // -------------------------------------------------------------------------
  automationList: staffProcedure.query(({ ctx }) =>
    ctx.prisma.notificationAutomation.findMany({ orderBy: { type: "asc" } }),
  ),

  automationUpsert: adminProcedure
    .input(
      z.object({
        type: notificationTypeEnum,
        enabled: z.boolean(),
        channels: z.array(channelEnum).default([]),
        leadTime: z.unknown().optional(),
        description: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.prisma.notificationAutomation.upsert({
        where: { type: input.type },
        create: {
          type: input.type,
          enabled: input.enabled,
          channels: input.channels,
          leadTime: (input.leadTime as Prisma.InputJsonValue | undefined) ?? undefined,
          description: input.description ?? null,
          updatedById: ctx.user.id,
        },
        update: {
          enabled: input.enabled,
          channels: input.channels,
          leadTime: (input.leadTime as Prisma.InputJsonValue | undefined) ?? undefined,
          description: input.description ?? null,
          updatedById: ctx.user.id,
        },
      }),
    ),

  // -------------------------------------------------------------------------
  // SEGMENTS
  // -------------------------------------------------------------------------
  segmentList: managerProcedure.query(({ ctx }) =>
    ctx.prisma.segment.findMany({
      where: { archivedAt: null },
      orderBy: { updatedAt: "desc" },
    }),
  ),

  segmentGet: managerProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const s = await ctx.prisma.segment.findUnique({ where: { id: input.id } });
      if (!s) throw new TRPCError({ code: "NOT_FOUND" });
      return s;
    }),

  segmentCreate: managerProcedure
    .input(segmentCreateSchema)
    .mutation(({ ctx, input }) =>
      ctx.prisma.segment.create({
        data: {
          name: input.name,
          description: input.description ?? null,
          filters: input.filters,
          createdById: ctx.user.id,
        },
      }),
    ),

  segmentUpdate: managerProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(120).optional(),
        description: z.string().optional(),
        filters: segmentFiltersSchema.optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.prisma.segment.update({
        where: { id: input.id },
        data: {
          ...(input.name ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.filters ? { filters: input.filters } : {}),
        },
      }),
    ),

  segmentArchive: managerProcedure
    .input(z.object({ id: z.string(), archived: z.boolean().default(true) }))
    .mutation(({ ctx, input }) =>
      ctx.prisma.segment.update({
        where: { id: input.id },
        data: { archivedAt: input.archived ? new Date() : null },
      }),
    ),

  segmentEvaluate: managerProcedure
    .input(z.object({ filters: segmentFiltersSchema, take: z.number().min(0).max(200).default(20) }))
    .query(async ({ input }) => evaluateSegment(input.filters, { take: input.take })),

  segmentMembers: managerProcedure
    .input(
      z.object({
        id: z.string(),
        take: z.number().min(1).max(200).default(50),
        skip: z.number().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const segment = await ctx.prisma.segment.findUnique({ where: { id: input.id } });
      if (!segment) throw new TRPCError({ code: "NOT_FOUND" });
      const filters = segmentFiltersSchema.parse(segment.filters);
      const where = buildSegmentWhere(filters);
      const [count, rows] = await Promise.all([
        ctx.prisma.user.count({ where }),
        ctx.prisma.user.findMany({
          where,
          take: input.take,
          skip: input.skip,
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            customerProfile: { select: { state: true, postcode: true, totalBookings: true } },
          },
        }),
      ]);
      return { count, rows };
    }),

  // -------------------------------------------------------------------------
  // CAMPAIGNS
  // -------------------------------------------------------------------------
  campaignList: managerProcedure
    .input(
      z.object({
        status: campaignStatusEnum.optional(),
        take: z.number().min(1).max(100).default(50),
        cursor: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const items = await ctx.prisma.campaign.findMany({
        where: input.status ? { status: input.status } : {},
        include: {
          template: { select: { id: true, name: true, type: true } },
          segment: { select: { id: true, name: true } },
          _count: { select: { recipients: true } },
        },
        take: input.take + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        orderBy: { createdAt: "desc" },
      });
      const nextCursor = items.length > input.take ? items.pop()!.id : null;
      return { items, nextCursor };
    }),

  campaignGet: managerProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const campaign = await ctx.prisma.campaign.findUnique({
        where: { id: input.id },
        include: {
          template: true,
          segment: true,
          recipients: {
            take: 200,
            orderBy: { createdAt: "asc" },
          },
        },
      });
      if (!campaign) throw new TRPCError({ code: "NOT_FOUND" });
      return campaign;
    }),

  campaignCreate: managerProcedure
    .input(
      z.object({
        name: z.string().min(1).max(150),
        templateId: z.string().optional(),
        segmentId: z.string().optional(),
        manualRecipientIds: z.array(z.string()).default([]),
        channels: z.array(channelEnum).min(1),
        subject: z.string().optional(),
        bodyOverride: z.string().optional(),
        scheduledFor: z.coerce.date().optional(),
        notes: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.prisma.campaign.create({
        data: {
          name: input.name,
          templateId: input.templateId ?? null,
          segmentId: input.segmentId ?? null,
          manualRecipientIds: input.manualRecipientIds,
          channels: input.channels,
          subject: input.subject ?? null,
          bodyOverride: input.bodyOverride ?? null,
          scheduledFor: input.scheduledFor ?? null,
          status: input.scheduledFor ? "SCHEDULED" : "DRAFT",
          createdById: ctx.user.id,
          notes: input.notes ?? null,
        },
      }),
    ),

  campaignCancel: managerProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const c = await ctx.prisma.campaign.findUnique({ where: { id: input.id } });
      if (!c) throw new TRPCError({ code: "NOT_FOUND" });
      if (c.status !== "SCHEDULED" && c.status !== "DRAFT") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Campaign cannot be cancelled in its current status" });
      }
      return ctx.prisma.campaign.update({
        where: { id: input.id },
        data: { status: "CANCELLED" },
      });
    }),

  // -------------------------------------------------------------------------
  // COMPOSE — one-off send or single-customer ad-hoc
  // -------------------------------------------------------------------------
  composeSend: managerProcedure
    .input(
      z.object({
        customerIds: z.array(z.string()).min(1).max(500),
        type: notificationTypeEnum.default("CUSTOM"),
        category: categoryEnum.optional(),
        channels: z.array(channelEnum).min(1),
        subject: z.string().optional(),
        body: z.string().min(1),
        format: templateFormatEnum.default("PLAIN_TEXT"),
        templateId: z.string().optional(),
        bookingId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      skipAutoAudit(ctx);
      const category = input.category ?? categoryForType(input.type);
      const htmlBody = input.format === "HTML" ? input.body : undefined;
      const textBody = input.format === "HTML" ? htmlToText(input.body) : input.body;
      const campaign = await ctx.prisma.campaign.create({
        data: {
          name: `Compose: ${input.subject ?? input.type} (${new Date().toISOString()})`,
          templateId: input.templateId ?? null,
          manualRecipientIds: input.customerIds,
          channels: input.channels,
          subject: input.subject ?? null,
          bodyOverride: input.body,
          status: "SENDING",
          createdById: ctx.user.id,
        },
      });

      const results: Array<{ customerId: string; ok: boolean; reason?: string }> = [];
      for (const customerId of input.customerIds) {
        writeAuditAsync(ctx.prisma, {
          userId: ctx.user.id,
          category: "MUTATION",
          action: "communication.composeSend",
          entity: "User",
          entityId: customerId,
          method: "tRPC",
          path: "communication.composeSend",
          status: "SUCCESS",
          reqId: ctx.reqId,
          newData: {
            campaignId: campaign.id,
            type: input.type,
            channels: input.channels,
            subject: input.subject ?? null,
            templateId: input.templateId ?? null,
            bookingId: input.bookingId ?? null,
          },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        });
        const res = await sendNotification({
          userId: customerId,
          type: input.type,
          category,
          channels: input.channels,
          subject: input.subject,
          body: textBody,
          html: htmlBody,
          templateKey: input.templateId,
          bookingId: input.bookingId,
          campaignId: campaign.id,
          sentById: ctx.user.id,
        });
        const sent = res.results.some((r) => r.status === "SENT");
        results.push({
          customerId,
          ok: sent,
          reason: sent ? undefined : res.results.map((r) => r.reason).filter(Boolean).join(", "),
        });
      }

      const sentCount = results.filter((r) => r.ok).length;
      await ctx.prisma.campaign.update({
        where: { id: campaign.id },
        data: {
          status: sentCount === 0 ? "FAILED" : "SENT",
          sentAt: new Date(),
          stats: {
            attempted: results.length,
            sent: sentCount,
            failed: results.length - sentCount,
          },
        },
      });

      return { campaignId: campaign.id, results };
    }),

  // -------------------------------------------------------------------------
  // CONSENT / PREFERENCES
  // -------------------------------------------------------------------------
  consentGet: staffProcedure
    .input(z.object({ customerId: z.string() }))
    .query(async ({ ctx, input }) => {
      const user = await ctx.prisma.user.findUnique({
        where: { id: input.customerId },
        select: {
          id: true,
          email: true,
          phone: true,
          customerProfile: {
            select: {
              marketingOptIn: true,
              marketingSmsOptIn: true,
              marketingEmailUnsubscribedAt: true,
              marketingSmsUnsubscribedAt: true,
              unsubscribeReason: true,
            },
          },
        },
      });
      if (!user) throw new TRPCError({ code: "NOT_FOUND" });
      return user;
    }),

  consentUpdate: managerProcedure
    .input(
      z.object({
        customerId: z.string(),
        marketingOptIn: z.boolean().optional(),
        marketingSmsOptIn: z.boolean().optional(),
        resetEmailUnsubscribe: z.boolean().optional(),
        resetSmsUnsubscribe: z.boolean().optional(),
        reason: z.string().max(500).optional(),
      }),
    )
    .meta({ audit: { customerIdPath: "customerId" } })
    .mutation(({ ctx, input }) =>
      ctx.prisma.customerProfile.update({
        where: { userId: input.customerId },
        data: {
          ...(input.marketingOptIn !== undefined ? { marketingOptIn: input.marketingOptIn } : {}),
          ...(input.marketingSmsOptIn !== undefined ? { marketingSmsOptIn: input.marketingSmsOptIn } : {}),
          ...(input.resetEmailUnsubscribe ? { marketingEmailUnsubscribedAt: null } : {}),
          ...(input.resetSmsUnsubscribe ? { marketingSmsUnsubscribedAt: null } : {}),
          ...(input.reason !== undefined ? { unsubscribeReason: input.reason } : {}),
        },
      }),
    ),

  suppressionList: staffProcedure
    .input(z.object({ take: z.number().min(1).max(200).default(50), cursor: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const items = await ctx.prisma.customerProfile.findMany({
        where: {
          OR: [
            { marketingEmailUnsubscribedAt: { not: null } },
            { marketingSmsUnsubscribedAt: { not: null } },
          ],
        },
        include: {
          user: {
            select: { id: true, email: true, phone: true, firstName: true, lastName: true },
          },
        },
        take: input.take + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        orderBy: { user: { firstName: "asc" } },
      });
      const nextCursor = items.length > input.take ? items.pop()!.id : null;
      return { items, nextCursor };
    }),
});

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

const PLACEHOLDER_RE = /\{\{\{\s*(\w+)\s*\}\}\}|\{\{\s*(\w+)\s*\}\}/g;

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Substitutes `{{name}}` (and `{{{name}}}` for raw insertion) with values
 * from `vars`. In HTML mode, double-brace values are HTML-escaped;
 * triple-brace values are inserted raw (for pre-rendered HTML such as a
 * signature block). Missing variables pass through as their original
 * placeholder so mis-authored templates are visible, not silently blank.
 */
export function renderTemplate(
  template: string,
  vars: Record<string, string>,
  format: "PLAIN_TEXT" | "HTML" = "PLAIN_TEXT",
): string {
  return template.replace(PLACEHOLDER_RE, (match, rawKey?: string, escKey?: string) => {
    const key = rawKey ?? escKey!;
    const value = vars[key];
    if (value === undefined) return match;
    if (rawKey !== undefined) return value;
    return format === "HTML" ? escapeHtml(value) : value;
  });
}

/** All placeholder names referenced by `{{name}}` or `{{{name}}}`. */
export function extractPlaceholders(template: string): string[] {
  const names = new Set<string>();
  for (const m of template.matchAll(PLACEHOLDER_RE)) {
    names.add((m[1] ?? m[2])!);
  }
  return [...names];
}
