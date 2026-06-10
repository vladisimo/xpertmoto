import { beforeEach, describe, expect, it, vi } from "vitest";
import { refundCharge } from "../../../src/lib/stripe";

// These tests exercise the UNCONFIGURED path — a developer's local .env with
// a real STRIPE_SECRET_KEY must not turn them into live network calls.
beforeEach(() => {
  vi.stubEnv("STRIPE_SECRET_KEY", "");
});

/**
 * Phase C — refundCharge stub-mode behaviour. The real Stripe client is
 * never loaded in dev/test (no STRIPE_SECRET_KEY), so refundCharge must
 * still return a deterministic "success" so callers' post-refund logic
 * (Payment row → SUCCEEDED) is exercised end-to-end.
 */

describe("refundCharge (stub mode)", () => {
  it("returns a stub refund id when called with a stub PaymentIntent", async () => {
    const res = await refundCharge({
      paymentIntentId: "pi_stub_abc123",
      amountCents: 5000,
    });
    expect(res.id).toMatch(/^re_stub_/);
    expect(res.status).toBe("succeeded");
    expect(res.amountCents).toBe(5000);
  });

  it("returns a stub refund when only a stub charge id is provided", async () => {
    const res = await refundCharge({
      chargeId: "ch_stub_xyz",
      amountCents: 1234,
    });
    expect(res.id).toMatch(/^re_stub_/);
    expect(res.status).toBe("succeeded");
    expect(res.amountCents).toBe(1234);
  });

  it("also falls through to stub when neither pi nor ch look like stubs but no Stripe client is configured", async () => {
    const res = await refundCharge({
      paymentIntentId: "pi_real_abc",
      amountCents: 200,
    });
    // Without a Stripe secret configured, the stub is still the expected
    // return; in production this path is guarded by assertNotStubbedInProduction.
    expect(res.id).toMatch(/^re_stub_/);
    expect(res.amountCents).toBe(200);
  });
});
