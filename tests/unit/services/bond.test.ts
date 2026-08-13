import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Stripe + audit mocks ───────────────────────────────────────────────────
const retrievePaymentIntentMock = vi.fn();
const createBondHoldOffSessionMock = vi.fn();
const cancelPaymentIntentMock = vi.fn();
vi.mock("@/lib/stripe", () => ({
  retrievePaymentIntent: (...a: unknown[]) => retrievePaymentIntentMock(...a),
  createBondHoldOffSession: (...a: unknown[]) => createBondHoldOffSessionMock(...a),
  cancelPaymentIntent: (...a: unknown[]) => cancelPaymentIntentMock(...a),
}));
vi.mock("@/server/services/audit-payment", () => ({
  writePaymentAudit: vi.fn().mockResolvedValue(undefined),
}));

import { ensureFreshBondHold } from "@/server/services/bond";

// ── Fixture ────────────────────────────────────────────────────────────────
// Focus: the freshness predicate. A live, young hold is "fresh" ONLY while
// its amount still matches booking.bondAmount — a pre-pickup category
// amendment that changes bondAmount must force a re-auth at the new amount
// (Area 4), instead of an undersized hold silently surviving to check-out.

type Row = Record<string, unknown>;

function makeLedger(over: Row = {}) {
  return {
    id: "bond1",
    status: "HELD",
    heldAmount: 300,
    capturedAmount: 0,
    releasedAmount: 0,
    stripePaymentIntentId: "pi_old",
    authorizedAt: new Date(), // freshly authorised — age ≈ 0 days
    reauthCount: 0,
    authHistory: [],
    createdAt: new Date(),
    ...over,
  };
}

function makeBooking(over: Row = {}, ledger: Row | null = makeLedger()) {
  return {
    id: "b1",
    bookingReference: "XPM-BOND-0001",
    customerId: "cust1",
    bondAmount: 300,
    bondLedger: ledger,
    customer: {
      customerProfile: {
        stripeCustomerId: "cus_real_1",
        defaultStripePaymentMethodId: "pm_1",
        stripePaymentMethodBrand: "mastercard", // 30-day horizon — age never stale here
      },
    },
    ...over,
  };
}

function makePrisma(booking: Row) {
  return {
    booking: { findUniqueOrThrow: vi.fn(async () => booking) },
    bondLedger: {
      update: vi.fn(async () => ({})),
      create: vi.fn(async () => ({})),
    },
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  retrievePaymentIntentMock.mockResolvedValue({ status: "requires_capture" });
  createBondHoldOffSessionMock.mockResolvedValue({
    id: "pi_new",
    status: "requires_capture",
  });
  cancelPaymentIntentMock.mockResolvedValue(true);
});

describe("ensureFreshBondHold — amount-aware freshness (Area 4)", () => {
  it("a live young hold at the CURRENT bondAmount stays fresh (no Stripe re-auth)", async () => {
    const prisma = makePrisma(makeBooking());
    const res = await ensureFreshBondHold(prisma, { bookingId: "b1", reason: "check-out" });
    expect(res).toEqual({ ok: true, action: "fresh" });
    expect(createBondHoldOffSessionMock).not.toHaveBeenCalled();
  });

  it("re-auths at the NEW bondAmount when a category amendment raised it", async () => {
    // Amendment moved the booking to a 500-bond category; the 300 hold is stale.
    const prisma = makePrisma(makeBooking({ bondAmount: 500 }));
    const res = await ensureFreshBondHold(prisma, { bookingId: "b1", reason: "check-out" });
    expect(res).toEqual({ ok: true, action: "reauthorized" });
    expect(createBondHoldOffSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 500, bookingId: "b1" }),
    );
    // Old PI retired AFTER the new hold is live; ledger follows the new amount.
    expect(cancelPaymentIntentMock).toHaveBeenCalledWith("pi_old");
    const update = (
      (prisma as { bondLedger: { update: ReturnType<typeof vi.fn> } }).bondLedger.update.mock
        .calls[0]![0] as { data: Row }
    ).data;
    expect(update).toMatchObject({ stripePaymentIntentId: "pi_new", heldAmount: 500 });
  });

  it("re-auths DOWN when the amendment lowered the bond", async () => {
    const prisma = makePrisma(makeBooking({ bondAmount: 150 }));
    const res = await ensureFreshBondHold(prisma, { bookingId: "b1", reason: "check-out" });
    expect(res).toEqual({ ok: true, action: "reauthorized" });
    expect(createBondHoldOffSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 150 }),
    );
  });

  it("never resizes once part of the hold has been captured", async () => {
    // Post-capture arithmetic must stay heldAmount-based: remaining 200, not 500.
    const prisma = makePrisma(
      makeBooking({ bondAmount: 500 }, makeLedger({ heldAmount: 300, capturedAmount: 100 })),
    );
    const res = await ensureFreshBondHold(prisma, { bookingId: "b1", reason: "check-out" });
    // Amounts differ but the ledger is no longer untouched → normal freshness
    // rules apply, and this hold is live + young → fresh.
    expect(res).toEqual({ ok: true, action: "fresh" });
    expect(createBondHoldOffSessionMock).not.toHaveBeenCalled();
  });

  it("stub mode (no real PI) still short-circuits fresh even when amounts differ", async () => {
    retrievePaymentIntentMock.mockResolvedValue(null);
    const prisma = makePrisma(makeBooking({ bondAmount: 500 }));
    const res = await ensureFreshBondHold(prisma, { bookingId: "b1", reason: "check-out" });
    expect(res).toEqual({ ok: true, action: "fresh" });
    expect(createBondHoldOffSessionMock).not.toHaveBeenCalled();
  });

  it("still re-auths an expired hold at the unchanged amount (existing behaviour)", async () => {
    retrievePaymentIntentMock.mockResolvedValue({ status: "canceled" });
    const prisma = makePrisma(makeBooking());
    const res = await ensureFreshBondHold(prisma, { bookingId: "b1", reason: "rolling-reauth" });
    expect(res).toEqual({ ok: true, action: "reauthorized" });
    expect(createBondHoldOffSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 300 }),
    );
    // No resize — heldAmount untouched in the ledger update.
    const update = (
      (prisma as { bondLedger: { update: ReturnType<typeof vi.fn> } }).bondLedger.update.mock
        .calls[0]![0] as { data: Row }
    ).data;
    expect(update).not.toHaveProperty("heldAmount");
  });
});
