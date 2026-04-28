import type { UserRole, UserStatus } from "@prisma/client";
import { OAUTH_PROVIDER_IDS } from "./auth-providers";
import {
  isOAuthEmailVerified,
  type GithubEmailsFetcher,
} from "./oauth-verification";

/**
 * Decision made by `evaluateSignIn`. Matches NextAuth's `signIn` callback
 * return: `true` allows, `false` silently blocks, and a string is a redirect
 * URL used to surface a specific error on the login page.
 *
 * We reserve `false` for cases where we don't want to leak the reason
 * (nodemailer blocked user, unknown provider); OAuth uses string redirects
 * so the login page can render a friendly message.
 */
export type SignInDecision = boolean | string;

/** Matches the subset of the Prisma User row we need to evaluate sign-in. */
export interface SignInUser {
  id: string;
  role: UserRole;
  status: UserStatus;
  deletedAt: Date | null;
}

export interface SignInDeps {
  findUserByEmailCI: (email: string) => Promise<SignInUser | null>;
  writeAudit: (args: {
    userId: string;
    action: string;
    provider: string;
    providerEmail: string;
  }) => Promise<void>;
  fetchGithubEmails?: GithubEmailsFetcher;
  /**
   * Whether back-office users (STAFF / MANAGER / ADMIN / SUPER_ADMIN) may
   * complete OAuth sign-in. Reads the `auth.oauthAllowedForBackOffice`
   * SystemSetting in production; tests pass a constant. When `false`,
   * back-office users are rejected with `OAuthDisabledForBackOffice` and must
   * fall back to email + password (which still enforces TOTP).
   *
   * Customers are never gated by this flag.
   */
  oauthAllowedForBackOffice: () => Promise<boolean>;
}

export interface EvaluateSignInArgs {
  provider: string | undefined;
  email: string | null | undefined;
  profile: Record<string, unknown> | undefined;
  accessToken: string | null | undefined;
  deps: SignInDeps;
}

/** OAuth providers we integrate with. Used to decide which branch to run. */
const OAUTH_PROVIDERS = new Set<string>(OAUTH_PROVIDER_IDS);

/** Error codes surfaced via `/login?error=<code>`. Keep in sync with the
 *  login page `errorMessage()` mapping. */
export const SignInErrorCodes = {
  NoEmail: "OAuthNoEmail",
  EmailUnverified: "OAuthEmailUnverified",
  // Emitted only when the `auth.oauthAllowedForBackOffice` SystemSetting
  // is off. The role itself is no longer a hard block — see CLAUDE.md §F1.
  DisabledForBackOffice: "OAuthDisabledForBackOffice",
  AccountUnavailable: "AccountUnavailable",
} as const;

function redirect(code: string): string {
  return `/login?error=${code}`;
}

/**
 * Pure decision function for NextAuth's signIn callback. Wired up via a thin
 * adapter in `src/lib/auth.ts` that passes prisma / audit / fetch functions
 * as `deps`. All behaviour is testable without a live DB.
 *
 * Order of operations:
 *   1. credentials / impersonate → allow (they run their own gates).
 *   2. nodemailer → enforce the active-user guard.
 *   3. OAuth providers:
 *      - require a non-empty, verified email from the provider;
 *      - if a DB user with that email exists, must be ACTIVE and not soft-
 *        deleted. Back-office roles (STAFF / MANAGER / ADMIN / SUPER_ADMIN)
 *        also require the `auth.oauthAllowedForBackOffice` SystemSetting
 *        to be on — when off, they're rejected here and must use email +
 *        password (which enforces TOTP separately). Back-office OAuth
 *        sessions are flagged `pending2fa` downstream so the user
 *        completes a TOTP step-up before any back-office route renders;
 *        that part is wired in `auth.ts`, not here.
 *      - otherwise allow (adapter will create a fresh CUSTOMER row).
 */
export async function evaluateSignIn(
  args: EvaluateSignInArgs,
): Promise<SignInDecision> {
  const { provider, email, profile, accessToken, deps } = args;

  if (provider === "credentials" || provider === "impersonate") return true;

  if (provider === "nodemailer") {
    if (!email) return false;
    const user = await deps.findUserByEmailCI(email.trim().toLowerCase());
    // Nodemailer sign-up is allowed when no row exists (adapter creates one).
    if (!user) return true;
    if (user.deletedAt) return false;
    if (user.status !== "ACTIVE") return false;
    return true;
  }

  if (!provider || !OAUTH_PROVIDERS.has(provider)) {
    // Unknown provider shape — refuse rather than accidentally trust it.
    return false;
  }

  const normalized = (email ?? "").trim().toLowerCase();
  if (!normalized) return redirect(SignInErrorCodes.NoEmail);

  const verified = await isOAuthEmailVerified({
    provider,
    profile,
    accessToken,
    providerEmail: normalized,
    fetchGithubEmails: deps.fetchGithubEmails,
  });
  if (!verified) return redirect(SignInErrorCodes.EmailUnverified);

  const user = await deps.findUserByEmailCI(normalized);
  // First-time OAuth sign-up: let NextAuth's adapter create the user +
  // account row. The `signIn` event will audit the new user downstream.
  if (!user) return true;

  if (user.deletedAt) return redirect(SignInErrorCodes.AccountUnavailable);
  if (user.status !== "ACTIVE")
    return redirect(SignInErrorCodes.AccountUnavailable);
  if (user.role !== "CUSTOMER") {
    const allowed = await deps.oauthAllowedForBackOffice();
    if (!allowed) return redirect(SignInErrorCodes.DisabledForBackOffice);
  }

  // Existing ACTIVE customer — allow adapter to auto-link via
  // `allowDangerousEmailAccountLinking: true`. Audit the link separately
  // from NextAuth's own `linkAccount` event so reports can tell "link-to-
  // existing-user" apart from "first-time OAuth signup".
  await deps.writeAudit({
    userId: user.id,
    action: "auth.oauth.linked_existing_user",
    provider,
    providerEmail: normalized,
  });
  return true;
}
