import { z } from "zod";
import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { Prisma, type SupportConversation } from "@prisma/client";
import {
  createTRPCRouter,
  publicProcedure,
  staffProcedure,
} from "../trpc";
import {
  publishPresence,
  publishChat,
  getStaffOnlineCount,
} from "@/server/services/presence";
import { classifyDevice, hashIp, lookupGeo } from "@/lib/geo-ip";
import { classifyChannel } from "@/lib/analytics/channel";

const VISITOR_COOKIE = "xpertmoto_vid";
const PRESENCE_ACTIVE_MS = 60_000;
const BODY_MAX = 4000;
const MAX_ATTACHMENTS = 5;

/**
 * Narrow, PII-free booking-wizard snapshot sent alongside each
 * heartbeat. The client strips the `customer` / `deliveryAddress` /
 * `signatureDataUrl` blocks of the Zustand store before sending so the
 * server never sees licence numbers, DOB, emails, addresses, or
 * signatures. What ends up in the DB is the minimum needed to reason
 * about the visitor's cart: depot + dates + category + vehicle +
 * extras + discount code + delivery flag. See `use-visitor-heartbeat`.
 */
const WizardStateSchema = z.object({
  step: z.number().int().min(1).max(6),
  pickupDepotId: z.string().max(64).nullable().optional(),
  returnDepotId: z.string().max(64).nullable().optional(),
  pickupDateTime: z.string().max(40).nullable().optional(),
  returnDateTime: z.string().max(40).nullable().optional(),
  categoryId: z.string().max(64).nullable().optional(),
  preferredVehicleId: z.string().max(64).nullable().optional(),
  addons: z
    .array(
      z.object({
        addonId: z.string().max(64),
        quantity: z.number().int().min(0).max(10),
      }),
    )
    .max(32)
    .optional(),
  insuranceOptionId: z.string().max(64).nullable().optional(),
  discountCode: z.string().max(64).optional(),
  isDelivery: z.boolean().optional(),
  deliveryFee: z.number().finite().optional(),
  agreedToTerms: z.boolean().optional(),
  // Explicit opt-in field for a client-computed quote total in cents.
  // Left null when the client hasn't run a quote API round trip yet.
  quotedTotalCents: z.number().int().min(0).max(100_000_00).nullable().optional(),
});

export type WizardStateSnapshot = z.infer<typeof WizardStateSchema>;

const AttachmentSchema = z.object({
  url: z.string().url().or(z.string().startsWith("/uploads/")),
  key: z.string(),
  mimeType: z.string().max(120),
  sizeBytes: z.number().int().positive().max(25 * 1024 * 1024),
  name: z.string().max(200).optional(),
});

export function readVisitorCookie(ctx: { headers: Headers }): string | null {
  const raw = ctx.headers.get("cookie");
  if (!raw) return null;
  for (const pair of raw.split(";")) {
    const [k, ...rest] = pair.trim().split("=");
    if (k === VISITOR_COOKIE) return rest.join("=") || null;
  }
  return null;
}

export function hashUA(userAgent: string | null | undefined): string {
  return createHash("sha256")
    .update(userAgent ?? "unknown")
    .digest("hex")
    .slice(0, 32);
}

export function displayNameFor(
  user: { firstName?: string | null; lastName?: string | null } | null,
): string | null {
  if (!user) return null;
  const fn = user.firstName ?? "";
  const ln = user.lastName ?? "";
  const combined = `${fn} ${ln}`.trim();
  return combined || null;
}

export function maxStep(a: number | null, b: number | null): number | null {
  if (a == null) return b;
  if (b == null) return a;
  return a > b ? a : b;
}

/**
 * Translate a wizard-state snapshot into VisitorSession column writes.
 * Returns two equivalent shapes — one for CREATE (value or omitted) and
 * one for UPDATE (value, `null` to clear, or omitted to preserve prior).
 * When the snapshot is null or undefined we return empty objects so
 * the caller can spread unconditionally.
 */
export function wizardStateToColumns(
  snapshot: WizardStateSnapshot | null | undefined,
): {
  createData: Partial<{
    wizardState: Prisma.InputJsonValue;
    pickupDepotId: string | null;
    categoryId: string | null;
    vehicleId: string | null;
    discountCode: string | null;
    quotedTotalCents: number | null;
  }>;
  updateData: Partial<{
    wizardState: Prisma.InputJsonValue | typeof Prisma.JsonNull;
    pickupDepotId: string | null;
    categoryId: string | null;
    vehicleId: string | null;
    discountCode: string | null;
    quotedTotalCents: number | null;
  }>;
} {
  if (!snapshot) return { createData: {}, updateData: {} };
  const discount = snapshot.discountCode?.trim() ?? "";
  const scalar = {
    pickupDepotId: snapshot.pickupDepotId ?? null,
    categoryId: snapshot.categoryId ?? null,
    vehicleId: snapshot.preferredVehicleId ?? null,
    discountCode: discount.length > 0 ? discount : null,
    quotedTotalCents: snapshot.quotedTotalCents ?? null,
  };
  // Store the snapshot as-is; Prisma's InputJsonValue accepts plain
  // JSON-compatible values and the WizardStateSchema already validated
  // every field shape + size.
  const jsonValue = snapshot as unknown as Prisma.InputJsonValue;
  return {
    createData: { wizardState: jsonValue, ...scalar },
    updateData: { wizardState: jsonValue, ...scalar },
  };
}

export function safeReferrerHost(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.host || null;
  } catch {
    // Accept bare hostnames sent by the client.
    const cleaned = raw.replace(/^https?:\/\//, "").split("/")[0] ?? "";
    return cleaned.length > 0 ? cleaned.slice(0, 200) : null;
  }
}

export function toPresenceEvent(row: {
  id: string;
  currentPath: string;
  wizardStep: number | null;
  userId: string | null;
  startedAt: Date;
  lastSeenAt: Date;
  user?: { firstName: string | null; lastName: string | null } | null;
}) {
  return {
    type: "presence.upsert" as const,
    sessionId: row.id,
    currentPath: row.currentPath,
    wizardStep: row.wizardStep,
    displayName: displayNameFor(row.user ?? null),
    userId: row.userId,
    startedAt: row.startedAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
  };
}

export const liveRouter = createTRPCRouter({
  // ---------------------------------------------------------------------
  // Visitor-facing (public)
  // ---------------------------------------------------------------------

  heartbeat: publicProcedure
    .input(
      z.object({
        path: z.string().min(1).max(500),
        wizardStep: z.number().int().min(1).max(6).nullable().optional(),
        // Sent once on the first heartbeat of a session — the client's
        // `document.referrer` and `?utm_*` query params. Ignored on
        // subsequent heartbeats (create-only columns on VisitorSession).
        referrer: z.string().max(500).nullable().optional(),
        utmSource: z.string().max(120).nullable().optional(),
        utmMedium: z.string().max(120).nullable().optional(),
        utmCampaign: z.string().max(200).nullable().optional(),
        // Booking-wizard snapshot — see WizardStateSchema above. Sent on
        // every heartbeat that carries a non-empty wizard store.
        wizardState: WizardStateSchema.nullable().optional(),
        // Persistent visitor fingerprint (the `sc_visitor` cookie).
        // Narrow regex mirrors what the client mints (UUID v4) and what
        // the client-side validator accepts when reading the cookie.
        visitorFingerprint: z
          .string()
          .regex(/^[a-zA-Z0-9-]{8,64}$/)
          .nullable()
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const vid = readVisitorCookie(ctx);
      if (!vid) return { ok: false as const, reason: "no-cookie" };

      const now = new Date();
      const ipHash = hashIp(ctx.ipAddress);
      const existing = await ctx.prisma.visitorSession.findUnique({
        where: { id: vid },
        select: { currentPath: true, wizardHighestStep: true },
      });

      const pathChanged = existing && existing.currentPath !== input.path;
      const newHighest = maxStep(existing?.wizardHighestStep ?? null, input.wizardStep ?? null);
      const wizardColumns = wizardStateToColumns(input.wizardState);

      const session = !existing
        ? await (async () => {
            const geo = await lookupGeo(ctx.ipAddress ?? null, ipHash);
            const referrerHost = safeReferrerHost(
              input.referrer ?? ctx.headers.get("referer") ?? null,
            );
            // Retention: `sessionNumber` = 1 + prior sessions for this
            // fingerprint. Runs only at session-create (one row per
            // visitor per 30+ min) so the extra count query is cheap
            // and stays off the hot heartbeat path.
            const fingerprint = input.visitorFingerprint ?? null;
            const priorSessions = fingerprint
              ? await ctx.prisma.visitorSession.count({
                  where: { visitorFingerprint: fingerprint, id: { not: vid } },
                })
              : 0;
            const sessionNumber = priorSessions + 1;
            const trafficChannel = classifyChannel(
              input.utmSource ?? null,
              input.utmMedium ?? null,
              referrerHost,
            );
            const data: Prisma.VisitorSessionCreateInput = {
              id: vid,
              user: ctx.session?.user?.id
                ? { connect: { id: ctx.session.user.id } }
                : undefined,
              currentPath: input.path,
              wizardStep: input.wizardStep ?? null,
              userAgentHash: hashUA(ctx.userAgent),
              lastSeenAt: now,
              ipHash,
              country: geo.country,
              region: geo.region,
              city: geo.city,
              referrer: referrerHost,
              landingPath: input.path,
              utmSource: input.utmSource ?? null,
              utmMedium: input.utmMedium ?? null,
              utmCampaign: input.utmCampaign ?? null,
              deviceType: classifyDevice(ctx.userAgent),
              totalPageViews: 1,
              wizardHighestStep: input.wizardStep ?? null,
              visitorFingerprint: fingerprint,
              sessionNumber,
              isReturning: sessionNumber > 1,
              trafficChannel,
              ...wizardColumns.createData,
            };
            return ctx.prisma.visitorSession.create({
              data,
              include: { user: { select: { firstName: true, lastName: true } } },
            });
          })()
        : await ctx.prisma.visitorSession.update({
            where: { id: vid },
            data: {
              currentPath: input.path,
              wizardStep: input.wizardStep ?? null,
              lastSeenAt: now,
              userId: ctx.session?.user?.id ?? undefined,
              ...(pathChanged ? { totalPageViews: { increment: 1 } } : {}),
              ...(newHighest !== (existing.wizardHighestStep ?? null)
                ? { wizardHighestStep: newHighest }
                : {}),
              ...wizardColumns.updateData,
            },
            include: { user: { select: { firstName: true, lastName: true } } },
          });

      if (!existing) {
        await ctx.prisma.visitorPageView
          .create({ data: { sessionId: vid, path: input.path, enteredAt: now } })
          .catch(() => undefined);
      } else if (pathChanged) {
        const prev = await ctx.prisma.visitorPageView.findFirst({
          where: { sessionId: vid, leftAt: null },
          orderBy: { enteredAt: "desc" },
        });
        if (prev) {
          await ctx.prisma.visitorPageView
            .update({
              where: { id: prev.id },
              data: {
                leftAt: now,
                durationMs: Math.max(0, now.getTime() - prev.enteredAt.getTime()),
              },
            })
            .catch(() => undefined);
        }
        await ctx.prisma.visitorPageView
          .create({ data: { sessionId: vid, path: input.path, enteredAt: now } })
          .catch(() => undefined);
      }

      await publishPresence(toPresenceEvent(session));
      return { ok: true as const, sessionId: vid };
    }),

  events: publicProcedure
    .input(
      z.object({
        events: z
          .array(
            z.object({
              kind: z.enum([
                "CLICK",
                "CTA_CLICK",
                "FLEET_VIEW",
                "FLEET_CLICK",
                "FORM_FIELD_FOCUS",
                "FORM_FIELD_CHANGE",
                "FORM_FIELD_BLUR",
                "SEARCH",
                "DISCOUNT_ATTEMPTED",
                "DISCOUNT_APPLIED",
                "DISCOUNT_REJECTED",
                "SCROLL_DEPTH",
                "EXIT_INTENT",
                "RAGE_CLICK",
                "DEAD_CLICK",
                "COPY",
                "CHAT_OPEN",
                "CHAT_MESSAGE_SENT",
                "WIZARD_STEP_ENTER",
                "WIZARD_STEP_LEAVE",
                "WIZARD_SNAPSHOT",
                "PRICE_VIEWED",
                "CUSTOM",
              ]),
              path: z.string().min(1).max(500),
              target: z.string().max(120).nullable().optional(),
              value: z.string().max(240).nullable().optional(),
              numericValue: z.number().int().min(-1_000_000).max(1_000_000).nullable().optional(),
              // Metadata is free-form per-event context captured in the
              // visitor-analytics pipeline. Constrained to primitive values
              // (no nested objects, arrays, or functions) to keep payloads
              // small and predictable — and to eliminate a JSON-shaped
              // attack surface that `z.any()` would have accepted.
              metadata: z
                .record(
                  z.union([z.string().max(500), z.number(), z.boolean(), z.null()]),
                )
                .nullable()
                .optional(),
              wizardStep: z.number().int().min(1).max(6).nullable().optional(),
              occurredAt: z.string().datetime().optional(),
            }),
          )
          .max(100),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const vid = readVisitorCookie(ctx);
      if (!vid || input.events.length === 0) return { ok: false as const };
      // Confirm the session exists (drop otherwise — don't let events
      // create orphaned FK violations or write to a session that the
      // heartbeat pipeline hasn't initialised yet).
      const session = await ctx.prisma.visitorSession.findUnique({
        where: { id: vid },
        select: { id: true, deviceType: true },
      });
      if (!session) return { ok: false as const, reason: "no-session" };
      const deviceType = session.deviceType;
      const now = new Date();
      await ctx.prisma.visitorEvent.createMany({
        data: input.events.map((e) => ({
          sessionId: vid,
          kind: e.kind,
          path: e.path,
          occurredAt: e.occurredAt ? new Date(e.occurredAt) : now,
          target: e.target ?? null,
          value: e.value ?? null,
          numericValue: e.numericValue ?? null,
          metadata: e.metadata == null ? Prisma.DbNull : (e.metadata as Prisma.InputJsonValue),
          wizardStep: e.wizardStep ?? null,
          deviceType,
        })),
        skipDuplicates: true,
      });
      return { ok: true as const, accepted: input.events.length };
    }),

  endSession: publicProcedure.mutation(async ({ ctx }) => {
    const vid = readVisitorCookie(ctx);
    if (!vid) return { ok: false as const };
    await ctx.prisma.visitorSession
      .update({
        where: { id: vid },
        data: { lastSeenAt: new Date(Date.now() - PRESENCE_ACTIVE_MS - 1) },
      })
      .catch(() => undefined);
    await publishPresence({ type: "presence.offline", sessionId: vid });
    return { ok: true as const };
  }),

  staffOnlineCount: publicProcedure.query(async () => {
    const count = await getStaffOnlineCount();
    return { count };
  }),

  // Visitor's own active conversation (if any).
  myConversation: publicProcedure.query(async ({ ctx }) => {
    const vid = readVisitorCookie(ctx);
    if (!vid) return null;
    const session = await ctx.prisma.visitorSession.findUnique({
      where: { id: vid },
      include: {
        conversation: {
          include: {
            messages: { orderBy: { createdAt: "asc" } },
          },
        },
      },
    });
    return session?.conversation ?? null;
  }),

  visitorOpenChat: publicProcedure
    .input(
      z.object({
        firstMessage: z.string().min(1).max(BODY_MAX).optional(),
        guestName: z.string().min(1).max(120).optional(),
        guestEmail: z.string().email().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const vid = readVisitorCookie(ctx);
      if (!vid) throw new TRPCError({ code: "BAD_REQUEST", message: "No visitor cookie" });

      const session = await ctx.prisma.visitorSession.findUnique({
        where: { id: vid },
        include: { conversation: true },
      });

      let conversation: SupportConversation | null = session?.conversation ?? null;
      if (!conversation) {
        conversation = await ctx.prisma.supportConversation.create({
          data: {
            source: "LIVE_VIEW",
            customerId: ctx.session?.user?.id ?? null,
            guestName: ctx.session?.user ? null : input.guestName,
            guestEmail: ctx.session?.user ? null : input.guestEmail,
            aiEnabled: false,
          },
        });
        await ctx.prisma.visitorSession.update({
          where: { id: vid },
          data: { conversationId: conversation.id },
        });
      }

      if (input.firstMessage) {
        const msg = await ctx.prisma.supportMessage.create({
          data: {
            conversationId: conversation.id,
            senderRole: ctx.session?.user ? "CUSTOMER" : "CUSTOMER",
            senderUserId: ctx.session?.user?.id ?? null,
            body: input.firstMessage,
          },
        });
        await ctx.prisma.supportConversation.update({
          where: { id: conversation.id },
          data: { lastMessageAt: new Date() },
        });
        await publishChat(conversation.id, {
          type: "chat.message",
          conversationId: conversation.id,
          messageId: msg.id,
          senderRole: "CUSTOMER",
          body: msg.body,
          attachments: null,
          createdAt: msg.createdAt.toISOString(),
        });
      }

      return { conversationId: conversation.id };
    }),

  sendVisitorMessage: publicProcedure
    .input(
      z.object({
        conversationId: z.string(),
        body: z.string().min(1).max(BODY_MAX),
        attachments: z.array(AttachmentSchema).max(MAX_ATTACHMENTS).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const vid = readVisitorCookie(ctx);
      if (!vid) throw new TRPCError({ code: "BAD_REQUEST", message: "No visitor cookie" });

      const session = await ctx.prisma.visitorSession.findUnique({
        where: { id: vid },
      });
      if (!session || session.conversationId !== input.conversationId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const msg = await ctx.prisma.supportMessage.create({
        data: {
          conversationId: input.conversationId,
          senderRole: "CUSTOMER",
          senderUserId: ctx.session?.user?.id ?? null,
          body: input.body,
          attachments: input.attachments ?? Prisma.DbNull,
        },
      });
      await ctx.prisma.supportConversation.update({
        where: { id: input.conversationId },
        data: { lastMessageAt: new Date() },
      });
      await publishChat(input.conversationId, {
        type: "chat.message",
        conversationId: input.conversationId,
        messageId: msg.id,
        senderRole: "CUSTOMER",
        body: msg.body,
        attachments: input.attachments ?? null,
        createdAt: msg.createdAt.toISOString(),
      });
      return { ok: true as const, messageId: msg.id };
    }),

  // ---------------------------------------------------------------------
  // Staff-facing
  // ---------------------------------------------------------------------

  stats: staffProcedure.query(async ({ ctx }) => {
    const cutoff = new Date(Date.now() - PRESENCE_ACTIVE_MS);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [sessions, activeChats, todayStarted, todayConverted] = await Promise.all([
      ctx.prisma.visitorSession.findMany({
        where: { lastSeenAt: { gte: cutoff } },
        select: { wizardStep: true, conversationId: true },
      }),
      ctx.prisma.supportConversation.count({
        where: { lastMessageAt: { gte: new Date(Date.now() - 5 * 60_000) } },
      }),
      ctx.prisma.visitorSession.count({ where: { startedAt: { gte: todayStart } } }),
      ctx.prisma.booking.count({
        where: { createdAt: { gte: todayStart }, source: "WEBSITE" },
      }),
    ]);

    const byWizardStep: Record<string, number> = {};
    let landed = 0;
    let configuring = 0;
    let checkout = 0;
    for (const s of sessions) {
      const step = s.wizardStep;
      if (step == null) {
        byWizardStep.landing = (byWizardStep.landing ?? 0) + 1;
        landed++;
      } else {
        const key = `step${step}`;
        byWizardStep[key] = (byWizardStep[key] ?? 0) + 1;
        if (step <= 2) configuring++;
        else if (step >= 5) checkout++;
        else configuring++;
      }
    }

    return {
      activeVisitors: sessions.length,
      activeChats,
      byWizardStep,
      funnel: {
        landed,
        configuring,
        checkout,
        converted: todayConverted,
      },
      todayStarted,
      convertedToday: todayConverted,
    };
  }),

  activeVisitors: staffProcedure.query(async ({ ctx }) => {
    const cutoff = new Date(Date.now() - PRESENCE_ACTIVE_MS);
    const rows = await ctx.prisma.visitorSession.findMany({
      where: { lastSeenAt: { gte: cutoff } },
      orderBy: { lastSeenAt: "desc" },
      take: 200,
      include: {
        user: { select: { firstName: true, lastName: true } },
        conversation: {
          select: {
            id: true,
            lastMessageAt: true,
            messages: {
              take: 1,
              orderBy: { createdAt: "desc" },
              select: { id: true, senderRole: true, body: true, createdAt: true },
            },
          },
        },
      },
    });

    // Batch-hydrate depot / category / vehicle labels in three queries
    // so the staff console can show the visitor's cart without each row
    // individually joining. At 200-active cap this stays cheap.
    const depotIds = Array.from(new Set(rows.map((r) => r.pickupDepotId).filter((x): x is string => !!x)));
    const categoryIds = Array.from(new Set(rows.map((r) => r.categoryId).filter((x): x is string => !!x)));
    const vehicleIds = Array.from(new Set(rows.map((r) => r.vehicleId).filter((x): x is string => !!x)));
    const [depots, categories, vehicles] = await Promise.all([
      depotIds.length
        ? ctx.prisma.depot.findMany({
            where: { id: { in: depotIds } },
            select: { id: true, name: true, suburb: true },
          })
        : Promise.resolve([]),
      categoryIds.length
        ? ctx.prisma.vehicleCategory.findMany({
            where: { id: { in: categoryIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
      vehicleIds.length
        ? ctx.prisma.vehicle.findMany({
            where: { id: { in: vehicleIds } },
            select: { id: true, internalCode: true, rego: true, make: true, model: true },
          })
        : Promise.resolve([]),
    ]);
    const depotMap = new Map(depots.map((d) => [d.id, d]));
    const categoryMap = new Map(categories.map((c) => [c.id, c]));
    const vehicleMap = new Map(vehicles.map((v) => [v.id, v]));

    // At-risk: sessions that fired EXIT_INTENT in the last 5 minutes.
    // One batched query keyed by sessionId gives staff the "pounce now"
    // signal without polling per-row events.
    const atRiskCutoff = new Date(Date.now() - 5 * 60 * 1000);
    const exitIntentRows = rows.length
      ? await ctx.prisma.visitorEvent.groupBy({
          by: ["sessionId"],
          where: {
            sessionId: { in: rows.map((r) => r.id) },
            kind: "EXIT_INTENT",
            occurredAt: { gte: atRiskCutoff },
          },
          _count: { _all: true },
        })
      : [];
    const atRiskSet = new Set(exitIntentRows.map((r) => r.sessionId));

    return rows.map((r) => {
      const d = r.pickupDepotId ? depotMap.get(r.pickupDepotId) : null;
      const c = r.categoryId ? categoryMap.get(r.categoryId) : null;
      const v = r.vehicleId ? vehicleMap.get(r.vehicleId) : null;
      const cart =
        r.pickupDepotId || r.categoryId || r.vehicleId || r.discountCode
          ? {
              depotLabel: d ? `${d.name}${d.suburb ? ` · ${d.suburb}` : ""}` : null,
              categoryLabel: c?.name ?? null,
              vehicleLabel: v
                ? `${v.make ?? ""} ${v.model ?? ""}`.trim() || v.internalCode || v.rego || null
                : null,
              discountCode: r.discountCode ?? null,
              quotedTotalCents: r.quotedTotalCents ?? null,
            }
          : null;
      return {
        sessionId: r.id,
        userId: r.userId,
        displayName: displayNameFor(r.user),
        currentPath: r.currentPath,
        wizardStep: r.wizardStep,
        startedAt: r.startedAt.toISOString(),
        lastSeenAt: r.lastSeenAt.toISOString(),
        conversationId: r.conversationId,
        lastMessageAt: r.conversation?.lastMessageAt?.toISOString() ?? null,
        lastMessagePreview: r.conversation?.messages[0]?.body ?? null,
        cart,
        atRisk: atRiskSet.has(r.id) && (r.wizardStep ?? 0) >= 1,
      };
    });
  }),

  conversationThread: staffProcedure
    .input(z.object({ conversationId: z.string() }))
    .query(async ({ ctx, input }) => {
      const conv = await ctx.prisma.supportConversation.findUnique({
        where: { id: input.conversationId },
        include: {
          messages: { orderBy: { createdAt: "asc" } },
          customer: { select: { id: true, firstName: true, lastName: true, email: true } },
          visitor: { select: { id: true, currentPath: true, wizardStep: true, lastSeenAt: true } },
        },
      });
      if (!conv) throw new TRPCError({ code: "NOT_FOUND" });
      return conv;
    }),

  startChatWithVisitor: staffProcedure
    .meta({ audit: true })
    .input(
      z.object({
        visitorSessionId: z.string(),
        firstMessage: z.string().min(1).max(BODY_MAX),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const session = await ctx.prisma.visitorSession.findUnique({
        where: { id: input.visitorSessionId },
        include: { conversation: true, user: true },
      });
      if (!session) throw new TRPCError({ code: "NOT_FOUND" });

      let conversationId = session.conversationId;
      if (!conversationId) {
        const conv = await ctx.prisma.supportConversation.create({
          data: {
            source: "LIVE_VIEW",
            customerId: session.userId,
            aiEnabled: false,
            depotId: ctx.user.depotId,
          },
        });
        await ctx.prisma.visitorSession.update({
          where: { id: session.id },
          data: { conversationId: conv.id },
        });
        conversationId = conv.id;
      }

      const msg = await ctx.prisma.supportMessage.create({
        data: {
          conversationId,
          senderRole: "STAFF",
          senderUserId: ctx.user.id,
          body: input.firstMessage,
        },
      });
      await ctx.prisma.supportConversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: new Date() },
      });
      await publishChat(conversationId, {
        type: "chat.message",
        conversationId,
        messageId: msg.id,
        senderRole: "STAFF",
        body: msg.body,
        attachments: null,
        createdAt: msg.createdAt.toISOString(),
      });
      return { conversationId, messageId: msg.id };
    }),

  sendStaffMessage: staffProcedure
    .meta({ audit: true })
    .input(
      z.object({
        conversationId: z.string(),
        body: z.string().min(1).max(BODY_MAX),
        attachments: z.array(AttachmentSchema).max(MAX_ATTACHMENTS).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const conv = await ctx.prisma.supportConversation.findUnique({
        where: { id: input.conversationId },
      });
      if (!conv) throw new TRPCError({ code: "NOT_FOUND" });
      const msg = await ctx.prisma.supportMessage.create({
        data: {
          conversationId: input.conversationId,
          senderRole: "STAFF",
          senderUserId: ctx.user.id,
          body: input.body,
          attachments: input.attachments ?? Prisma.DbNull,
        },
      });
      await ctx.prisma.supportConversation.update({
        where: { id: input.conversationId },
        data: { lastMessageAt: new Date() },
      });
      await publishChat(input.conversationId, {
        type: "chat.message",
        conversationId: input.conversationId,
        messageId: msg.id,
        senderRole: "STAFF",
        body: msg.body,
        attachments: input.attachments ?? null,
        createdAt: msg.createdAt.toISOString(),
      });
      return { ok: true as const, messageId: msg.id };
    }),
});
