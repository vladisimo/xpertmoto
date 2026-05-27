import { TRPCError } from "@trpc/server";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { z } from "zod";
import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
  stepUpProcedure,
  trpcRateLimit,
} from "../trpc";
import { OAUTH_PROVIDER_IDS } from "@/lib/auth-providers";
import { writeAudit } from "@/server/services/audit";
import { verifyTotpCode, verifyRecoveryCode } from "@/lib/totp";
import { computeLockoutUpdate } from "@/lib/auth-lockout";
import { signStepUpToken } from "@/lib/auth-step-up-token";
import {
  forgotPasswordInputSchema,
  registerInputSchema,
  resetPasswordInputSchema,
  setPasswordInputSchema,
} from "@/lib/validators/auth";
import { TERMS_VERSION, PRIVACY_VERSION } from "@/lib/consent-versions";
import { trackServer, trackServerIdentify } from "@/lib/analytics";
import { sendEmail } from "@/lib/email";
import PasswordResetEmail from "../../../../emails/password-reset";
import {
  captureCustomerId,
  readCapturedCustomerId,
} from "@/server/services/audit";

/** Tokens issued for password reset expire after this many minutes. */
const PASSWORD_RESET_TTL_MINUTES = 30;

/** Prefix that distinguishes reset tokens from magic-link tokens in the
 *  shared VerificationToken table. */
const RESET_PREFIX = "password-reset:";

function buildResetIdentifier(email: string): string {
  return `${RESET_PREFIX}${email.toLowerCase()}`;
}

export const authRouter = createTRPCRouter({
  register: publicProcedure
    .use(
      trpcRateLimit<z.infer<typeof registerInputSchema>>({
        bucket: "auth:register",
        limit: 5,
        windowSec: 60 * 60,
        identifier: (_ctx, input) => input?.email,
      }),
    )
    .input(registerInputSchema)
    .meta({ audit: { customerIdPath: readCapturedCustomerId } })
    .mutation(async ({ ctx, input }) => {
      // Case-insensitive conflict check. Validator lowercases `input.email`
      // on new writes; the match mode also catches legacy mixed-case rows.
      const existing = await ctx.prisma.user.findFirst({
        where: { email: { equals: input.email, mode: "insensitive" } },
      });
      if (existing) throw new TRPCError({ code: "CONFLICT", message: "Email already registered" });
      const passwordHash = await bcrypt.hash(input.password, 10);
      const consentTimestamp = new Date();
      const user = await ctx.prisma.user.create({
        data: {
          email: input.email,
          passwordHash,
          firstName: input.firstName,
          lastName: input.lastName,
          phone: input.phone,
          dateOfBirth: input.dateOfBirth,
          role: "CUSTOMER",
          customerProfile: {
            create: {
              marketingOptIn: input.marketingOptIn,
              marketingSmsOptIn: input.marketingSmsOptIn,
              termsAcceptedAt: consentTimestamp,
              termsVersion: TERMS_VERSION,
              privacyAcceptedAt: consentTimestamp,
              privacyVersion: PRIVACY_VERSION,
            },
          },
        },
      });
      captureCustomerId(ctx, user.id);

      // Create the PostHog person profile up front and record the signup
      // event. Identify carries contact identifiers (email/name) plus
      // immutable first-touch props; both are server-side so they flow
      // through the pino redaction contract. Best-effort, never blocks.
      const fullName = `${input.firstName} ${input.lastName}`.trim();
      await trackServerIdentify({
        distinctId: user.id,
        set: { email: user.email, name: fullName, role: "CUSTOMER" },
        setOnce: {
          firstSeenAt: consentTimestamp.toISOString(),
          signupChannel: "REGISTRATION",
        },
      });
      await trackServer({
        event: "customer.registered",
        distinctId: user.id,
        properties: {
          marketingOptIn: input.marketingOptIn,
          marketingSmsOptIn: input.marketingSmsOptIn,
        },
      });

      return { id: user.id, email: user.email };
    }),

  /**
   * Request a password-reset email. Always returns success — we never leak
   * whether an account exists (enumeration protection). Rate-limited per
   * email and IP to prevent abuse.
   */
  requestPasswordReset: publicProcedure
    .use(
      trpcRateLimit<z.infer<typeof forgotPasswordInputSchema>>({
        bucket: "auth:forgot",
        limit: 5,
        windowSec: 60 * 60,
        identifier: (_ctx, input) => input?.email,
      }),
    )
    .input(forgotPasswordInputSchema)
    .meta({ audit: { customerIdPath: readCapturedCustomerId } })
    .mutation(async ({ ctx, input }) => {
      // `input.email` is already lowercased+trimmed by the schema; the
      // insensitive match also covers legacy mixed-case rows.
      const email = input.email;
      const user = await ctx.prisma.user.findFirst({
        where: { email: { equals: email, mode: "insensitive" } },
        select: { id: true, status: true, deletedAt: true },
      });
      captureCustomerId(ctx, user?.id);

      // Only send if the account exists and is active. We still return
      // success to the caller either way, so enumeration isn't possible.
      if (user && !user.deletedAt && user.status === "ACTIVE") {
        const token = crypto.randomBytes(32).toString("hex");
        const expires = new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES * 60 * 1000);

        // Clear any previous reset tokens for this address — one active at a time.
        await ctx.prisma.verificationToken.deleteMany({
          where: { identifier: buildResetIdentifier(email) },
        });
        await ctx.prisma.verificationToken.create({
          data: { identifier: buildResetIdentifier(email), token, expires },
        });

        const baseUrl =
          process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3000";
        const url = `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`;
        const { getBranding } = await import("@/lib/branding");
        const { siteName } = await getBranding();
        await sendEmail({
          to: email,
          subject: `Reset your ${siteName} password`,
          react: PasswordResetEmail({
            url,
            expiresInMinutes: PASSWORD_RESET_TTL_MINUTES,
            email,
            siteName,
          }),
        });
      }

      return { ok: true };
    }),

  /**
   * Consume a reset token and set a new password. Token is single-use — it
   * is deleted on success regardless of whether the new password write
   * succeeds (to avoid re-use after partial failure, the user simply
   * requests another reset).
   */
  resetPassword: publicProcedure
    .use(
      trpcRateLimit<z.infer<typeof resetPasswordInputSchema>>({
        bucket: "auth:reset",
        limit: 10,
        windowSec: 15 * 60,
        identifier: (_ctx, input) => input?.token?.slice(0, 16),
      }),
    )
    .input(resetPasswordInputSchema)
    .meta({ audit: { customerIdPath: readCapturedCustomerId } })
    .mutation(async ({ ctx, input }) => {
      const record = await ctx.prisma.verificationToken.findUnique({
        where: { token: input.token },
      });
      if (!record || !record.identifier.startsWith(RESET_PREFIX)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid or expired link" });
      }
      if (record.expires < new Date()) {
        await ctx.prisma.verificationToken
          .delete({ where: { token: input.token } })
          .catch(() => undefined);
        throw new TRPCError({ code: "BAD_REQUEST", message: "Link expired — request a new one" });
      }
      const email = record.identifier.slice(RESET_PREFIX.length);
      const user = await ctx.prisma.user.findFirst({
        where: { email: { equals: email, mode: "insensitive" } },
      });
      if (!user || user.deletedAt || user.status !== "ACTIVE") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Account unavailable" });
      }
      captureCustomerId(ctx, user.id);
      const passwordHash = await bcrypt.hash(input.password, 10);
      await ctx.prisma.$transaction([
        ctx.prisma.user.update({
          where: { id: user.id },
          data: {
            passwordHash,
            failedLoginCount: 0,
            lockedUntil: null,
          },
        }),
        // Burn the token and any siblings so a stolen email thread can't
        // recycle it.
        ctx.prisma.verificationToken.deleteMany({
          where: { identifier: record.identifier },
        }),
      ]);
      return { ok: true };
    }),

  /**
   * Set a password when the current account has none (e.g. migrated users
   * who signed in via magic link). Not for rotating an existing password —
   * that lives on a separate procedure that requires currentPassword.
   */
  setPassword: protectedProcedure
    .input(setPasswordInputSchema)
    .meta({
      audit: {
        customerIdPath: (_input: unknown, ctx: unknown) =>
          (ctx as { session?: { user?: { id?: string } } }).session?.user?.id,
      },
    })
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.prisma.user.findUnique({
        where: { id: ctx.session.user.id },
        select: { passwordHash: true },
      });
      if (!user) throw new TRPCError({ code: "NOT_FOUND" });
      if (user.passwordHash) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "A password is already set. Use 'Change password' instead.",
        });
      }
      const passwordHash = await bcrypt.hash(input.password, 10);
      await ctx.prisma.user.update({
        where: { id: ctx.session.user.id },
        data: { passwordHash },
      });
      return { ok: true };
    }),

  // Two-factor pre-check. Given email + password, returns whether 2FA
  // is required before the UI calls `signIn`. This duplicates a narrow
  // slice of the Credentials authorize flow but is necessary because
  // NextAuth's `signIn` can't signal "2FA required" to the client — it
  // collapses every authorize failure to `CredentialsSignin`. Runs
  // under the same IP + email rate limit as login to prevent using this
  // as an oracle for password verification.
  preauth: publicProcedure
    .use(
      trpcRateLimit<{ email: string; password: string }>({
        bucket: "auth:preauth",
        limit: 10,
        windowSec: 15 * 60,
        identifier: (_ctx, input) => input?.email,
      }),
    )
    .input(
      z
        .object({
          email: z.preprocess(
            (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
            z.string().email(),
          ),
          password: z.string().min(1),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      // Fall through to CredentialsSignin behaviour for missing / inactive
      // / wrong-password cases; do NOT leak which one. Case-insensitive
      // match covers legacy mixed-case rows.
      const user = await ctx.prisma.user.findFirst({
        where: { email: { equals: input.email, mode: "insensitive" } },
        select: {
          id: true,
          passwordHash: true,
          status: true,
          lockedUntil: true,
          totp: { select: { enabled: true } },
        },
      });
      if (!user?.passwordHash || user.status !== "ACTIVE") {
        return { status: "bad_credentials" as const };
      }
      if (user.lockedUntil && user.lockedUntil > new Date()) {
        return { status: "bad_credentials" as const };
      }
      const ok = await bcrypt.compare(input.password, user.passwordHash);
      if (!ok) return { status: "bad_credentials" as const };
      if (user.totp?.enabled) return { status: "need_totp" as const };
      return { status: "ok" as const };
    }),

  /**
   * Hint for the register page's "already registered" flow. Given an email,
   * tells the caller which sign-in methods (password + linked OAuth
   * providers) are available so the UI can surface the right CTA row
   * instead of a dead-end conflict message.
   *
   * This IS an email-enumeration oracle, so it's rate-limited aggressively:
   *   - 5 / IP / 15 minutes
   *   - 3 / email / hour
   * The normal flow is "user typed their own email into register and hit
   * conflict"; that's well under these limits. Abuse triggers 429.
   */
  existingAccountHint: publicProcedure
    .use(
      trpcRateLimit<{ email: string }>({
        bucket: "auth:hint:ip",
        limit: 5,
        windowSec: 15 * 60,
      }),
    )
    .use(
      trpcRateLimit<{ email: string }>({
        bucket: "auth:hint:email",
        limit: 3,
        windowSec: 60 * 60,
        identifier: (_ctx, input) => input?.email,
      }),
    )
    .input(
      z.object({
        email: z.preprocess(
          (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
          z.string().email(),
        ),
      }),
    )
    .query(async ({ ctx, input }) => {
      const user = await ctx.prisma.user.findFirst({
        where: {
          email: { equals: input.email, mode: "insensitive" },
          deletedAt: null,
          status: "ACTIVE",
        },
        select: {
          id: true,
          passwordHash: true,
          accounts: { select: { provider: true } },
        },
      });
      if (!user) {
        return { exists: false as const, methods: [] as string[] };
      }
      const methods: string[] = [];
      if (user.passwordHash) methods.push("password");
      for (const a of user.accounts) {
        if (OAUTH_PROVIDER_IDS.includes(a.provider as (typeof OAUTH_PROVIDER_IDS)[number])) {
          methods.push(a.provider);
        }
      }
      return { exists: true as const, methods };
    }),

  /**
   * List OAuth providers linked to the authenticated user's account. Used
   * by the Connected Accounts section on /dashboard/security.
   *
   * Note: the NextAuth `Account` model does not carry a `createdAt`
   * timestamp, so we can't show "linked at" here without a schema change.
   * We expose just the provider id and let the UI render "Connected".
   */
  listLinkedProviders: protectedProcedure.query(async ({ ctx }) => {
    const accounts = await ctx.prisma.account.findMany({
      where: { userId: ctx.session.user.id },
      select: { provider: true },
      orderBy: { provider: "asc" },
    });
    return accounts.map((a) => ({ provider: a.provider }));
  }),

  /**
   * Unlink an OAuth provider from the authenticated user's account. Guards
   * against leaving the user with no way back in: if the user has no
   * password set and this is their only remaining linked provider, the
   * operation is refused and the UI prompts them to set a password first.
   */
  disconnectProvider: protectedProcedure
    .input(
      z.object({
        provider: z.enum(OAUTH_PROVIDER_IDS),
      }),
    )
    .meta({
      audit: {
        customerIdPath: (_input: unknown, ctx: unknown) =>
          (ctx as { session?: { user?: { id?: string } } }).session?.user?.id,
      },
    })
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.prisma.user.findUnique({
        where: { id: ctx.session.user.id },
        select: {
          passwordHash: true,
          accounts: { select: { id: true, provider: true } },
        },
      });
      if (!user) throw new TRPCError({ code: "NOT_FOUND" });

      const target = user.accounts.find((a) => a.provider === input.provider);
      if (!target) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "That provider isn't connected to your account.",
        });
      }

      const remaining = user.accounts.length - 1;
      if (!user.passwordHash && remaining === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Set a password before disconnecting your last sign-in method.",
        });
      }

      await ctx.prisma.account.delete({ where: { id: target.id } });
      await writeAudit(ctx.prisma, {
        userId: ctx.session.user.id,
        category: "AUTH",
        action: "auth.unlink",
        entity: "User",
        entityId: ctx.session.user.id,
        status: "SUCCESS",
        newData: { provider: input.provider },
      });
      return { ok: true };
    }),

  /**
   * Complete the TOTP step-up after an OAuth or magic-link sign-in landed
   * on a user who has 2FA enrolled. Called by `/verify-2fa-step-up` once
   * the user has typed a 6-digit authenticator code or a recovery code.
   *
   * Shares the lockout ladder + rate-limiter with the credentials login
   * flow so OAuth+step-up cannot be abused as a TOTP brute-force oracle.
   * On success, the client must follow up with `useSession().update({
   * pending2faCleared: true })` so the JWT callback drops the flag.
   */
  verifyOauthStepUp: stepUpProcedure
    .use(
      trpcRateLimit<{ code: string }>({
        bucket: "auth:stepup",
        limit: 10,
        windowSec: 15 * 60,
        identifier: (ctx) => ctx.session?.user?.id,
      }),
    )
    .input(
      z
        .object({
          code: z.string().min(1).max(32),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      // Read the User + TOTP rows in one go so a single `findUnique` on
      // userId covers both the lockout and 2FA checks.
      const userId = ctx.session.user.id;
      const user = await ctx.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          status: true,
          deletedAt: true,
          failedLoginCount: true,
          lockedUntil: true,
          totp: {
            select: {
              id: true,
              encryptedSecret: true,
              recoveryCodes: true,
              enabled: true,
            },
          },
        },
      });

      const failStepUp = async (reason: string) => {
        await writeAudit(ctx.prisma, {
          userId,
          category: "AUTH",
          action: "auth.oauth.totp_step_up",
          entity: "User",
          entityId: userId,
          status: "FAILURE",
          newData: { reason },
        });
      };

      if (!user || user.deletedAt || user.status !== "ACTIVE") {
        await failStepUp("inactive");
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }
      if (user.lockedUntil && user.lockedUntil > new Date()) {
        await failStepUp("locked");
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Account is temporarily locked. Try again later.",
        });
      }
      if (!user.totp?.enabled) {
        // Unexpected: the JWT only sets `pending2fa` when totp.enabled was
        // true at sign-in time. Treat as a no-op success and still mint a
        // step-up token so the client can clear the (now-orphaned) flag.
        return { ok: true as const, stepUpToken: signStepUpToken(userId) };
      }

      const submitted = input.code.trim();
      let passed = false;
      let consumedRecoveryIndex: number | null = null;

      if (/^\d{6}$/.test(submitted)) {
        passed = verifyTotpCode(
          submitted,
          user.totp.encryptedSecret as unknown as {
            enc: string;
            iv: string;
            tag: string;
          },
        );
      } else {
        const codes = Array.isArray(user.totp.recoveryCodes)
          ? (user.totp.recoveryCodes as string[])
          : [];
        const match = verifyRecoveryCode(submitted, codes);
        if (match.matched) {
          passed = true;
          consumedRecoveryIndex = match.index;
        }
      }

      if (!passed) {
        const update = computeLockoutUpdate(user.failedLoginCount);
        await ctx.prisma.user.update({
          where: { id: user.id },
          data: {
            failedLoginCount: update.failedLoginCount,
            lockedUntil: update.lockedUntil,
            lastFailedLoginAt: update.lastFailedLoginAt,
          },
        });
        await failStepUp(update.locked ? "locked_now" : "bad_code");
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: update.locked
            ? "Too many invalid codes — account is now locked."
            : "Invalid 2FA code",
        });
      }

      // Success: consume recovery code (if used), clear the lockout
      // counter, stamp lastUsedAt, and audit. The client follows up with
      // `useSession().update({ pending2faCleared: true })` to drop the
      // pending flag from the JWT.
      if (consumedRecoveryIndex !== null) {
        const codes = Array.isArray(user.totp.recoveryCodes)
          ? (user.totp.recoveryCodes as string[])
          : [];
        codes.splice(consumedRecoveryIndex, 1);
        await ctx.prisma.userTotp.update({
          where: { id: user.totp.id },
          data: { recoveryCodes: codes, lastUsedAt: new Date() },
        });
      } else {
        await ctx.prisma.userTotp.update({
          where: { id: user.totp.id },
          data: { lastUsedAt: new Date() },
        });
      }
      await ctx.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockedUntil: null },
      });
      await writeAudit(ctx.prisma, {
        userId,
        category: "AUTH",
        action: "auth.oauth.totp_step_up",
        entity: "User",
        entityId: userId,
        status: "SUCCESS",
        newData: { usedRecoveryCode: consumedRecoveryIndex !== null },
      });
      // The step-up token is the only way to clear `pending2fa` on the
      // JWT. The client passes it straight into `useSession().update(...)`;
      // the jwt callback verifies the HMAC + expiry + bound user id
      // before dropping the flag. See `auth-step-up-token.ts`.
      return {
        ok: true as const,
        stepUpToken: signStepUpToken(userId),
      };
    }),
});
