import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * ensureFreshBondHold — the single bond (re-)authorisation entry point.
 *
 *   - fresh hold (live PI, plenty of horizon left) → no-op
 *   - stale/expiring hold → new off-session manual-capture PI, OLD PI
 *     cancelled AFTER the new one exists, ledger chain updated
 *   - dead PI (canceled at Stripe) → re-created the same way
 *   - decline → { ok: false, action: "failed" } and ledger untouched
 *   - no saved card → { ok: false, action: "no_pm" }
 *   - no ledger + bondAmount > 0 → creates hold + ledger (walk-in path)
 */

const bookingFindUniqueOrThrow = vi.fn();
const ledgerUpdate = vi.fn().mockResolvedValue({});
const ledgerCreate = vi.fn().mockResolvedValue({});
const auditCreate = vi.fn().mockResolvedValue({});

const retrievePaymentIntent = vi.fn();
const createBondHoldOffSession = vi.fn();
const cancelPaymentIntent = vi.fn().mockResolvedValue(true);

vi.mock("@/lib/prisma", () => ({
  prisma: {},
}));
vi.mock("@/lib/stripe", () => ({
  retrievePaymentIntent: (...a: unknown[]) => retrievePaymentIntent(...a),
  createBondHoldOffSession: (...a: unknown[]) => createBondHoldOffSession(...a),
  cancelPaymentIntent: (...a: unknown[]) => cancelPaymentIntent(...a),
}));

const prisma = {
  booking: { findUniqueOrThrow: bookingFindUniqueOrThrow },
  bondLedger: { update: ledgerUpdate, create: ledgerCreate },
  auditLog: { create: auditCreate },
} as never;

const DAY = 86_400_000;

function makeBooking(over: Record<string, unknown> = {}, ledgerOver: Record<string, unknown> | null = {}) {
  return {
    id: "b1",
    bookingReference: "SCT-0001",
    customerId: "cust_1",
    bondAmount: "200.00",
    bondLedger:
      ledgerOver === null
        ? null
        : {
            id: "bond_1",
            status: "HELD",
            heldAmount: "200.00",
            capturedAmount: "0",
            releasedAmount: "0",
            stripePaymentIntentId: "pi_old",
            authorizedAt: new Date(Date.now() - 1 * DAY),
            reauthCount: 0,
            authHistory: [],
            createdAt: new Date(Date.now() - 1 * DAY),
            ...ledgerOver,
          },
    customer: {
      customerProfile: {
        stripeCustomerId: "cus_1",
        defaultStripePaymentMethodId: "pm_1",
        stripePaymentMethodBrand: "visa",
      },
    },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  cancelPaymentIntent.mockResolvedValue(true);
});

describe("ensureFreshBondHold", () => {
  it("no-ops when the hold is live with horizon to spare", async () => {
    bookingFindUniqueOrThrow.mockResolvedValue(makeBooking());
    retrievePaymentIntent.mockResolvedValue({ status: "requires_capture" });
    const { ensureFreshBondHold } = await import("@/server/services/bond");
    const r = await ensureFreshBondHold(prisma, { bookingId: "b1", reason: "check-out" });
    expect(r).toEqual({ ok: true, action: "fresh" });
    expect(createBondHoldOffSession).not.toHaveBeenCalled();
    expect(ledgerUpdate).not.toHaveBeenCalled();
  });

  it("re-authorises an expiring Visa hold: new PI first, old cancelled after, chain recorded", async () => {
    // Authorised 6 days ago on a 7-day Visa horizon with 2-day lead → stale.
    bookingFindUniqueOrThrow.mockResolvedValue(
      makeBooking({}, { authorizedAt: new Date(Date.now() - 6 * DAY) }),
    );
    retrievePaymentIntent.mockResolvedValue({ status: "requires_capture" });
    createBondHoldOffSession.mockResolvedValue({
      id: "pi_new",
      status: "requires_capture",
      clientSecret: null,
    });
    const { ensureFreshBondHold } = await import("@/server/services/bond");
    const r = await ensureFreshBondHold(prisma, { bookingId: "b1", reason: "rolling-reauth" });
    expect(r).toEqual({ ok: true, action: "reauthorized" });
    expect(createBondHoldOffSession).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: "cus_1",
        paymentMethodId: "pm_1",
        amount: 200,
        idempotencyKey: "bond-reauth-bond_1-1",
      }),
    );
    // Coverage-gap ordering: new hold exists before the old one is retired.
    expect(createBondHoldOffSession.mock.invocationCallOrder[0]!).toBeLessThan(
      cancelPaymentIntent.mock.invocationCallOrder[0]!,
    );
    expect(cancelPaymentIntent).toHaveBeenCalledWith("pi_old");
    expect(ledgerUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          stripePaymentIntentId: "pi_new",
          reauthCount: { increment: 1 },
          authHistory: expect.arrayContaining([
            expect.objectContaining({ paymentIntentId: "pi_old", reason: "rolling-reauth" }),
          ]),
        }),
      }),
    );
  });

  it("re-creates the hold when the current PI is already dead (canceled)", async () => {
    bookingFindUniqueOrThrow.mockResolvedValue(makeBooking());
    retrievePaymentIntent.mockResolvedValue({ status: "canceled" });
    createBondHoldOffSession.mockResolvedValue({
      id: "pi_new",
      status: "requires_capture",
      clientSecret: null,
    });
    const { ensureFreshBondHold } = await import("@/server/services/bond");
    const r = await ensureFreshBondHold(prisma, { bookingId: "b1", reason: "check-out" });
    expect(r).toEqual({ ok: true, action: "reauthorized" });
  });

  it("reports failure (ledger untouched) when the off-session hold declines", async () => {
    bookingFindUniqueOrThrow.mockResolvedValue(makeBooking());
    retrievePaymentIntent.mockResolvedValue({ status: "canceled" });
    createBondHoldOffSession.mockResolvedValue({
      id: "pi_x",
      status: "failed",
      clientSecret: null,
      errorCode: "card_declined",
    });
    const { ensureFreshBondHold } = await import("@/server/services/bond");
    const r = await ensureFreshBondHold(prisma, { bookingId: "b1", reason: "rolling-reauth" });
    expect(r).toMatchObject({ ok: false, action: "failed", errorCode: "card_declined" });
    expect(ledgerUpdate).not.toHaveBeenCalled();
    expect(cancelPaymentIntent).not.toHaveBeenCalled();
  });

  it("surfaces requires_action with the client secret for customer-present 3DS", async () => {
    bookingFindUniqueOrThrow.mockResolvedValue(makeBooking());
    retrievePaymentIntent.mockResolvedValue({ status: "canceled" });
    createBondHoldOffSession.mockResolvedValue({
      id: "pi_3ds",
      status: "requires_action",
      clientSecret: "cs_3ds",
    });
    const { ensureFreshBondHold } = await import("@/server/services/bond");
    const r = await ensureFreshBondHold(prisma, { bookingId: "b1", reason: "check-out" });
    expect(r).toEqual({
      ok: false,
      action: "requires_action",
      clientSecret: "cs_3ds",
      paymentIntentId: "pi_3ds",
    });
  });

  it("returns no_pm when the customer has no saved card", async () => {
    bookingFindUniqueOrThrow.mockResolvedValue(
      makeBooking(
        {
          customer: {
            customerProfile: {
              stripeCustomerId: "cus_1",
              defaultStripePaymentMethodId: null,
              stripePaymentMethodBrand: null,
            },
          },
        },
        { authorizedAt: new Date(Date.now() - 10 * DAY) },
      ),
    );
    retrievePaymentIntent.mockResolvedValue({ status: "canceled" });
    const { ensureFreshBondHold } = await import("@/server/services/bond");
    const r = await ensureFreshBondHold(prisma, { bookingId: "b1", reason: "rolling-reauth" });
    expect(r).toEqual({ ok: false, action: "no_pm" });
  });

  it("creates hold + ledger for a bond-carrying booking with no ledger (walk-in)", async () => {
    bookingFindUniqueOrThrow.mockResolvedValue(makeBooking({}, null));
    createBondHoldOffSession.mockResolvedValue({
      id: "pi_new",
      status: "requires_capture",
      clientSecret: null,
    });
    const { ensureFreshBondHold } = await import("@/server/services/bond");
    const r = await ensureFreshBondHold(prisma, { bookingId: "b1", reason: "walk-in" });
    expect(r).toEqual({ ok: true, action: "created" });
    expect(ledgerCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          bookingId: "b1",
          heldAmount: 200,
          status: "HELD",
          stripePaymentIntentId: "pi_new",
        }),
      }),
    );
  });

  it("no-ops for non-HELD ledgers and zero-bond bookings", async () => {
    bookingFindUniqueOrThrow.mockResolvedValue(makeBooking({}, { status: "RELEASED" }));
    const { ensureFreshBondHold } = await import("@/server/services/bond");
    expect(await ensureFreshBondHold(prisma, { bookingId: "b1", reason: "check-out" })).toEqual({
      ok: true,
      action: "no_bond",
    });

    bookingFindUniqueOrThrow.mockResolvedValue(makeBooking({ bondAmount: "0" }, null));
    expect(await ensureFreshBondHold(prisma, { bookingId: "b1", reason: "check-out" })).toEqual({
      ok: true,
      action: "no_bond",
    });
  });
});
