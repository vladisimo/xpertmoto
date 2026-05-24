import NextAuth, { type DefaultSession } from "next-auth";
import { decode as defaultJwtDecode } from "next-auth/jwt";
import Apple from "next-auth/providers/apple";
import Credentials from "next-auth/providers/credentials";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import Nodemailer from "next-auth/providers/nodemailer";
import type { Provider } from "next-auth/providers";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { UserRole } from "@prisma/client";
import { writeAudit } from "@/server/services/audit";
import { headerIp, headerUserAgent } from "@/lib/request-meta";
import { rateLimit } from "@/lib/rate-limit";
import { computeLockoutUpdate } from "@/lib/auth-lockout";
import { sendEmail } from "@/lib/email";
import { evaluateSignIn } from "@/lib/auth-signin";
import { defaultGithubEmailsFetcher } from "@/lib/oauth-verification";
import { buildAppleClientSecret } from "@/lib/apple-client-secret";
import { logger } from "@/lib/logger";
import { getSetting, SETTING_DEFAULTS } from "@/lib/settings";
import {
  shouldFlagPending2fa,
  shouldClearPending2fa,
  isPending2faExpired,
} from "@/lib/auth-step-up-token";
import { needsOnboarding } from "@/lib/onboarding-status";
import MagicLinkEmail from "../../emails/magic-link";
import crypto from "node:crypto";

const IMPERSONATION_TOKEN_TTL_MS = 60 * 1000; // 60s — token is one-shot, used immediately after the tRPC call returns it.

/**
 * Sign a short-lived impersonation handoff token. Payload:
 *   `${targetUserId}.${impersonatorId}.${expiresAtMs}`
 * signed with HMAC-SHA256 over AUTH_SECRET. Single-use — the NextAuth
 * Credentials provider verifies the signature and expiry before issuing
 * a session JWT for the target user carrying `impersonatorId`.
 */
export function signImpersonationToken(args: {
  targetUserId: string;
  impersonatorId: string;
}): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not configured");
  const expiresAt = Date.now() + IMPERSONATION_TOKEN_TTL_MS;
  const payload = `${args.targetUserId}.${args.impersonatorId}.${expiresAt}`;
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function verifyImpersonationToken(token: string):
  | { ok: true; targetUserId: string; impersonatorId: string }
  | { ok: false } {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return { ok: false };
  const parts = token.split(".");
  if (parts.length !== 4) return { ok: false };
  const [targetUserId, impersonatorId, expiresAtStr, sig] = parts;
  if (!targetUserId || !impersonatorId || !expiresAtStr || !sig) return { ok: false };
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${targetUserId}.${impersonatorId}.${expiresAtStr}`)
    .digest("base64url");
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) {
    return { ok: false };
  }
  const expiresAt = Number(expiresAtStr);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return { ok: false };
  return { ok: true, targetUserId, impersonatorId };
}

const LOGIN_RATE_LIMIT = 10;
const LOGIN_WINDOW_SEC = 15 * 60; // 15 minutes — matches CLAUDE.md F1 spec.

/** Magic-link tokens expire after this window. */
const MAGIC_LINK_TTL_MINUTES = 15;

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: UserRole;
      depotId: string | null;
    } & DefaultSession["user"];
    // When an admin is acting on behalf of another user, this carries the
    // admin's real user id. The UI renders a persistent banner whenever
    // this is set, and the tRPC audit middleware tags every mutation with
    // it so the audit trail unambiguously shows admin-initiated actions.
    impersonatorId?: string | null;
    // Set when a user signs in via OAuth (or magic link) and has TOTP
    // enrolled — the session is established but unusable for protected
    // routes until the user completes a step-up via the
    // `auth.verifyOauthStepUp` mutation. The middleware in protected
    // layouts and tRPC `protectedProcedure` treat any session with this
    // flag as anonymous for everything except the step-up itself.
    pending2fa?: boolean;
    // Set for CUSTOMER role when the customer has not yet completed the
    // self-service onboarding wizard (or when one of the four consent
    // versions has bumped since they last completed it). Customer
    // layout redirects to /onboarding; protectedProcedure rejects with
    // FORBIDDEN; only the dedicated onboardingProcedure honours these
    // sessions. Cleared on the next `useSession().update()` after
    // `onboarding.complete` succeeds.
    requiresOnboarding?: boolean;
    // Set on first sign-in for back-office roles when the user also has a
    // customerProfile row — drives the post-login `/portal-select` page so
    // a staff/manager/admin who personally books vehicles can choose
    // between the customer portal and their back-office workspace.
    hasCustomerProfile?: boolean;
  }
  interface User {
    role?: UserRole;
    depotId?: string | null;
    impersonatorId?: string | null;
  }
}

const credentialsSchema = z.object({
  email: z.preprocess(
    (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
    z.string().email(),
  ),
  password: z.string().min(1),
  // Optional 2FA code. When the user has `UserTotp.enabled = true`, the
  // authorize function requires this and rejects the login if missing
  // or invalid. On the login form, absence surfaces as a specific
  // "2fa_required" error code the UI uses to show a second-step input.
  totpCode: z.string().optional(),
});

/** Mask an email for display in the preview pane: `jo***@example.com`. */
function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return email;
  const head = local.slice(0, 2);
  return `${head}${"*".repeat(Math.max(local.length - 2, 1))}@${domain}`;
}

// Build the OAuth provider list. Apple's clientSecret is an ES256-signed
// JWT we produce ourselves; we resolve it once at module load (top-level
// await) and cache for ~6 months. A process restart rebuilds it — the JWT
// signing is sub-millisecond so this is fine.
const oauthProviders: Provider[] = [];
if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) {
  oauthProviders.push(
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      allowDangerousEmailAccountLinking: true,
    }),
  );
}
if (process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET) {
  oauthProviders.push(
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID,
      clientSecret: process.env.AUTH_GITHUB_SECRET,
      allowDangerousEmailAccountLinking: true,
      // `user:email` scope lets us call /user/emails in the signIn callback
      // to assert the primary email is verified (GitHub doesn't put that
      // in the id_token).
      authorization: { params: { scope: "read:user user:email" } },
    }),
  );
}
if (process.env.AUTH_MICROSOFT_ID && process.env.AUTH_MICROSOFT_SECRET) {
  const tenant = process.env.AUTH_MICROSOFT_TENANT_ID ?? "common";
  oauthProviders.push(
    MicrosoftEntraID({
      clientId: process.env.AUTH_MICROSOFT_ID,
      clientSecret: process.env.AUTH_MICROSOFT_SECRET,
      issuer: `https://login.microsoftonline.com/${tenant}/v2.0`,
      allowDangerousEmailAccountLinking: true,
    }),
  );
}
if (
  process.env.AUTH_APPLE_ID &&
  process.env.AUTH_APPLE_TEAM_ID &&
  process.env.AUTH_APPLE_KEY_ID &&
  process.env.AUTH_APPLE_PRIVATE_KEY
) {
  try {
    const appleClientSecret = await buildAppleClientSecret();
    oauthProviders.push(
      Apple({
        clientId: process.env.AUTH_APPLE_ID,
        clientSecret: appleClientSecret,
        allowDangerousEmailAccountLinking: true,
      }),
    );
  } catch (err) {
    logger.error({ err }, "auth: failed to build Apple client secret — Apple provider disabled");
  }
}

// Warn (don't throw) if any OAuth client is configured but AUTH_URL isn't —
// the callback URL derives from AUTH_URL and misconfiguration silently
// surfaces later as a redirect mismatch on the provider side.
if (oauthProviders.length > 0 && !process.env.AUTH_URL) {
  logger.warn("auth: OAuth providers configured but AUTH_URL is unset — callback URLs will be wrong");
}

// Our User model has firstName/lastName/avatarUrl, NOT name/image. The stock
// PrismaAdapter.createUser hands Prisma `{ name, email, image, emailVerified }`
// directly, which trips "Argument firstName is missing" on first-time OAuth
// signups. Wrap createUser to split the OAuth-provided name and remap image.
// All other adapter methods are unaffected — getUser/getUserByEmail return
// raw Prisma User shape, and AdapterUser's `name`/`image` are optional so
// missing them at the type boundary is harmless (the JWT/session callbacks
// project identity from `firstName`/`lastName`/`avatarUrl` directly).
function splitName(name: string | null | undefined): { firstName: string; lastName: string } {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return { firstName: "—", lastName: "—" };
  const parts = trimmed.split(/\s+/);
  const firstName = parts.shift() ?? "—";
  const lastName = parts.length > 0 ? parts.join(" ") : "—";
  return { firstName, lastName };
}

const baseAdapter = PrismaAdapter(prisma);
const prismaAdapter: typeof baseAdapter = {
  ...baseAdapter,
  createUser: async (data) => {
    const { name, image, email, emailVerified } = data as {
      name?: string | null;
      image?: string | null;
      email: string;
      emailVerified: Date | null;
    };
    const { firstName, lastName } = splitName(name);
    const created = await prisma.user.create({
      data: {
        email,
        emailVerified,
        firstName,
        lastName,
        avatarUrl: image ?? null,
      },
    });
    return {
      ...created,
      name: `${created.firstName} ${created.lastName}`.trim(),
      image: created.avatarUrl,
    } as Awaited<ReturnType<NonNullable<typeof baseAdapter.createUser>>>;
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: prismaAdapter,
  session: { strategy: "jwt" },
  // Treat undecryptable session cookies (e.g. issued under a rotated
  // AUTH_SECRET) as anonymous instead of throwing. Without this, NextAuth
  // logs a multi-line `JWTSessionError` stack trace on every request that
  // touches `auth()` until the browser's stale cookie is cleared. Scoped to
  // the session-token salt so PKCE/state/nonce decode errors propagate with
  // their real message instead of being masked as "could not be parsed".
  jwt: {
    async decode(params) {
      const salt = typeof params.salt === "string" ? params.salt : "";
      const isSessionSalt =
        salt.endsWith("xpertmoto.session-token") ||
        salt.endsWith("authjs.session-token");
      if (!isSessionSalt) return defaultJwtDecode(params);
      try {
        return await defaultJwtDecode(params);
      } catch (err) {
        logger.debug(
          { err: err instanceof Error ? err.message : String(err) },
          "auth: undecryptable session cookie, treating as anonymous",
        );
        return null;
      }
    },
  },
  pages: {
    signIn: "/login",
  },
  // `sameSite: "lax"` is required for OAuth sign-in: Chrome treats every
  // hop in a redirect chain whose initiator is cross-site (e.g. Google →
  // our callback → /login) as cross-site, so a Strict session cookie set
  // on the callback hop is not sent on the next same-origin hop — the user
  // lands back on /login still appearing unauthenticated even though the
  // cookie is in the jar. Lax still blocks the realistic CSRF shapes
  // (cross-site form POST to state-changing URLs) and NextAuth protects
  // POSTs with its own CSRF token on top of that.
  // Name is unique-per-app (`xpertmoto.`) because the sibling dfortix SSO
  // app at .dfortix.ai sets a domain-wide `__Secure-authjs.session-token`;
  // any NextAuth app on a sibling subdomain that uses the default cookie
  // name reads that sibling's token, fails to decrypt it with its own
  // AUTH_SECRET, and bounces users to /login in a loop. The `__Host-`
  // prefix forces host-only + Secure + Path=/ — browsers reject it if
  // Domain is set, so the sibling app physically cannot collide with this
  // name. Keep the `__Host-` prefix only in production; in dev (http),
  // `__Host-` would prevent the cookie from being set at all.
  cookies: {
    sessionToken: {
      name:
        process.env.NODE_ENV === "production"
          ? "__Host-xpertmoto.session-token"
          : "xpertmoto.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
    callbackUrl: {
      name:
        process.env.NODE_ENV === "production"
          ? "__Host-xpertmoto.callback-url"
          : "xpertmoto.callback-url",
      options: {
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
    csrfToken: {
      name:
        process.env.NODE_ENV === "production"
          ? "__Host-xpertmoto.csrf-token"
          : "xpertmoto.csrf-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
  },
  providers: [
    ...oauthProviders,
    // Magic-link (email) provider. Primary first-login path for users
    // migrated from the legacy system (no passwords transferred) and a
    // passwordless option for everyone else. The `server` field is a
    // placeholder — we don't let NextAuth send emails itself; instead
    // `sendVerificationRequest` routes through our own transport which
    // supports Resend, SMTP, and a console fallback.
    Nodemailer({
      server: { host: "unused", port: 0 },
      from: "no-reply@xpertmoto.com.au",
      maxAge: MAGIC_LINK_TTL_MINUTES * 60,
      async sendVerificationRequest({ identifier, url }) {
        const maskedEmail = maskEmail(identifier);
        const { getBranding } = await import("@/lib/branding");
        const { siteName } = await getBranding();
        await sendEmail({
          to: identifier,
          subject: `Your ${siteName} sign-in link`,
          react: MagicLinkEmail({
            url,
            expiresInMinutes: MAGIC_LINK_TTL_MINUTES,
            email: maskedEmail,
            siteName,
          }),
        });
      },
    }),
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        const headers = request instanceof Request ? request.headers : undefined;
        const ipAddress = headers ? headerIp(headers) : undefined;
        const userAgent = headers ? headerUserAgent(headers) : undefined;
        const rawEmail = typeof credentials?.email === "string" ? credentials.email : undefined;
        const failLogin = (reason: string, userId?: string | null) =>
          writeAudit(prisma, {
            userId: userId ?? null,
            category: "AUTH",
            action: "auth.login",
            // Tag to the user when we know who they are so the failure row
            // surfaces on that customer's staff Activity tab. Pre-identity
            // failures (bad input, rate-limit, user_not_found) fall back to
            // the generic 'Auth' bucket.
            entity: userId ? "User" : "Auth",
            entityId: userId ?? undefined,
            status: "FAILURE",
            method: "POST",
            path: "/api/auth/callback/credentials",
            ipAddress,
            userAgent,
            newData: { email: rawEmail, reason, provider: "credentials" },
          });

        const parsed = credentialsSchema.safeParse(credentials);
        if (!parsed.success) {
          await failLogin("invalid_input");
          return null;
        }

        // IP-layer rate limit (CLAUDE.md F1: 10 attempts per 15 minutes).
        // Runs before bcrypt so a flood can't burn CPU. Also bucketed by
        // email so rotating-proxy attacks on one account still trip.
        const ipKey = ipAddress ?? "unknown";
        const [ipLimit, emailLimit] = await Promise.all([
          rateLimit(`auth:login:ip:${ipKey}`, LOGIN_RATE_LIMIT, LOGIN_WINDOW_SEC),
          rateLimit(`auth:login:email:${parsed.data.email}`, LOGIN_RATE_LIMIT, LOGIN_WINDOW_SEC),
        ]);
        if (!ipLimit.ok || !emailLimit.ok) {
          await failLogin("rate_limited");
          return null;
        }

        // Case-insensitive lookup: the validator lowercases new writes, but
        // legacy rows may still have mixed-case addresses.
        const user = await prisma.user.findFirst({
          where: { email: { equals: parsed.data.email, mode: "insensitive" } },
        });
        if (!user || !user.passwordHash) {
          await failLogin("user_not_found");
          return null;
        }

        // Identity-layer lockout. Triggered after LOCKOUT_THRESHOLD failed
        // attempts; blocks even correct password until lockedUntil expires.
        if (user.lockedUntil && user.lockedUntil > new Date()) {
          await failLogin("locked", user.id);
          return null;
        }

        const ok = await bcrypt.compare(parsed.data.password, user.passwordHash);
        if (!ok) {
          const update = computeLockoutUpdate(user.failedLoginCount);
          await prisma.user.update({
            where: { id: user.id },
            data: {
              failedLoginCount: update.failedLoginCount,
              lockedUntil: update.lockedUntil,
              lastFailedLoginAt: update.lastFailedLoginAt,
            },
          });
          await failLogin(update.locked ? "locked_now" : "bad_password", user.id);
          return null;
        }
        if (user.status !== "ACTIVE") {
          await failLogin("inactive", user.id);
          return null;
        }

        // 2FA gate. If the user has enabled TOTP, they must also provide
        // a valid code or a recovery code. Failed 2FA counts toward the
        // lockout ladder alongside bad passwords.
        const totp = await prisma.userTotp.findUnique({
          where: { userId: user.id },
          select: {
            id: true,
            encryptedSecret: true,
            recoveryCodes: true,
            enabled: true,
          },
        });
        if (totp?.enabled) {
          const submitted = parsed.data.totpCode?.trim() ?? "";
          if (!submitted) {
            await failLogin("2fa_required", user.id);
            return null;
          }
          const { verifyTotpCode, verifyRecoveryCode } = await import("./totp");
          let passed = false;
          let consumedRecoveryIndex: number | null = null;
          if (/^\d{6}$/.test(submitted)) {
            passed = verifyTotpCode(
              submitted,
              totp.encryptedSecret as unknown as {
                enc: string;
                iv: string;
                tag: string;
              },
            );
          } else {
            const codes = Array.isArray(totp.recoveryCodes)
              ? (totp.recoveryCodes as string[])
              : [];
            const match = verifyRecoveryCode(submitted, codes);
            if (match.matched) {
              passed = true;
              consumedRecoveryIndex = match.index;
            }
          }
          if (!passed) {
            await failLogin("2fa_invalid", user.id);
            return null;
          }
          if (consumedRecoveryIndex !== null) {
            const codes = Array.isArray(totp.recoveryCodes)
              ? (totp.recoveryCodes as string[])
              : [];
            codes.splice(consumedRecoveryIndex, 1);
            await prisma.userTotp.update({
              where: { id: totp.id },
              data: { recoveryCodes: codes, lastUsedAt: new Date() },
            });
          } else {
            await prisma.userTotp.update({
              where: { id: totp.id },
              data: { lastUsedAt: new Date() },
            });
          }
        }

        await prisma.user.update({
          where: { id: user.id },
          data: {
            lastLoginAt: new Date(),
            failedLoginCount: 0,
            lockedUntil: null,
          },
        });
        return {
          id: user.id,
          email: user.email,
          name: `${user.firstName} ${user.lastName}`,
          role: user.role,
          depotId: user.depotId,
        };
      },
    }),
    // Impersonation provider. Accepts a single short-lived HMAC-signed
    // token (see signImpersonationToken) that names the target user + the
    // admin. We verify the signature + expiry, then emit a User object
    // with `impersonatorId` set so the jwt callback stores it on the
    // token. This never sees a password — the gate is the admin procedure
    // that minted the token (superAdminProcedure in impersonation.ts).
    Credentials({
      id: "impersonate",
      name: "Impersonation handoff",
      credentials: { token: { label: "token", type: "text" } },
      async authorize(credentials) {
        const token = credentials?.token;
        if (typeof token !== "string") return null;
        const result = verifyImpersonationToken(token);
        if (!result.ok) return null;
        const [target, impersonator] = await Promise.all([
          prisma.user.findUnique({ where: { id: result.targetUserId } }),
          prisma.user.findUnique({ where: { id: result.impersonatorId } }),
        ]);
        if (
          !target ||
          target.status !== "ACTIVE" ||
          target.role !== "CUSTOMER"
        )
          return null;
        if (
          !impersonator ||
          !["ADMIN", "SUPER_ADMIN"].includes(impersonator.role)
        )
          return null;
        await writeAudit(prisma, {
          userId: target.id,
          impersonatorId: impersonator.id,
          category: "AUTH",
          action: "impersonation.signed_in",
          entity: "User",
          entityId: target.id,
          status: "SUCCESS",
        });
        return {
          id: target.id,
          email: target.email,
          name: `${target.firstName} ${target.lastName}`,
          role: target.role,
          depotId: target.depotId,
          impersonatorId: impersonator.id,
        };
      },
    }),
  ],
  callbacks: {
    // Delegated to `evaluateSignIn` so the decision logic is pure and unit-
    // tested. Returns true to allow, false to silently block, or a redirect
    // URL (`/login?error=...`) to surface a specific failure state.
    async signIn({ user, account, profile }) {
      return evaluateSignIn({
        provider: account?.provider,
        email: user.email,
        profile: profile as Record<string, unknown> | undefined,
        accessToken: account?.access_token ?? null,
        deps: {
          findUserByEmailCI: async (email) => {
            const row = await prisma.user.findFirst({
              where: { email: { equals: email, mode: "insensitive" } },
              select: { id: true, role: true, status: true, deletedAt: true },
            });
            return row;
          },
          writeAudit: async ({ userId, action, provider, providerEmail }) => {
            await writeAudit(prisma, {
              userId,
              category: "AUTH",
              action,
              entity: "User",
              entityId: userId,
              status: "SUCCESS",
              newData: { provider, email: providerEmail },
            });
          },
          fetchGithubEmails: defaultGithubEmailsFetcher,
          oauthAllowedForBackOffice: () =>
            getSetting<boolean>(
              "auth.oauthAllowedForBackOffice",
              SETTING_DEFAULTS["auth.oauthAllowedForBackOffice"],
            ),
        },
      });
    },
    async jwt({ token, user, account, trigger, session: updatedSession }) {
      // First-pass token (sign-in): populate identity claims and decide
      // whether the user owes a TOTP step-up before this session can be
      // trusted for protected routes. Step-up applies to OAuth and magic
      // link only — credentials already enforced TOTP in `authorize`,
      // and the impersonate provider is gated server-side at mint time.
      if (user) {
        const t = token as Record<string, unknown>;
        t.id = user.id as string;
        const role = (user.role ?? "CUSTOMER") as UserRole;
        t.role = role;
        t.depotId = user.depotId ?? null;
        if (user.impersonatorId) {
          t.impersonatorId = user.impersonatorId;
        }
        const provider = account?.provider;
        if (user.id) {
          const totp = await prisma.userTotp.findUnique({
            where: { userId: user.id as string },
            select: { enabled: true },
          });
          if (
            shouldFlagPending2fa({
              provider,
              totpEnabled: totp?.enabled === true,
            })
          ) {
            t.pending2fa = true;
            // `pendingSince` powers the TTL gate below — sessions that
            // sit in pending2fa for longer than PENDING_2FA_TTL_MS get
            // invalidated rather than honoured indefinitely.
            t.pendingSince = Date.now();
            // Audit the entry into the holding pattern so abandoned
            // step-ups (sign-in but never verified) are visible alongside
            // the auth.signup / auth.login row from `events.signIn`.
            await writeAudit(prisma, {
              userId: user.id as string,
              category: "AUTH",
              action: "auth.oauth.pending_step_up",
              entity: "User",
              entityId: user.id as string,
              status: "SUCCESS",
              newData: { provider },
            });
          }
          if (role === "CUSTOMER") {
            const profile = await prisma.customerProfile.findUnique({
              where: { userId: user.id as string },
              select: { onboardedAt: true, onboardingVersion: true },
            });
            if (needsOnboarding(profile)) {
              t.requiresOnboarding = true;
            }
          } else {
            const profile = await prisma.customerProfile.findUnique({
              where: { userId: user.id as string },
              select: { id: true },
            });
            if (profile) {
              t.hasCustomerProfile = true;
            }
          }
        }
        return token;
      }

      const t = token as Record<string, unknown>;
      const id = t.id as string | undefined;

      // TTL gate: if a session has been camping at `pending2fa` for
      // longer than the cap, drop it on the floor. The user lands back
      // on /login and starts fresh.
      if (
        isPending2faExpired({
          pending2fa: t.pending2fa as boolean | undefined,
          pendingSince: t.pendingSince as number | undefined,
        })
      ) {
        return null;
      }

      // Step-up clearing: the client calls `useSession().update({
      // stepUpToken })` after a successful `auth.verifyOauthStepUp`.
      // The token is HMAC-bound to the user id and short-lived, so an
      // attacker cannot forge one from devtools — only a fresh, valid
      // step-up can drop the flag.
      if (
        id &&
        shouldClearPending2fa({
          trigger,
          sessionPayload: updatedSession,
          userId: id,
        })
      ) {
        delete t.pending2fa;
        delete t.pendingSince;
      }

      if (id) {
        const exists = await prisma.user.findUnique({ where: { id }, select: { id: true } });
        if (!exists) return null;
      }
      // Re-read onboarding state on `useSession().update()` so the session
      // reflects a just-completed onboarding wizard. Mirrors the pending2fa
      // clearing pattern above.
      //
      // For CUSTOMER, drive the requiresOnboarding flag (the global gate).
      // For back-office roles we NEVER set requiresOnboarding (it would lock
      // them out of the back office via protectedProcedure) — instead we
      // refresh hasCustomerProfile so /portal-select starts offering the
      // Customer tile the instant onboarding completes.
      if (id && trigger === "update") {
        const profile = await prisma.customerProfile.findUnique({
          where: { userId: id },
          select: { id: true, onboardedAt: true, onboardingVersion: true },
        });
        if (t.role === "CUSTOMER") {
          if (needsOnboarding(profile)) {
            t.requiresOnboarding = true;
          } else {
            delete t.requiresOnboarding;
          }
        } else if (profile) {
          t.hasCustomerProfile = true;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        const t = token as Record<string, unknown>;
        session.user.id = t.id as string;
        session.user.role = t.role as UserRole;
        session.user.depotId = (t.depotId as string | null) ?? null;
        session.impersonatorId = (t.impersonatorId as string | null) ?? null;
        session.pending2fa = t.pending2fa === true ? true : undefined;
        session.requiresOnboarding = t.requiresOnboarding === true ? true : undefined;
        session.hasCustomerProfile = t.hasCustomerProfile === true ? true : undefined;
      }
      return session;
    },
  },
  events: {
    async signIn({ user, account, isNewUser }) {
      if (!user.id) return;
      await writeAudit(prisma, {
        userId: user.id,
        category: "AUTH",
        action: isNewUser ? "auth.signup" : "auth.login",
        entity: "User",
        entityId: user.id,
        status: "SUCCESS",
        method: "POST",
        path: "/api/auth/callback",
        newData: {
          provider: account?.provider,
          email: user.email,
          isNewUser: Boolean(isNewUser),
        },
      });
    },
    async signOut(message) {
      const userId =
        "token" in message && message.token
          ? ((message.token as Record<string, unknown>).id as string | undefined)
          : undefined;
      await writeAudit(prisma, {
        userId: userId ?? null,
        category: "AUTH",
        action: "auth.logout",
        entity: userId ? "User" : "Auth",
        entityId: userId,
        status: "SUCCESS",
        method: "POST",
        path: "/api/auth/signout",
      });
    },
    async linkAccount({ user, account }) {
      if (!user.id) return;
      await writeAudit(prisma, {
        userId: user.id,
        category: "AUTH",
        action: "auth.link",
        entity: "User",
        entityId: user.id,
        status: "SUCCESS",
        newData: { provider: account.provider },
      });
    },
  },
});
