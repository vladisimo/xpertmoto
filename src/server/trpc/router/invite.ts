import { TRPCError } from "@trpc/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import {
  createTRPCRouter,
  publicProcedure,
  trpcRateLimit,
} from "../trpc";
import { strongPasswordField } from "@/lib/validators/auth";
import { INVITE_PREFIX, buildInviteIdentifier } from "@/server/services/staff-invite";
import { writeAudit } from "@/server/services/audit";

const tokenField = z.string().min(10, "Invalid token");

/**
 * Look up the User that an invite token points at. `null` if the token is
 * unknown, expired, or the prefix is wrong. Burns expired tokens so they
 * can't be re-read.
 */
type InvitePrisma = Pick<PrismaClient, "verificationToken" | "user">;

async function resolveInvite(
  prisma: InvitePrisma,
  token: string,
): Promise<
  | {
      ok: true;
      user: {
        id: string;
        email: string;
        firstName: string | null;
        lastName: string | null;
        role: string;
      };
    }
  | { ok: false; reason: "invalid" | "expired" | "already_activated" }
> {
  const record = await prisma.verificationToken.findUnique({ where: { token } });
  if (!record || !record.identifier.startsWith(INVITE_PREFIX)) {
    return { ok: false, reason: "invalid" };
  }
  if (record.expires < new Date()) {
    await prisma.verificationToken
      .delete({ where: { token } })
      .catch(() => undefined);
    return { ok: false, reason: "expired" };
  }
  const email = record.identifier.slice(INVITE_PREFIX.length);
  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" }, deletedAt: null },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      passwordHash: true,
    },
  });
  if (!user) return { ok: false, reason: "invalid" };
  if (user.passwordHash) return { ok: false, reason: "already_activated" };
  return {
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
    },
  };
}

export const inviteRouter = createTRPCRouter({
  /**
   * Pre-flight check for /accept-invite. Tells the page whether to render
   * the set-password form or an error. Rate-limited to stop token-guessing.
   */
  preview: publicProcedure
    .use(
      trpcRateLimit<{ token: string }>({
        bucket: "invite:preview",
        limit: 20,
        windowSec: 15 * 60,
        identifier: (_ctx, input) => input?.token?.slice(0, 16),
      }),
    )
    .input(z.object({ token: tokenField }))
    .query(async ({ ctx, input }) => {
      const res = await resolveInvite(ctx.prisma, input.token);
      if (!res.ok) return { valid: false as const, reason: res.reason };
      return {
        valid: true as const,
        email: res.user.email,
        firstName: res.user.firstName,
        lastName: res.user.lastName,
        role: res.user.role,
      };
    }),

  /**
   * Consume the invite token: set the password, activate the account, burn
   * the token. Single-use — any replay after success fails the token lookup.
   * Returns `requiresTotp: true` for staff-ish roles so the client can
   * redirect to /totp/enroll before landing on the back-office.
   */
  accept: publicProcedure
    .use(
      trpcRateLimit<{ token: string }>({
        bucket: "invite:accept",
        limit: 10,
        windowSec: 15 * 60,
        identifier: (_ctx, input) => input?.token?.slice(0, 16),
      }),
    )
    .input(
      z.object({
        token: tokenField,
        password: strongPasswordField,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const res = await resolveInvite(ctx.prisma, input.token);
      if (!res.ok) {
        if (res.reason === "already_activated") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This invitation has already been used. Sign in instead.",
          });
        }
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid or expired link — ask your administrator to resend.",
        });
      }

      const passwordHash = await bcrypt.hash(input.password, 10);
      const identifier = buildInviteIdentifier(res.user.email);
      await ctx.prisma.$transaction([
        ctx.prisma.user.update({
          where: { id: res.user.id },
          data: {
            passwordHash,
            status: "ACTIVE",
            emailVerified: new Date(),
            failedLoginCount: 0,
            lockedUntil: null,
          },
        }),
        ctx.prisma.verificationToken.deleteMany({ where: { identifier } }),
      ]);

      await writeAudit(ctx.prisma, {
        userId: res.user.id,
        category: "AUTH",
        action: "auth.invite_accepted",
        entity: "User",
        entityId: res.user.id,
        status: "SUCCESS",
        reqId: ctx.reqId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });

      const requiresTotp =
        res.user.role === "STAFF" ||
        res.user.role === "MANAGER" ||
        res.user.role === "ADMIN" ||
        res.user.role === "SUPER_ADMIN";

      return { ok: true as const, email: res.user.email, requiresTotp };
    }),
});
