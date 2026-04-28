import { describe, expect, test, beforeEach, vi } from "vitest";

// A 32-byte value encoded as base64 (44 chars). The env schema enforces
// that SECRET_ENC_KEY / ETOLL_ENC_KEY decode to exactly 32 bytes.
const THIRTY_TWO_BYTES_BASE64 = Buffer.alloc(32, 1).toString("base64");

const REQUIRED_MIN = {
  DATABASE_URL: "postgres://user:pass@localhost:5432/db",
  AUTH_SECRET: "a".repeat(32),
  SECRET_ENC_KEY: THIRTY_TWO_BYTES_BASE64,
  NODE_ENV: "development",
};

const TRACKED_KEYS = [
  "NODE_ENV",
  "DATABASE_URL",
  "AUTH_SECRET",
  "AUTH_URL",
  "SECRET_ENC_KEY",
  "ETOLL_ENC_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "ALLOW_STUB_STRIPE",
  "APP_URL",
  "IP_HASH_SALT",
  // Email-provider keys — production validation requires at least one of
  // these to be set. Clear both so tests have deterministic baseline and
  // can opt in per scenario.
  "RESEND_API_KEY",
  "SMTP_HOST",
] as const;

function reset() {
  for (const k of TRACKED_KEYS) delete process.env[k];
}

async function loadEnv(overrides: Record<string, string | undefined>) {
  reset();
  for (const [k, v] of Object.entries(overrides)) {
    if (v !== undefined) process.env[k] = v;
  }
  vi.resetModules();
  try {
    const mod = await import("@/lib/env");
    return { ok: true as const, env: mod.env };
  } catch (err) {
    return { ok: false as const, err: err as Error };
  }
}

describe("env schema", () => {
  beforeEach(() => reset());

  test("accepts a valid minimum env", async () => {
    const result = await loadEnv(REQUIRED_MIN);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.env.DATABASE_URL).toBe(REQUIRED_MIN.DATABASE_URL);
    }
  });

  test("rejects missing DATABASE_URL", async () => {
    const result = await loadEnv({ ...REQUIRED_MIN, DATABASE_URL: undefined });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.err.message).toMatch(/DATABASE_URL/);
    }
  });

  test("rejects short AUTH_SECRET", async () => {
    const result = await loadEnv({ ...REQUIRED_MIN, AUTH_SECRET: "short" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.err.message).toMatch(/AUTH_SECRET/);
    }
  });

  test("accepts legacy ETOLL_ENC_KEY in place of SECRET_ENC_KEY", async () => {
    const result = await loadEnv({
      ...REQUIRED_MIN,
      SECRET_ENC_KEY: undefined,
      ETOLL_ENC_KEY: THIRTY_TWO_BYTES_BASE64,
    });
    expect(result.ok).toBe(true);
  });

  test("rejects SECRET_ENC_KEY that does not decode to 32 bytes", async () => {
    const result = await loadEnv({
      ...REQUIRED_MIN,
      SECRET_ENC_KEY: "k".repeat(32),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.err.message).toMatch(/SECRET_ENC_KEY/);
    }
  });

  test("rejects the dev AUTH_SECRET placeholder in production", async () => {
    const result = await loadEnv({
      ...REQUIRED_MIN,
      NODE_ENV: "production",
      AUTH_URL: "https://x.example",
      APP_URL: "https://y.example",
      IP_HASH_SALT: "a".repeat(32),
      AUTH_SECRET: "dev-secret-change-me-dev-secret-change-me-xx",
      ALLOW_STUB_STRIPE: "1",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.err.message).toMatch(/AUTH_SECRET/);
    }
  });

  test("requires Stripe keys in production unless ALLOW_STUB_STRIPE=1", async () => {
    const prodBase = {
      ...REQUIRED_MIN,
      NODE_ENV: "production",
      AUTH_URL: "https://x.example",
      APP_URL: "https://y.example",
      IP_HASH_SALT: "a".repeat(32),
      // Prod validation requires at least one email-provider key; set one
      // so the assertion below isolates the Stripe requirement.
      SMTP_HOST: "smtp.example",
    };

    const missing = await loadEnv(prodBase);
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.err.message).toMatch(/STRIPE_SECRET_KEY/);
    }

    const stubbed = await loadEnv({ ...prodBase, ALLOW_STUB_STRIPE: "1" });
    expect(stubbed.ok).toBe(true);
  });
});
