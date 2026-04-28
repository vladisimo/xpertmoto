import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  createTRPCRouter,
  protectedProcedure,
  adminProcedure,
} from "../trpc";
import { skipAutoAudit, writeAudit } from "@/server/services/audit";

const selfAudit = {
  audit: {
    customerIdPath: (_: unknown, ctx: unknown) =>
      (ctx as { session?: { user?: { id?: string } } }).session?.user?.id,
  },
} as const;

/**
 * Active-session management. Customers can see and revoke their own
 * sessions; admins can revoke any user's sessions (useful for suspected
 * compromise or terminated staff).
 *
 * "Revoke" = delete the row from `Session` so the next request with that
 * cookie fails `auth()` and the user is forced to log in again. NextAuth
 * v5 consults the Session table on every `auth()` call, so this takes
 * effect on the next request.
 */
export const sessionRouter = createTRPCRouter({
  // Lightweight "who am I?" check for client components that can't rely
  // on the NextAuth SessionProvider being mounted. Returns only what a
  // client needs to render role-conditional UI; never leaks session
  // secrets or PII beyond what was already in the JWT.
  whoAmI: protectedProcedure.query(async ({ ctx }) => ({
    id: ctx.user.id,
    role: ctx.user.role,
    impersonatorId: ctx.session.impersonatorId ?? null,
  })),

  // Customer-facing: list my own active sessions (no PII beyond token
  // hash — tokens themselves never leave the server).
  mine: protectedProcedure.query(async ({ ctx }) => {
    const sessions = await ctx.prisma.session.findMany({
      where: { userId: ctx.user.id, expires: { gt: new Date() } },
      orderBy: { expires: "desc" },
      select: { id: true, expires: true },
    });
    return sessions;
  }),

  // Revoke one of my own sessions by id.
  revokeMine: protectedProcedure
    .input(z.object({ sessionId: z.string() }))
    .meta(selfAudit)
    .mutation(async ({ ctx, input }) => {
      const target = await ctx.prisma.session.findUnique({
        where: { id: input.sessionId },
      });
      if (!target || target.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      await ctx.prisma.session.delete({ where: { id: input.sessionId } });
      skipAutoAudit(ctx);
      await writeAudit(ctx.prisma, {
        userId: ctx.user.id,
        category: "MUTATION",
        action: "session.revoked_self",
        entity: "User",
        entityId: ctx.user.id,
        status: "SUCCESS",
        reqId: ctx.reqId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        newData: { sessionId: input.sessionId },
      });
      return { ok: true };
    }),

  // Revoke all my own sessions except the current one.
  revokeAllMineExceptCurrent: protectedProcedure
    .meta(selfAudit)
    .mutation(async ({ ctx }) => {
      const sessions = await ctx.prisma.session.findMany({
        where: { userId: ctx.user.id, expires: { gt: new Date() } },
      });
      // The current session's token isn't exposed via ctx.session directly
      // in this layout — settle for "all my sessions except the most
      // recently created" as a best-effort proxy. Users can re-log on the
      // device they want to keep.
      const sorted = sessions.sort((a, b) => b.expires.getTime() - a.expires.getTime());
      const toKill = sorted.slice(1);
      if (toKill.length === 0) return { revoked: 0 };
      await ctx.prisma.session.deleteMany({
        where: { id: { in: toKill.map((s) => s.id) } },
      });
      skipAutoAudit(ctx);
      await writeAudit(ctx.prisma, {
        userId: ctx.user.id,
        category: "MUTATION",
        action: "session.revoked_all_self",
        entity: "User",
        entityId: ctx.user.id,
        status: "SUCCESS",
        reqId: ctx.reqId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        newData: { revoked: toKill.length },
      });
      return { revoked: toKill.length };
    }),

  // Admin-only: list active sessions for any user.
  listForUser: adminProcedure
    .input(z.object({ userId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.session.findMany({
        where: { userId: input.userId, expires: { gt: new Date() } },
        orderBy: { expires: "desc" },
        select: { id: true, expires: true, userId: true },
      });
    }),

  // Admin-only: revoke a specific session on behalf of any user.
  revokeForUser: adminProcedure
    .input(z.object({ sessionId: z.string(), userId: z.string() }))
    .meta({ audit: { customerIdPath: "userId" } })
    .mutation(async ({ ctx, input }) => {
      const target = await ctx.prisma.session.findUnique({
        where: { id: input.sessionId },
      });
      if (!target || target.userId !== input.userId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      await ctx.prisma.session.delete({ where: { id: input.sessionId } });
      skipAutoAudit(ctx);
      await writeAudit(ctx.prisma, {
        userId: ctx.user.id,
        category: "MUTATION",
        action: "session.revoked_by_admin",
        entity: "User",
        entityId: input.userId,
        status: "SUCCESS",
        reqId: ctx.reqId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        newData: { sessionId: input.sessionId, targetUserId: input.userId },
      });
      return { ok: true };
    }),

  // Admin-only: revoke every active session for a user.
  revokeAllForUser: adminProcedure
    .input(z.object({ userId: z.string() }))
    .meta({ audit: { customerIdPath: "userId" } })
    .mutation(async ({ ctx, input }) => {
      const { count } = await ctx.prisma.session.deleteMany({
        where: { userId: input.userId },
      });
      skipAutoAudit(ctx);
      await writeAudit(ctx.prisma, {
        userId: ctx.user.id,
        category: "MUTATION",
        action: "session.revoked_all_by_admin",
        entity: "User",
        entityId: input.userId,
        status: "SUCCESS",
        reqId: ctx.reqId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        newData: { targetUserId: input.userId, revoked: count },
      });
      return { revoked: count };
    }),
});
