import crypto from "node:crypto";

/** Step-up tokens are short-lived single-use handoffs from the
 *  `auth.verifyOauthStepUp` mutation to the jwt callback. Sixty seconds
 *  is plenty of time for the round-trip and tight enough that a leaked
 *  token has a tiny replay window. */
const STEP_UP_TOKEN_TTL_MS = 60 * 1000;

/**
 * How long a fresh OAuth / magic-link sign-in is allowed to sit in the
 * `pending2fa` holding pattern before it expires server-side and is
 * treated as anonymous. Ten minutes covers the realistic case of a user
 * fishing their authenticator app out of a drawer; longer than that and
 * we'd rather force them to sign in again than let a half-authenticated
 * cookie loiter.
 */
export const PENDING_2FA_TTL_MS = 10 * 60 * 1000;

/**
 * Sign a step-up handoff token bound to a user id. Mirrors the pattern
 * used by `signImpersonationToken` in `auth.ts`: HMAC over AUTH_SECRET,
 * payload carries an absolute expiry, signature is base64url. Tokens
 * are not stored — verification is purely cryptographic.
 *
 * Throws when AUTH_SECRET is missing rather than silently degrading;
 * a misconfigured secret means every sign-in will land in `pending2fa`
 * with no way out, which we'd rather catch loudly at boot.
 */
export function signStepUpToken(userId: string): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not configured");
  const expiresAt = Date.now() + STEP_UP_TOKEN_TTL_MS;
  const payload = `${userId}.${expiresAt}`;
  const sig = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
  return `${payload}.${sig}`;
}

/**
 * Verify a step-up token. Checks signature, expiry, and that the bound
 * user id matches the caller. Constant-time comparison on the signature.
 * Returns false on any failure — we never leak which check tripped.
 */
export function verifyStepUpToken(
  token: string,
  expectedUserId: string,
): boolean {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [userId, expiresAtStr, sig] = parts;
  if (!userId || !expiresAtStr || !sig) return false;
  if (userId !== expectedUserId) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${userId}.${expiresAtStr}`)
    .digest("base64url");
  try {
    if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) {
      return false;
    }
  } catch {
    // Buffer.from on a malformed sig can produce a different length than
    // `expected`; timingSafeEqual then throws. Treat as invalid.
    return false;
  }
  const expiresAt = Number(expiresAtStr);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;
  return true;
}

/** Pure decision: should this sign-in be flagged `pending2fa`? */
export interface Pending2faFlagArgs {
  /** Sign-in provider id (e.g. "google", "credentials"). */
  provider: string | undefined;
  /** Whether the user has TOTP currently enabled. */
  totpEnabled: boolean;
}

/**
 * Returns true when the JWT should carry `pending2fa`. Skipped for the
 * credentials and impersonate providers — credentials enforces TOTP in
 * its own authorize flow, and impersonate is gated server-side at mint
 * time. Every other provider (OAuth + magic link) routes through the
 * step-up flow when TOTP is enrolled.
 */
export function shouldFlagPending2fa(args: Pending2faFlagArgs): boolean {
  if (!args.totpEnabled) return false;
  if (args.provider === "credentials" || args.provider === "impersonate") {
    return false;
  }
  return true;
}

/** Pure decision: is this `pending2fa` token past its TTL? */
export interface Pending2faExpiryArgs {
  pending2fa: boolean | undefined;
  pendingSince: number | undefined;
  /** Override Date.now() for tests. */
  now?: number;
}

/**
 * Returns true when the session must be invalidated because it has been
 * sitting in `pending2fa` for longer than {@link PENDING_2FA_TTL_MS},
 * OR when the session is flagged `pending2fa` but is missing the
 * `pendingSince` timestamp entirely (true for sessions minted before
 * this gate shipped — we'd rather force them through a fresh sign-in
 * than honour an unbounded pending session).
 */
export function isPending2faExpired(args: Pending2faExpiryArgs): boolean {
  if (args.pending2fa !== true) return false;
  if (typeof args.pendingSince !== "number") return true;
  const now = args.now ?? Date.now();
  return now - args.pendingSince > PENDING_2FA_TTL_MS;
}

/** Pure decision: is the client-supplied step-up token valid for this user? */
export interface Pending2faClearArgs {
  /** NextAuth `trigger` arg passed to the jwt callback. */
  trigger: string | undefined;
  /** NextAuth `session` arg passed to the jwt callback (the data the
   *  client supplied to `useSession().update(...)`). */
  sessionPayload: unknown;
  /** Authenticated user id from the current token. */
  userId: string;
  /** Override the verifier (used by tests to avoid setting AUTH_SECRET). */
  verify?: (token: string, expectedUserId: string) => boolean;
}

/**
 * Returns true when the jwt callback should drop the `pending2fa` flag.
 * The client-supplied `stepUpToken` is the only trusted signal — the
 * server signs it inside `auth.verifyOauthStepUp` only after a real TOTP
 * verification succeeds, so an attacker poking `useSession().update(...)`
 * from devtools cannot forge one without AUTH_SECRET.
 */
export function shouldClearPending2fa(args: Pending2faClearArgs): boolean {
  if (args.trigger !== "update") return false;
  if (!args.sessionPayload || typeof args.sessionPayload !== "object") {
    return false;
  }
  const tok = (args.sessionPayload as Record<string, unknown>).stepUpToken;
  if (typeof tok !== "string" || tok.length === 0) return false;
  const verify = args.verify ?? verifyStepUpToken;
  return verify(tok, args.userId);
}
