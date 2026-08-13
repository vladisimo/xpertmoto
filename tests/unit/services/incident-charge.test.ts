import { beforeEach, describe, expect, it, vi } from "vitest";

// Mirror test for the extracted incident-charge service (Area 3). The money
// specs moved here from fleet.test.ts when `fleet.chargeCustomerForIncident`
// became a thin wrapper; the router file keeps the auth/delegation specs.

const capturePaymentIntentMock = vi.fn();
vi.mock("@/lib/stripe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/lib/stripe")>();
  return {
    ...actual,
    capturePaymentIntent: (...args: unknown[]) => capturePaymentIntentMock(...args),
  };
});
const tryIssueAdjustmentForBookingMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/server/services/invoice-lifecycle", () => ({
  tryIssueAdjustmentForBooking: (...args: unknown[]) =>
    tryIssueAdjustmentForBookingMock(...args),
}));
vi.mock("@/lib/analytics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/lib/analytics")>();
  return { ...actual, trackServer: vi.fn(async () => undefined) };
});
const getBookingExcessMock = vi.fn();
const getDamageLiabilityUsedMock = vi.fn();
vi.mock("@/server/services/excess", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/server/services/excess")>();
  return {
    ...actual,
    getBookingExcess: (...a: unknown[]) => getBookingExcessMock(...a),
    getDamageLiabilityUsed: (...a: unknown[]) => getDamageLiabilityUsedMock(...a),
  };
});
const writeAuditAsyncMock = vi.fn();
vi.mock("@/server/services/audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/server/services/audit")>();
  return {
    ...actual,
    writeAuditAsync: (...a: unknown[]) => writeAuditAsyncMock(...a),
  };
});

import { chargeCustomerForIncident } from "../../../src/server/services/incident-charge";

function makeFixture(over: {
  booking?: Record<string, unknown> | null;
  customerLiable?: boolean;
  bondLedger?: Record<string, unknown> | null;
  existingPayment?: { id: string } | null;
  excessVoided?: boolean;
  incidentStatus?: string;
} = {}) {
  const bondLedger =
    over.bondLedger === undefined
      ? {
          heldAmount: 500,
          capturedAmount: 0,
          status: "HELD",
          stripePaymentIntentId: "pi_bond_1",
          deductions: [],
        }
      : over.bondLedger;
  const booking =
    over.booking === undefined
      ? { id: "bk1", customerId: "cust1", bondLedger, pickupDepot: { slug: "brisbane" } }
      : over.booking;
  const incident = {
    id: "incident1",
    incidentNumber: "2026-0042",
    status: over.incidentStatus ?? "REPORTED",
    customerLiable: over.customerLiable ?? true,
    customerChargeAmount: null,
    actualDamageCost: null,
    resolvedAt: null,
    excessVoided: over.excessVoided ?? false,
    booking,
  };
  // Generous default headroom so the pre-Area-1 specs behave unchanged;
  // cap-specific specs override these per test.
  getBookingExcessMock.mockResolvedValue({ excess: 100000, source: "SETTING", tierName: null });
  getDamageLiabilityUsedMock.mockResolvedValue(0);
  const paymentCreate = vi
    .fn()
    .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: `pay-${data.reference}`, ...data }),
    );
  const incidentUpdate = vi
    .fn()
    .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: "incident1", ...data }),
    );
  const bookingUpdate = vi.fn().mockResolvedValue({});
  const prisma = {
    incident: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(incident),
      update: incidentUpdate,
    },
    payment: {
      findFirst: vi.fn().mockResolvedValue(over.existingPayment ?? null),
      create: paymentCreate,
    },
    bondLedger: { update: vi.fn().mockResolvedValue({}) },
    booking: { update: bookingUpdate },
    $transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma)),
  };
  capturePaymentIntentMock.mockResolvedValue({
    id: "pi_bond_1",
    status: "succeeded",
    amountReceivedCents: 50000,
    latestChargeId: "ch_bond_1",
    captured: true,
  });
  return { prisma: prisma as never, paymentCreate, bookingUpdate, incidentUpdate };
}

beforeEach(() => vi.clearAllMocks());

describe("chargeCustomerForIncident (service)", () => {
  it("splits a bond+card charge and raises balanceDue by exactly the card share, GST on both rows", async () => {
    const { prisma, paymentCreate, bookingUpdate } = makeFixture();

    const res = await chargeCustomerForIncident(prisma, {
      incidentId: "incident1",
      amount: 800,
      actorId: "mgr1",
    });

    expect(res.fromBond).toBe(500);
    expect(res.fromCard).toBe(300);

    const created = paymentCreate.mock.calls.map(
      (c) => (c[0] as { data: Record<string, unknown> }).data,
    );
    const bondRow = created.find((d) => d.reference === "INC-2026-0042");
    const cardRow = created.find((d) => d.reference === "INC-2026-0042-CARD");
    expect(bondRow).toMatchObject({
      type: "DAMAGE_CHARGE",
      status: "SUCCEEDED",
      amount: 500,
      processedById: "mgr1",
    });
    expect(cardRow).toMatchObject({ type: "DAMAGE_CHARGE", status: "PENDING", amount: 300 });
    // GST-inclusive taxable supply: both rows carry gstAmount = amount / 11
    // (BAS export reads Payment.gstAmount).
    expect(Number(bondRow?.gstAmount)).toBeCloseTo(45.45, 2);
    expect(Number(cardRow?.gstAmount)).toBeCloseTo(27.27, 2);

    // Raise half of the balance-due contract: only the PENDING card overflow
    // enters balanceDue — the bond capture is settled money, never dunned.
    expect(bookingUpdate).toHaveBeenCalledTimes(1);
    expect(bookingUpdate).toHaveBeenCalledWith({
      where: { id: "bk1" },
      data: { balanceDue: { increment: 300 } },
    });

    // The adjustment-note line items carry explicit GST too.
    expect(tryIssueAdjustmentForBookingMock).toHaveBeenCalledTimes(2);
    const noteGsts = tryIssueAdjustmentForBookingMock.mock.calls.map(
      (c) =>
        (c[0] as { lineItems: Array<{ gstAmount?: number }> }).lineItems[0]?.gstAmount,
    );
    expect(noteGsts).toEqual(expect.arrayContaining([45.45, 27.27]));
  });

  it("does not touch balanceDue when the bond covers the whole charge", async () => {
    const { prisma, bookingUpdate } = makeFixture();

    const res = await chargeCustomerForIncident(prisma, {
      incidentId: "incident1",
      amount: 400,
      actorId: "mgr1",
    });

    expect(res.fromBond).toBe(400);
    expect(res.fromCard).toBe(0);
    expect(bookingUpdate).not.toHaveBeenCalled();
  });

  it("resolves the incident by default but keeps the caller's status when keepStatus is set (theft flow)", async () => {
    const first = makeFixture();
    await chargeCustomerForIncident(first.prisma, {
      incidentId: "incident1",
      amount: 100,
      actorId: "mgr1",
    });
    const resolvedData = (
      first.incidentUpdate.mock.calls[0]?.[0] as { data: Record<string, unknown> }
    ).data;
    expect(resolvedData.status).toBe("RESOLVED");
    expect(resolvedData.resolvedAt).toBeInstanceOf(Date);

    const second = makeFixture();
    await chargeCustomerForIncident(second.prisma, {
      incidentId: "incident1",
      amount: 100,
      actorId: "mgr1",
      keepStatus: true,
    });
    const keptData = (
      second.incidentUpdate.mock.calls[0]?.[0] as { data: Record<string, unknown> }
    ).data;
    expect(keptData.status).toBeUndefined();
    expect(keptData.resolvedAt).toBeUndefined();
    // Charge amounts are still recorded on the incident.
    expect(keptData.customerChargeAmount).toBe(100);
  });

  it("rejects an incident with no linked booking", async () => {
    const { prisma } = makeFixture({ booking: null });

    await expect(
      chargeCustomerForIncident(prisma, { incidentId: "incident1", amount: 100, actorId: "mgr1" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(capturePaymentIntentMock).not.toHaveBeenCalled();
  });

  it("rejects an incident not marked customerLiable", async () => {
    const { prisma } = makeFixture({ customerLiable: false });

    await expect(
      chargeCustomerForIncident(prisma, { incidentId: "incident1", amount: 100, actorId: "mgr1" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("CONFLICTs on a second call once the charge reference exists (idempotency)", async () => {
    const { prisma, paymentCreate } = makeFixture({ existingPayment: { id: "pay-prior" } });

    await expect(
      chargeCustomerForIncident(prisma, { incidentId: "incident1", amount: 800, actorId: "mgr1" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(capturePaymentIntentMock).not.toHaveBeenCalled();
    expect(paymentCreate).not.toHaveBeenCalled();
  });

  // ---- Area 1: per-hire excess cap ----

  it("clamps the charge to the remaining excess headroom and audits EXCESS_CAP_APPLIED", async () => {
    const { prisma, paymentCreate } = makeFixture();
    getBookingExcessMock.mockResolvedValue({ excess: 1000, source: "BOOKING_INSURANCE", tierName: "Basic" });
    getDamageLiabilityUsedMock.mockResolvedValue(800);

    const res = await chargeCustomerForIncident(prisma, {
      incidentId: "incident1",
      amount: 800,
      actorId: "mgr1",
    });

    // Only A$200 of headroom remains — the bond (A$500 held) covers all of it.
    expect(res.fromBond).toBe(200);
    expect(res.fromCard).toBe(0);
    const created = paymentCreate.mock.calls.map(
      (c) => (c[0] as { data: Record<string, unknown> }).data,
    );
    expect(created.find((d) => d.reference === "INC-2026-0042")).toMatchObject({ amount: 200 });
    expect(writeAuditAsyncMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "EXCESS_CAP_APPLIED",
        newData: expect.objectContaining({ preCapAmount: 800, charged: 200, cappedBy: 600 }),
      }),
    );
  });

  it("BAD_REQUESTs a cap-exhausted charge with no void/override — nothing hits Stripe", async () => {
    const { prisma, paymentCreate } = makeFixture();
    getBookingExcessMock.mockResolvedValue({ excess: 1000, source: "BOOKING_INSURANCE", tierName: "Basic" });
    getDamageLiabilityUsedMock.mockResolvedValue(1000);

    await expect(
      chargeCustomerForIncident(prisma, { incidentId: "incident1", amount: 300, actorId: "mgr1" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(capturePaymentIntentMock).not.toHaveBeenCalled();
    expect(paymentCreate).not.toHaveBeenCalled();
  });

  it("manager override charges past the cap and audits EXCESS_CAP_OVERRIDDEN with the reason", async () => {
    const { prisma } = makeFixture();
    getBookingExcessMock.mockResolvedValue({ excess: 1000, source: "BOOKING_INSURANCE", tierName: "Basic" });
    getDamageLiabilityUsedMock.mockResolvedValue(1000);

    const res = await chargeCustomerForIncident(prisma, {
      incidentId: "incident1",
      amount: 300,
      overrideExcessCap: { reason: "Negligence — riding two-up against agreement" },
      actorId: "mgr1",
    });

    expect(res.fromBond).toBe(300);
    expect(writeAuditAsyncMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "EXCESS_CAP_OVERRIDDEN",
        newData: expect.objectContaining({
          reason: "Negligence — riding two-up against agreement",
          uncappedAmount: 300,
          charged: 300,
        }),
      }),
    );
  });

  it("skips the cap entirely when the incident's excess was voided", async () => {
    const { prisma } = makeFixture({ excessVoided: true });
    getBookingExcessMock.mockResolvedValue({ excess: 1000, source: "BOOKING_INSURANCE", tierName: "Basic" });
    getDamageLiabilityUsedMock.mockResolvedValue(1000);

    const res = await chargeCustomerForIncident(prisma, {
      incidentId: "incident1",
      amount: 300,
      actorId: "mgr1",
    });

    expect(res.fromBond).toBe(300);
    expect(writeAuditAsyncMock).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "EXCESS_CAP_APPLIED" }),
    );
  });
});
