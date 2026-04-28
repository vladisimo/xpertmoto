import { describe, expect, it, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

// Mock the storage module before importing the router so the customer
// router's `getSignedUrl` dependency doesn't try to reach MinIO.
vi.mock("@/lib/storage", () => ({
  downloadFile: vi.fn(),
  getSignedUrl: vi.fn(),
}));

// Mock stripe-customer so we can drive the Stripe branch deterministically.
vi.mock("@/server/services/stripe-customer", () => ({
  createSetupIntentForUser: vi.fn(),
  persistDefaultPaymentMethod: vi.fn(),
}));

import { customerRouter } from "../../../../src/server/trpc/router/customer";
import { persistDefaultPaymentMethod } from "@/server/services/stripe-customer";
import { StripePaymentMethodError } from "@/lib/stripe";

const persistMock = persistDefaultPaymentMethod as unknown as ReturnType<typeof vi.fn>;

function makeCtx() {
  const prisma = {
    customerProfile: { findUnique: vi.fn(), update: vi.fn() },
    user: { findUnique: vi.fn() },
  };
  return {
    prisma,
    user: { id: "cust_1", role: "CUSTOMER" },
    session: { user: { id: "cust_1", role: "CUSTOMER" } },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    reqId: "r1",
  };
}

describe("customer.savePaymentMethod — Stripe error mapping", () => {
  beforeEach(() => {
    persistMock.mockReset();
  });

  it("returns ok on happy path", async () => {
    persistMock.mockResolvedValueOnce(undefined);
    const ctx = makeCtx();
    const caller = customerRouter.createCaller(ctx as never);
    await expect(caller.savePaymentMethod({ paymentMethodId: "pm_abc" })).resolves.toEqual({
      ok: true,
    });
    expect(persistMock).toHaveBeenCalledWith("cust_1", "pm_abc");
  });

  it("maps a customer-caused Stripe error to BAD_REQUEST with the user message + Stripe code", async () => {
    persistMock.mockRejectedValueOnce(
      new StripePaymentMethodError({
        code: "resource_missing",
        message: "Stripe attach failed: No such payment_method: pm_abc",
        userMessage: "That payment method could not be found — please try adding the card again.",
        stripeType: "invalid_request_error",
        stripeRequestId: "req_xyz",
      }),
    );
    const ctx = makeCtx();
    const caller = customerRouter.createCaller(ctx as never);
    const promise = caller.savePaymentMethod({ paymentMethodId: "pm_abc" });
    await expect(promise).rejects.toBeInstanceOf(TRPCError);
    await expect(promise).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringMatching(/could not be found.*stripe:resource_missing/),
    });
  });

  it("maps payment_method_unexpected_state (PM attached to another customer) to BAD_REQUEST", async () => {
    persistMock.mockRejectedValueOnce(
      new StripePaymentMethodError({
        code: "payment_method_unexpected_state",
        message: "Stripe attach failed",
        userMessage: "This card is already linked to a different account. Remove it from the other account or use a different card.",
      }),
    );
    const ctx = makeCtx();
    const caller = customerRouter.createCaller(ctx as never);
    await expect(
      caller.savePaymentMethod({ paymentMethodId: "pm_abc" }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringMatching(/already linked to a different account/),
    });
  });

  it("maps infrastructure-class Stripe errors (api_key_expired) to INTERNAL_SERVER_ERROR", async () => {
    persistMock.mockRejectedValueOnce(
      new StripePaymentMethodError({
        code: "api_key_expired",
        message: "Stripe attach failed: API key expired",
        userMessage: "We couldn't reach our payment provider. Please try again in a moment.",
      }),
    );
    const ctx = makeCtx();
    const caller = customerRouter.createCaller(ctx as never);
    await expect(
      caller.savePaymentMethod({ paymentMethodId: "pm_abc" }),
    ).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: expect.stringMatching(/stripe:api_key_expired/),
    });
  });

  it("maps unknown Stripe errors (stripe_unknown_error) to INTERNAL_SERVER_ERROR", async () => {
    persistMock.mockRejectedValueOnce(
      new StripePaymentMethodError({
        code: "stripe_unknown_error",
        message: "something exploded",
        userMessage: "We couldn't save your payment method. Please try again or use a different card.",
      }),
    );
    const ctx = makeCtx();
    const caller = customerRouter.createCaller(ctx as never);
    await expect(
      caller.savePaymentMethod({ paymentMethodId: "pm_abc" }),
    ).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
  });

  it("lets non-Stripe errors flow through (tRPC wraps as INTERNAL_SERVER_ERROR, original message preserved)", async () => {
    persistMock.mockRejectedValueOnce(new Error("db outage"));
    const ctx = makeCtx();
    const caller = customerRouter.createCaller(ctx as never);
    await expect(
      caller.savePaymentMethod({ paymentMethodId: "pm_abc" }),
    ).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "db outage",
    });
  });
});
