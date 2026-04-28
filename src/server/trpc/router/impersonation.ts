import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  createTRPCRouter,
  superAdminProcedure,
  protectedProcedure,
} from "../trpc";
import { writeAudit } from "@/server/services/audit";
import { signImpersonationToken } from "@/lib/auth";

/**
 * Admin "view as user" support. Starting an impersonation revokes the
 * admin's own current session (so they can't accidentally mix contexts)
 * and mints a fresh Session row for the target user with `impersonatorId`
 * set to the admin's user id. The audit middleware tags every subsequent
 * mutation with the same id so the audit log unambiguously shows which
 * actions were admin-initiated.
 */
export const impersonationRouter = createTRPCRouter({
  start: superAdminProcedure
    .input(z.object({ targetUserId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (input.targetUserId === ctx.user.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Can't impersonate yourself.",
        });
      }
      const target = await ctx.prisma.user.findUnique({
        where: { id: input.targetUserId },
        select: { id: true, role: true, status: true },
      });
      if (!target) throw new TRPCError({ code: "NOT_FOUND" });
      if (target.status !== "ACTIVE") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Can't impersonate a suspended/banned user.",
        });
      }
      // Don't allow staff-on-staff impersonation — use a shared sandbox
      // account instead if you need to test UI. Customer support use
      // cases are the only intended path here.
      if (target.role !== "CUSTOMER") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only customer accounts can be impersonated.",
        });
      }

      // Mint the short-lived HMAC handoff token. The caller redirects
      // the admin's browser to `/api/impersonate?token=...` which signs
      // them in as the target user via the "impersonate" Credentials
      // provider in src/lib/auth.ts. The provider verifies signature +
      // expiry and emits a NextAuth JWT carrying `impersonatorId` —
      // which the session callback surfaces and the audit middleware
      // tags every subsequent mutation with.
      const token = signImpersonationToken({
        targetUserId: target.id,
        impersonatorId: ctx.user.id,
      });
      await writeAudit(ctx.prisma, {
        userId: target.id,
        impersonatorId: ctx.user.id,
        category: "AUTH",
        action: "impersonation.started",
        entity: "User",
        entityId: target.id,
        status: "SUCCESS",
        newData: { targetUserId: target.id },
      });
      return { token, expiresInSeconds: 60 };
    }),

  // Called from the impersonation banner's "End impersonation" button.
  // Deletes the impersonation session and returns the admin to their
  // own login page (they'll need to re-auth — this is intentional; a
  // single button press shouldn't silently swap identities).
  end: protectedProcedure.mutation(async ({ ctx }) => {
    // The current session's impersonatorId comes through auth() — pull it
    // directly from Prisma to stay authoritative.
    const active = await ctx.prisma.session.findFirst({
      where: {
        userId: ctx.user.id,
        impersonatorId: { not: null },
        expires: { gt: new Date() },
      },
      orderBy: { expires: "desc" },
    });
    if (!active) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "No active impersonation session.",
      });
    }
    await ctx.prisma.session.delete({ where: { id: active.id } });
    await writeAudit(ctx.prisma, {
      userId: active.userId,
      impersonatorId: active.impersonatorId,
      category: "AUTH",
      action: "impersonation.ended",
      entity: "Session",
      entityId: active.id,
      status: "SUCCESS",
    });
    return { ended: true };
  }),
});
