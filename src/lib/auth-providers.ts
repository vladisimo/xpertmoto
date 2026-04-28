/**
 * Thin, dependency-free module for "which OAuth providers are configured".
 * Lives outside `src/lib/auth.ts` so that modules which only need the list of
 * provider ids (tRPC router, UI pages) don't transitively pull in NextAuth
 * + Prisma + the top-level-await Apple secret builder at import time.
 */

/**
 * Canonical provider ids surfaced on the login / register pages and in the
 * Connected Accounts UI.
 */
export const OAUTH_PROVIDER_IDS = [
  "google",
  "apple",
  "microsoft-entra-id",
  "github",
] as const;

export type OAuthProviderId = (typeof OAUTH_PROVIDER_IDS)[number];

/**
 * Which OAuth providers are enabled by env. A provider only registers when
 * all its required env vars are set — missing keys let local dev boot
 * without each provider. Also consumed by the UI so we don't render buttons
 * for providers that would 500 on callback.
 */
export function getEnabledOAuthProviders(): OAuthProviderId[] {
  const out: OAuthProviderId[] = [];
  if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) out.push("google");
  if (process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET) out.push("github");
  if (process.env.AUTH_MICROSOFT_ID && process.env.AUTH_MICROSOFT_SECRET) {
    out.push("microsoft-entra-id");
  }
  if (
    process.env.AUTH_APPLE_ID &&
    process.env.AUTH_APPLE_TEAM_ID &&
    process.env.AUTH_APPLE_KEY_ID &&
    process.env.AUTH_APPLE_PRIVATE_KEY
  ) {
    out.push("apple");
  }
  return out;
}
