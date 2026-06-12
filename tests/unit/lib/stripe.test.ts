import { createRequire } from "node:module";

import { describe, it, expect, vi, afterEach } from "vitest";

import {
  capturePaymentIntent,
  createBondHold,
  createPaymentIntent,
  retrievePaymentIntent,
} from "@/lib/stripe";

const getSecret = vi.fn();
vi.mock("@/lib/integration-config", () => ({
  getSecret: (...a: unknown[]) => getSecret(...a),
}));

/**
 * Stub-mode contract for the bond-hold capture primitives. With no Stripe
 * account configured (or a stub PI id), these must return a success-shaped
 * result WITHOUT throwing — mirroring `cancelPaymentIntent` — so local dev and
 * unit tests work, while production failures are caught by
 * `assertNotStubbedInProduction` (exercised in the integration suite).
 */
describe("capturePaymentIntent (stub-safe)", () => {
  it("no-ops on a stub bond PI id and echoes the requested amount", async () => {
    const res = await capturePaymentIntent("pi_bond_stub_b1", {
      amountToCaptureCents: 5000,
      idempotencyKey: "bond-capture-x",
    });
    expect(res.captured).toBe(false);
    expect(res.amountReceivedCents).toBe(5000);
    expect(res.latestChargeId).toBeNull();
  });

  it("no-ops on a null PI id (nothing to capture)", async () => {
    const res = await capturePaymentIntent(null, { amountToCaptureCents: 1234 });
    expect(res.captured).toBe(false);
    expect(res.amountReceivedCents).toBe(1234);
  });
});

describe("retrievePaymentIntent (stub-safe)", () => {
  it("returns null for a stub bond PI id", async () => {
    expect(await retrievePaymentIntent("pi_bond_stub_b1")).toBeNull();
    expect(await retrievePaymentIntent(null)).toBeNull();
  });
});

/**
 * Idempotency contract for the two PaymentIntent creators. A network
 * timeout + retry must reuse the same Stripe idempotency key so the retry
 * returns the original PI instead of charging twice. The key embeds the
 * amount in cents so a re-priced retry gets a fresh key rather than a
 * parameter-mismatch rejection.
 *
 * The SDK is loaded via `eval("require")` (see getStripeClient), which
 * vi.mock cannot intercept — but that require shares Node's CJS module
 * cache, so the fake SDK is injected via require.cache instead.
 */
describe("createPaymentIntent / createBondHold idempotency keys", () => {
  const nodeRequire = createRequire(import.meta.url);
  const stripeModuleId = nodeRequire.resolve("stripe");
  const create = vi.fn();
  const ctor = vi.fn(function () {
    return { paymentIntents: { create } };
  });

  function armLiveStripe() {
    getSecret.mockResolvedValue("sk_test_unit");
    create.mockResolvedValue({ id: "pi_live_1", client_secret: "cs_live_1", status: "requires_confirmation" });
    nodeRequire.cache[stripeModuleId] = { exports: ctor } as never;
  }

  afterEach(() => {
    delete nodeRequire.cache[stripeModuleId];
    getSecret.mockReset();
    create.mockReset();
    ctor.mockClear();
  });

  it("createPaymentIntent passes a stable bookingId+amount idempotency key", async () => {
    armLiveStripe();
    const res = await createPaymentIntent({
      amount: 123.45,
      bookingId: "bk_1",
      customerEmail: "c@example.com",
      description: "test booking",
    });
    expect(res.id).toBe("pi_live_1");
    const [params, opts] = create.mock.calls[0]!;
    expect(params.amount).toBe(12345);
    expect(opts).toEqual({ idempotencyKey: "pi-bk_1-12345" });
  });

  it("createBondHold passes a distinct bond idempotency key", async () => {
    armLiveStripe();
    await createBondHold({
      amount: 500,
      bookingId: "bk_1",
      customerEmail: "c@example.com",
      description: "REF-1",
    });
    const [params, opts] = create.mock.calls[0]!;
    expect(params.capture_method).toBe("manual");
    expect(opts).toEqual({ idempotencyKey: "bond-bk_1-50000" });
  });

  it("configures the client with a bounded timeout and one retry", async () => {
    armLiveStripe();
    await createPaymentIntent({
      amount: 10,
      bookingId: "bk_2",
      customerEmail: "c@example.com",
      description: "timeout config probe",
    });
    expect(ctor).toHaveBeenCalledWith(
      "sk_test_unit",
      expect.objectContaining({ timeout: 15_000, maxNetworkRetries: 1 }),
    );
  });

  it("falls back to deterministic stubs when Stripe is unconfigured", async () => {
    getSecret.mockResolvedValue(null);
    const pi = await createPaymentIntent({
      amount: 10,
      bookingId: "bk_3",
      customerEmail: "c@example.com",
      description: "stub",
    });
    const bond = await createBondHold({
      amount: 10,
      bookingId: "bk_3",
      customerEmail: "c@example.com",
      description: "stub",
    });
    expect(pi.id).toBe("pi_stub_bk_3");
    expect(bond.id).toBe("pi_bond_stub_bk_3");
  });
});
