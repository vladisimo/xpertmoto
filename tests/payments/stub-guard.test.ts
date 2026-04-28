import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * G19 — production stub-mode guard.
 *
 *   - In development / test with no Stripe config, stub responses are
 *     returned and nothing throws.
 *   - In production with no Stripe config, createPaymentIntent throws.
 *   - `ALLOW_STUB_STRIPE=1` opts out of the guard (for tests).
 */

vi.mock("@/lib/integration-config", () => ({
  getSecret: vi.fn().mockResolvedValue(null), // always unconfigured
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("G19 — production stub-mode guard", () => {
  beforeEach(() => vi.resetModules());

  it("returns stub id in development when Stripe unconfigured", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { createPaymentIntent } = await import("@/lib/stripe");
    const r = await createPaymentIntent({
      amount: 49,
      bookingId: "book_guard_1",
      customerEmail: "x@y.co",
      description: "test",
    });
    expect(r.id).toBe("pi_stub_book_guard_1");
    expect(r.status).toBe("succeeded");
  });

  it("throws in production when Stripe unconfigured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_STUB_STRIPE", "");
    const { createPaymentIntent } = await import("@/lib/stripe");
    await expect(
      createPaymentIntent({
        amount: 49,
        bookingId: "book_guard_2",
        customerEmail: "x@y.co",
        description: "test",
      }),
    ).rejects.toThrow(/unconfigured in production/i);
  });

  it("ALLOW_STUB_STRIPE=1 opts out of the guard in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_STUB_STRIPE", "1");
    const { createPaymentIntent } = await import("@/lib/stripe");
    const r = await createPaymentIntent({
      amount: 49,
      bookingId: "book_guard_3",
      customerEmail: "x@y.co",
      description: "test",
    });
    expect(r.id).toBe("pi_stub_book_guard_3");
  });

  it("applies the same guard to createBondHold", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_STUB_STRIPE", "");
    const { createBondHold } = await import("@/lib/stripe");
    await expect(
      createBondHold({
        amount: 200,
        bookingId: "book_guard_4",
        customerEmail: "x@y.co",
        description: "test",
      }),
    ).rejects.toThrow(/unconfigured in production/i);
  });
});
