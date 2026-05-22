import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  createTRPCRouter,
  protectedProcedure,
  trpcRateLimit,
} from "../trpc";
import {
  generateTotpEnrolment,
  verifyTotpCode,
  verifyRecoveryCode,
} from "@/lib/totp";
import { skipAutoAudit, writeAudit } from "@/server/services/audit";
import type { EncryptedSecret } from "@/lib/crypto";

// Meta helper so the auto-audit middleware tags mutations with entity='User',
// entityId=<user id> — surfaces 2FA changes on the customer Activity tab.
const selfAudit = {
  audit: {
    customerIdPath: (_: unknown, ctx: unknown) =>
      (ctx as { session?: { user?: { id?: string } } }).session?.user?.id,
  },
} as const;

// Shape of CustomerProfile.licenceNumberEnc etc. and UserTotp.encryptedSecret
// once unwrapped from Prisma's Json column type.
function coerceEncrypted(raw: unknown): EncryptedSecret {
  if (
    !raw ||
    typeof raw !== "object" ||
    typeof (raw as { enc?: unknown }).enc !== "string" ||
    typeof (raw as { iv?: unknown }).iv !== "string" ||
    typeof (raw as { tag?: unknown }).tag !== "string"
  ) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Encrypted secret is malformed",
    });
  }
  return raw as EncryptedSecret;
}

export const totpRouter = createTRPCRouter({
  status: protectedProcedure.query(async ({ ctx }) => {
    const totp = await ctx.prisma.userTotp.findUnique({
      where: { userId: ctx.user.id },
      select: { enabled: true, enabledAt: true, lastUsedAt: true },
    });
    const recoveryCount = totp?.enabled
      ? (
          await ctx.prisma.userTotp.findUnique({
            where: { userId: ctx.user.id },
            select: { recoveryCodes: true },
          })
        )?.recoveryCodes
      : null;
    return {
      enabled: !!totp?.enabled,
      enabledAt: totp?.enabledAt ?? null,
      lastUsedAt: totp?.lastUsedAt ?? null,
      recoveryCodesRemaining: Array.isArray(recoveryCount)
        ? recoveryCount.length
        : 0,
    };
  }),

  // Phase 1 of enrolment — generate a secret, return the otpauth URL + the
  // plaintext recovery codes ONCE. Caller renders the QR code from the URL
  // and displays recovery codes for the user to save. The record is stored
  // with `enabled=false` until `enable()` confirms the user successfully
  // scanned by submitting a valid code.
  beginEnrolment: protectedProcedure
    .use(
      trpcRateLimit({ bucket: "totp:begin", limit: 5, windowSec: 300 }),
    )
    .meta(selfAudit)
    .mutation(async ({ ctx }) => {
      const existing = await ctx.prisma.userTotp.findUnique({
        where: { userId: ctx.user.id },
        select: { enabled: true },
      });
      if (existing?.enabled) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "2FA is already enabled. Disable it first to re-enrol.",
        });
      }
      const email = ctx.user.email ?? `user-${ctx.user.id}@xpertmoto.local`;
      const enrolment = generateTotpEnrolment(email);
      await ctx.prisma.userTotp.upsert({
        where: { userId: ctx.user.id },
        create: {
          userId: ctx.user.id,
          encryptedSecret: enrolment.encryptedSecret,
          recoveryCodes: enrolment.hashedRecoveryCodes,
          enabled: false,
        },
        update: {
          encryptedSecret: enrolment.encryptedSecret,
          recoveryCodes: enrolment.hashedRecoveryCodes,
          enabled: false,
          enabledAt: null,
        },
      });
      return {
        otpauthUrl: enrolment.otpauthUrl,
        secretBase32: enrolment.secretBase32,
        recoveryCodes: enrolment.recoveryCodesPlain,
      };
    }),

  // Phase 2 — user submits a code from their authenticator app. If it
  // matches, flip `enabled=true`.
  confirmEnrolment: protectedProcedure
    .input(z.object({ code: z.string().min(6).max(6) }))
    .use(trpcRateLimit({ bucket: "totp:confirm", limit: 10, windowSec: 300 }))
    .meta(selfAudit)
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.prisma.userTotp.findUnique({
        where: { userId: ctx.user.id },
      });
      if (!row) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No enrolment in progress" });
      }
      if (row.enabled) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "2FA already enabled" });
      }
      const ok = verifyTotpCode(input.code, coerceEncrypted(row.encryptedSecret));
      if (!ok) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid code" });
      }
      await ctx.prisma.userTotp.update({
        where: { userId: ctx.user.id },
        data: { enabled: true, enabledAt: new Date(), lastUsedAt: new Date() },
      });
      // Replace the auto-audit row with one tagged to the user so 2FA
      // changes surface on the staff Activity tab.
      skipAutoAudit(ctx);
      await writeAudit(ctx.prisma, {
        userId: ctx.user.id,
        category: "MUTATION",
        action: "auth.2fa_enabled",
        entity: "User",
        entityId: ctx.user.id,
        status: "SUCCESS",
        reqId: ctx.reqId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });
      return { enabled: true };
    }),

  disable: protectedProcedure
    .input(z.object({ code: z.string().min(6) }))
    .use(trpcRateLimit({ bucket: "totp:disable", limit: 5, windowSec: 300 }))
    .meta(selfAudit)
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.prisma.userTotp.findUnique({
        where: { userId: ctx.user.id },
      });
      if (!row?.enabled) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "2FA not enabled" });
      }
      const ok = verifyTotpCode(input.code, coerceEncrypted(row.encryptedSecret));
      if (!ok) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid code" });
      }
      await ctx.prisma.userTotp.delete({ where: { userId: ctx.user.id } });
      skipAutoAudit(ctx);
      await writeAudit(ctx.prisma, {
        userId: ctx.user.id,
        category: "MUTATION",
        action: "auth.2fa_disabled",
        entity: "User",
        entityId: ctx.user.id,
        status: "SUCCESS",
        reqId: ctx.reqId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });
      return { disabled: true };
    }),

  regenerateRecoveryCodes: protectedProcedure
    .input(z.object({ code: z.string().min(6) }))
    .use(trpcRateLimit({ bucket: "totp:recovery", limit: 3, windowSec: 3600 }))
    .meta(selfAudit)
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.prisma.userTotp.findUnique({
        where: { userId: ctx.user.id },
      });
      if (!row?.enabled) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "2FA not enabled" });
      }
      const ok = verifyTotpCode(input.code, coerceEncrypted(row.encryptedSecret));
      if (!ok) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid code" });
      }
      const freshEnrolment = generateTotpEnrolment(ctx.user.email ?? "");
      await ctx.prisma.userTotp.update({
        where: { userId: ctx.user.id },
        data: { recoveryCodes: freshEnrolment.hashedRecoveryCodes },
      });
      return { recoveryCodes: freshEnrolment.recoveryCodesPlain };
    }),
});

// Pure helpers exported for unit testing without a Prisma client.
export { coerceEncrypted };
// Re-export the verifier so NextAuth's credentials flow can call it
// without re-importing from lib/totp directly.
export { verifyTotpCode, verifyRecoveryCode };
