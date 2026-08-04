import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * G6 — Stripe Customer + stored payment method service.
 *
 * Asserts:
 *   - ensureStripeCustomer is idempotent: second call returns the cached id
 *     without another Stripe create.
 *   - createSetupIntentForUser creates a SetupIntent for the existing
 *     customer.
 *   - persistDefaultPaymentMethod attaches the PM, marks default, and
 *     caches display fields (brand / last4 / expiry) — never the PAN.
 *   - chargeOffSessionForUser returns null when the user has no PM.
 */

const profileFindUnique = vi.fn();
const profileUpdate = vi.fn().mockResolvedValue({});
const auditCreate = vi.fn().mockResolvedValue({});

const createStripeCustomer = vi.fn();
const createSetupIntent = vi.fn();
const attachDefaultPaymentMethod = vi.fn();
const chargeOffSession = vi.fn();
const retrievePaymentMethod = vi.fn();
const setCustomerDefaultPaymentMethod = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    customerProfile: { findUnique: profileFindUnique, update: profileUpdate },
    auditLog: { create: auditCreate },
  },
}));

const cancelPaymentIntentMock = vi.fn().mockResolvedValue(true);

vi.mock("@/lib/stripe", () => ({
  createStripeCustomer: (...args: unknown[]) => createStripeCustomer(...args),
  createSetupIntent: (...args: unknown[]) => createSetupIntent(...args),
  attachDefaultPaymentMethod: (...args: unknown[]) => attachDefaultPaymentMethod(...args),
  chargeOffSession: (...args: unknown[]) => chargeOffSession(...args),
  retrievePaymentMethod: (...args: unknown[]) => retrievePaymentMethod(...args),
  setCustomerDefaultPaymentMethod: (...args: unknown[]) =>
    setCustomerDefaultPaymentMethod(...args),
  cancelPaymentIntent: (...args: unknown[]) => cancelPaymentIntentMock(...args),
}));

beforeEach(() => {
  profileFindUnique.mockReset();
  profileUpdate.mockClear();
  auditCreate.mockClear();
  createStripeCustomer.mockReset();
  createSetupIntent.mockReset();
  attachDefaultPaymentMethod.mockReset();
  chargeOffSession.mockReset();
  retrievePaymentMethod.mockReset();
  setCustomerDefaultPaymentMethod.mockClear();
});

describe("stripe-customer service", () => {
  it("ensureStripeCustomer returns the cached id without re-creating", async () => {
    profileFindUnique.mockResolvedValue({
      stripeCustomerId: "cus_existing",
      user: { email: "a@b.co", firstName: "A", lastName: "B", phone: null },
    });
    const { ensureStripeCustomer } = await import("@/server/services/stripe-customer");
    const id = await ensureStripeCustomer("user_1");
    expect(id).toBe("cus_existing");
    expect(createStripeCustomer).not.toHaveBeenCalled();
    expect(profileUpdate).not.toHaveBeenCalled();
  });

  it("ensureStripeCustomer creates a Stripe customer on first call", async () => {
    profileFindUnique.mockResolvedValue({
      stripeCustomerId: null,
      user: { email: "new@user.co", firstName: "New", lastName: "User", phone: "+61400000000" },
    });
    createStripeCustomer.mockResolvedValue({ id: "cus_new_1" });
    const { ensureStripeCustomer } = await import("@/server/services/stripe-customer");
    const id = await ensureStripeCustomer("user_2");
    expect(id).toBe("cus_new_1");
    expect(createStripeCustomer).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user_2", email: "new@user.co" }),
    );
    expect(profileUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user_2" },
        data: { stripeCustomerId: "cus_new_1" },
      }),
    );
    expect(auditCreate).toHaveBeenCalled();
  });

  it("createSetupIntentForUser issues a SetupIntent against the customer id", async () => {
    profileFindUnique.mockResolvedValue({
      stripeCustomerId: "cus_si_1",
      user: { email: "si@user.co", firstName: "S", lastName: "I", phone: null },
    });
    createSetupIntent.mockResolvedValue({
      id: "seti_1",
      clientSecret: "cs_seti_1",
    });
    const { createSetupIntentForUser } = await import("@/server/services/stripe-customer");
    const r = await createSetupIntentForUser("user_3");
    expect(r).toEqual({ setupIntentId: "seti_1", clientSecret: "cs_seti_1" });
    expect(createSetupIntent).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: "cus_si_1", usage: "off_session" }),
    );
  });

  it("persistDefaultPaymentMethod caches brand/last4/expiry, never PAN", async () => {
    profileFindUnique.mockResolvedValue({
      stripeCustomerId: "cus_pm_1",
      user: { email: "pm@user.co", firstName: "P", lastName: "M", phone: null },
    });
    attachDefaultPaymentMethod.mockResolvedValue({
      id: "pm_abc",
      brand: "visa",
      last4: "4242",
      expMonth: 12,
      expYear: 2030,
    });
    const { persistDefaultPaymentMethod } = await import("@/server/services/stripe-customer");
    await persistDefaultPaymentMethod("user_4", "pm_abc");
    expect(profileUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user_4" },
        data: expect.objectContaining({
          defaultStripePaymentMethodId: "pm_abc",
          stripePaymentMethodBrand: "visa",
          stripePaymentMethodLast4: "4242",
          stripePaymentMethodExpMonth: 12,
          stripePaymentMethodExpYear: 2030,
        }),
      }),
    );
    // Critical — never write a PAN-like field
    const payloads = profileUpdate.mock.calls.map((c) => JSON.stringify(c));
    for (const payload of payloads) {
      expect(payload).not.toMatch(/4242424242424242/); // full PAN test
    }
  });

  it("chargeOffSessionForUser returns null when no stored PM", async () => {
    profileFindUnique.mockResolvedValue({
      stripeCustomerId: "cus_no_pm",
      defaultStripePaymentMethodId: null,
    });
    const { chargeOffSessionForUser } = await import("@/server/services/stripe-customer");
    const r = await chargeOffSessionForUser({
      userId: "user_5",
      amount: 49,
      description: "test",
      idempotencyKey: "idem_1",
    });
    expect(r).toBeNull();
    expect(chargeOffSession).not.toHaveBeenCalled();
  });

  describe("persistDefaultPaymentMethodFromIntent (keystone)", () => {
    it("persists the deposit PI's card as default when none is set — WITHOUT re-attaching", async () => {
      profileFindUnique.mockResolvedValue({
        stripeCustomerId: "cus_1",
        defaultStripePaymentMethodId: null,
      });
      retrievePaymentMethod.mockResolvedValue({
        id: "pm_1",
        brand: "visa",
        last4: "4242",
        expMonth: 12,
        expYear: 2030,
      });
      const { persistDefaultPaymentMethodFromIntent } = await import(
        "@/server/services/stripe-customer"
      );
      const res = await persistDefaultPaymentMethodFromIntent("user_1", "pm_1");
      expect(res.persisted).toBe(true);
      // setup_future_usage already attached the PM — attach again would error.
      expect(attachDefaultPaymentMethod).not.toHaveBeenCalled();
      expect(setCustomerDefaultPaymentMethod).toHaveBeenCalledWith({
        customerId: "cus_1",
        paymentMethodId: "pm_1",
      });
      expect(profileUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            defaultStripePaymentMethodId: "pm_1",
            stripePaymentMethodBrand: "visa",
            stripePaymentMethodLast4: "4242",
          }),
        }),
      );
    });

    it("no-ops when the profile already has a default PM (customer's choice wins)", async () => {
      profileFindUnique.mockResolvedValue({
        stripeCustomerId: "cus_1",
        defaultStripePaymentMethodId: "pm_existing",
      });
      const { persistDefaultPaymentMethodFromIntent } = await import(
        "@/server/services/stripe-customer"
      );
      const res = await persistDefaultPaymentMethodFromIntent("user_1", "pm_new");
      expect(res.persisted).toBe(false);
      expect(setCustomerDefaultPaymentMethod).not.toHaveBeenCalled();
      expect(profileUpdate).not.toHaveBeenCalled();
    });

    it("no-ops for stub-mode customers", async () => {
      profileFindUnique.mockResolvedValue({
        stripeCustomerId: "cus_stub_user_1",
        defaultStripePaymentMethodId: null,
      });
      const { persistDefaultPaymentMethodFromIntent } = await import(
        "@/server/services/stripe-customer"
      );
      const res = await persistDefaultPaymentMethodFromIntent("user_1", "pm_1");
      expect(res.persisted).toBe(false);
      expect(setCustomerDefaultPaymentMethod).not.toHaveBeenCalled();
    });
  });

  describe("reactivateFailedChargesForUser (re-attempt on new card)", () => {
    function makeDb(rows: Array<{ id: string; status: string; stripePaymentIntentId: string | null }>) {
      const paymentUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
      const db = {
        payment: {
          findMany: vi.fn().mockResolvedValue(rows),
          updateMany: paymentUpdateMany,
        },
        auditLog: { create: auditCreate },
      };
      return { db: db as never, paymentUpdateMany };
    }

    it("flips FAILED balance-affecting rows back to PENDING with the PI pointer cleared", async () => {
      const { db, paymentUpdateMany } = makeDb([
        { id: "pay_1", status: "FAILED", stripePaymentIntentId: "pi_dead" },
      ]);
      const { reactivateFailedChargesForUser } = await import(
        "@/server/services/stripe-customer"
      );
      const res = await reactivateFailedChargesForUser("user_1", { prisma: db });
      expect(res.reactivated).toBe(1);
      expect(paymentUpdateMany).toHaveBeenCalledWith({
        where: { id: "pay_1", status: "FAILED" },
        data: { status: "PENDING", stripePaymentIntentId: null },
      });
    });

    it("cancels a stale requires_action PI before re-arming the row", async () => {
      const { db, paymentUpdateMany } = makeDb([
        { id: "pay_2", status: "PENDING", stripePaymentIntentId: "pi_stuck_3ds" },
      ]);
      const { reactivateFailedChargesForUser } = await import(
        "@/server/services/stripe-customer"
      );
      const res = await reactivateFailedChargesForUser("user_1", { prisma: db });
      expect(res.reactivated).toBe(1);
      // A stale portal tab must never be able to confirm the old PI after
      // the new attempt fires — cancel precedes the re-arm.
      expect(cancelPaymentIntentMock).toHaveBeenCalledWith("pi_stuck_3ds");
      expect(paymentUpdateMany).toHaveBeenCalledWith({
        where: { id: "pay_2", status: "PENDING" },
        data: { status: "PENDING", stripePaymentIntentId: null },
      });
    });

    it("no-ops cleanly when nothing is stuck", async () => {
      const { db, paymentUpdateMany } = makeDb([]);
      const { reactivateFailedChargesForUser } = await import(
        "@/server/services/stripe-customer"
      );
      const res = await reactivateFailedChargesForUser("user_1", { prisma: db });
      expect(res.reactivated).toBe(0);
      expect(paymentUpdateMany).not.toHaveBeenCalled();
    });
  });
});
