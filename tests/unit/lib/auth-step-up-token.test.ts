import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import {
  signStepUpToken,
  verifyStepUpToken,
  shouldFlagPending2fa,
  shouldClearPending2fa,
  isPending2faExpired,
  PENDING_2FA_TTL_MS,
} from "@/lib/auth-step-up-token";

const ORIGINAL_AUTH_SECRET = process.env.AUTH_SECRET;
process.env.AUTH_SECRET = "test-secret-do-not-use-in-prod";

afterAll(() => {
  if (ORIGINAL_AUTH_SECRET === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = ORIGINAL_AUTH_SECRET;
});

beforeEach(() => {
  vi.useRealTimers();
});

describe("signStepUpToken / verifyStepUpToken", () => {
  test("a freshly-signed token verifies against its bound user id", () => {
    const tok = signStepUpToken("u_123");
    expect(verifyStepUpToken(tok, "u_123")).toBe(true);
  });

  test("a token bound to user A is rejected for user B", () => {
    const tok = signStepUpToken("u_a");
    expect(verifyStepUpToken(tok, "u_b")).toBe(false);
  });

  test("a tampered signature is rejected", () => {
    const tok = signStepUpToken("u_1");
    const parts = tok.split(".");
    parts[2] = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const tampered = parts.join(".");
    expect(verifyStepUpToken(tampered, "u_1")).toBe(false);
  });

  test("a tampered payload is rejected (sig won't match)", () => {
    const tok = signStepUpToken("u_1");
    const parts = tok.split(".");
    parts[1] = String(Number(parts[1]) + 999);
    const tampered = parts.join(".");
    expect(verifyStepUpToken(tampered, "u_1")).toBe(false);
  });

  test("an expired token is rejected", () => {
    vi.useFakeTimers();
    const tok = signStepUpToken("u_1");
    // TTL is 60s — advance 61s.
    vi.advanceTimersByTime(61_000);
    expect(verifyStepUpToken(tok, "u_1")).toBe(false);
  });

  test("a malformed token (wrong number of segments) is rejected", () => {
    expect(verifyStepUpToken("not-a-token", "u_1")).toBe(false);
    expect(verifyStepUpToken("a.b", "u_1")).toBe(false);
    expect(verifyStepUpToken("a.b.c.d", "u_1")).toBe(false);
  });

  test("a token with a non-numeric expiry is rejected", () => {
    // Forge a payload that wouldn't pass HMAC anyway; verify that the
    // numeric check is also defensive.
    expect(verifyStepUpToken("u_1.notanumber.AAAA", "u_1")).toBe(false);
  });

  test("a sig of a different length is rejected (not a thrown error)", () => {
    // Buffer.from() on the short sig produces a length mismatch with
    // `expected`; timingSafeEqual would throw, and we want the verifier
    // to swallow that and return false rather than 500.
    const tok = signStepUpToken("u_1");
    const parts = tok.split(".");
    parts[2] = "short";
    const malformed = parts.join(".");
    expect(verifyStepUpToken(malformed, "u_1")).toBe(false);
  });

  test("verify returns false when AUTH_SECRET is missing", () => {
    const original = process.env.AUTH_SECRET;
    delete process.env.AUTH_SECRET;
    try {
      // Sign with a placeholder secret won't be possible — instead, just
      // hand the verifier any string and confirm it refuses to operate
      // without a secret rather than NPE.
      expect(verifyStepUpToken("any.123.sig", "u_1")).toBe(false);
    } finally {
      process.env.AUTH_SECRET = original;
    }
  });
});

describe("shouldFlagPending2fa", () => {
  test.each([
    ["google", true, true],
    ["apple", true, true],
    ["microsoft-entra-id", true, true],
    ["github", true, true],
    ["nodemailer", true, true],
  ])("%s + totp enabled → flagged", (provider, totpEnabled, expected) => {
    expect(shouldFlagPending2fa({ provider, totpEnabled })).toBe(expected);
  });

  test("credentials never flags (TOTP already verified in authorize)", () => {
    expect(
      shouldFlagPending2fa({ provider: "credentials", totpEnabled: true }),
    ).toBe(false);
  });

  test("impersonate never flags (gated server-side at mint time)", () => {
    expect(
      shouldFlagPending2fa({ provider: "impersonate", totpEnabled: true }),
    ).toBe(false);
  });

  test("no TOTP enrolled → never flags, regardless of provider", () => {
    expect(
      shouldFlagPending2fa({ provider: "google", totpEnabled: false }),
    ).toBe(false);
    expect(
      shouldFlagPending2fa({ provider: "credentials", totpEnabled: false }),
    ).toBe(false);
  });

  test("undefined provider + TOTP enabled → flagged (unknown provider treated like OAuth)", () => {
    // A real unknown provider would get rejected upstream in evaluateSignIn,
    // but the helper should still default to "yes, gate it" rather than
    // accidentally leaking through.
    expect(
      shouldFlagPending2fa({ provider: undefined, totpEnabled: true }),
    ).toBe(true);
  });
});

describe("isPending2faExpired", () => {
  const NOW = 1_700_000_000_000; // arbitrary fixed epoch

  test("not flagged → never expired", () => {
    expect(
      isPending2faExpired({
        pending2fa: undefined,
        pendingSince: undefined,
        now: NOW,
      }),
    ).toBe(false);
    expect(
      isPending2faExpired({
        pending2fa: false,
        pendingSince: NOW,
        now: NOW,
      }),
    ).toBe(false);
  });

  test("flagged + within TTL → not expired", () => {
    expect(
      isPending2faExpired({
        pending2fa: true,
        pendingSince: NOW - (PENDING_2FA_TTL_MS - 1000),
        now: NOW,
      }),
    ).toBe(false);
  });

  test("flagged + past TTL → expired", () => {
    expect(
      isPending2faExpired({
        pending2fa: true,
        pendingSince: NOW - (PENDING_2FA_TTL_MS + 1000),
        now: NOW,
      }),
    ).toBe(true);
  });

  test("flagged + missing pendingSince → expired (defensive: pre-TTL sessions)", () => {
    expect(
      isPending2faExpired({
        pending2fa: true,
        pendingSince: undefined,
        now: NOW,
      }),
    ).toBe(true);
  });
});

describe("shouldClearPending2fa", () => {
  test("ignores anything that's not a valid update trigger", () => {
    expect(
      shouldClearPending2fa({
        trigger: undefined,
        sessionPayload: { stepUpToken: "anything" },
        userId: "u_1",
        verify: () => true,
      }),
    ).toBe(false);
    expect(
      shouldClearPending2fa({
        trigger: "signIn",
        sessionPayload: { stepUpToken: "anything" },
        userId: "u_1",
        verify: () => true,
      }),
    ).toBe(false);
  });

  test("rejects update with no payload", () => {
    expect(
      shouldClearPending2fa({
        trigger: "update",
        sessionPayload: undefined,
        userId: "u_1",
        verify: () => true,
      }),
    ).toBe(false);
  });

  test("rejects update with no stepUpToken", () => {
    expect(
      shouldClearPending2fa({
        trigger: "update",
        sessionPayload: {},
        userId: "u_1",
        verify: () => true,
      }),
    ).toBe(false);
  });

  test("rejects an attacker who passes a non-string token field", () => {
    // The attacker-facing risk: from devtools, calling `update({
    // stepUpToken: true })` to try and bypass the verifier. The helper
    // must refuse anything that isn't a non-empty string.
    expect(
      shouldClearPending2fa({
        trigger: "update",
        sessionPayload: { stepUpToken: true },
        userId: "u_1",
        verify: () => true,
      }),
    ).toBe(false);
    expect(
      shouldClearPending2fa({
        trigger: "update",
        sessionPayload: { stepUpToken: "" },
        userId: "u_1",
        verify: () => true,
      }),
    ).toBe(false);
  });

  test("calls verify with the user id from the token, not from the payload", () => {
    const verify = vi.fn().mockReturnValue(true);
    shouldClearPending2fa({
      trigger: "update",
      sessionPayload: { stepUpToken: "good-token", userId: "u_attacker" },
      userId: "u_real",
      verify,
    });
    expect(verify).toHaveBeenCalledWith("good-token", "u_real");
  });

  test("returns whatever the verifier returns", () => {
    expect(
      shouldClearPending2fa({
        trigger: "update",
        sessionPayload: { stepUpToken: "x" },
        userId: "u_1",
        verify: () => false,
      }),
    ).toBe(false);
    expect(
      shouldClearPending2fa({
        trigger: "update",
        sessionPayload: { stepUpToken: "x" },
        userId: "u_1",
        verify: () => true,
      }),
    ).toBe(true);
  });

  test("end-to-end: HMAC verifier accepts a real token and refuses a forged one", () => {
    // The real verifier (no override) rejects anything not signed by us.
    expect(
      shouldClearPending2fa({
        trigger: "update",
        sessionPayload: { stepUpToken: "u_1.99999999999999.fakebogussig" },
        userId: "u_1",
      }),
    ).toBe(false);
    // But a freshly-signed token round-trips.
    const real = signStepUpToken("u_1");
    expect(
      shouldClearPending2fa({
        trigger: "update",
        sessionPayload: { stepUpToken: real },
        userId: "u_1",
      }),
    ).toBe(true);
  });
});
