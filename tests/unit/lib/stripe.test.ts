import { describe, it, expect } from "vitest";

import { capturePaymentIntent, retrievePaymentIntent } from "@/lib/stripe";

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
