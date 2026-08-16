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

const sendNotificationMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/server/services/notification-sender", () => ({
  sendNotification: (...a: unknown[]) => sendNotificationMock(...a),
}));

import {
  chargeCustomerForIncident,
  recordWorkOrderCostForIncident,
} from "../../../src/server/services/incident-charge";

function makeFixture(over: {
  booking?: Record<string, unknown> | null;
  customerLiable?: boolean;
  bondLedger?: Record<string, unknown> | null;
  /** Prior Payment rows on the INC-<num>/INC-<num>-CARD references (the new
   *  pre-check reads them via payment.findMany). */
  priorSlices?: Array<Record<string, unknown>>;
  /** DamageCharge rows linked to FAILED prior slices. */
  supersededCharges?: Array<Record<string, unknown>>;
  /** Booking.balanceDue read inside the resurrection delta path. */
  bookingBalanceDue?: number;
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
    severity: "MODERATE",
    description: "Dropped at the lights — left fairing cracked",
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
  const paymentUpdate = vi
    .fn()
    .mockImplementation(({ where, data }: { where: { id: string }; data: Record<string, unknown> }) =>
      Promise.resolve({ id: where.id, ...data }),
    );
  const incidentUpdate = vi
    .fn()
    .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: "incident1", ...data }),
    );
  const bookingUpdate = vi.fn().mockResolvedValue({});
  const bookingFindUnique = vi
    .fn()
    .mockResolvedValue({ balanceDue: over.bookingBalanceDue ?? 0 });
  const damageChargeCreate = vi
    .fn()
    .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: `dc-${data.capturedPaymentId}`, ...data }),
    );
  const damageChargeUpdate = vi.fn().mockResolvedValue({});
  const paymentFindMany = vi.fn().mockResolvedValue(over.priorSlices ?? []);
  const damageChargeFindMany = vi.fn().mockResolvedValue(over.supersededCharges ?? []);
  const prisma = {
    incident: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(incident),
      update: incidentUpdate,
    },
    payment: {
      findMany: paymentFindMany,
      create: paymentCreate,
      update: paymentUpdate,
    },
    bondLedger: { update: vi.fn().mockResolvedValue({}) },
    booking: { update: bookingUpdate, findUnique: bookingFindUnique },
    damageCharge: { create: damageChargeCreate, update: damageChargeUpdate, findMany: damageChargeFindMany },
    $transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma)),
  };
  capturePaymentIntentMock.mockResolvedValue({
    id: "pi_bond_1",
    status: "succeeded",
    amountReceivedCents: 50000,
    latestChargeId: "ch_bond_1",
    captured: true,
  });
  return {
    prisma: prisma as never,
    paymentCreate,
    paymentUpdate,
    paymentFindMany,
    bookingUpdate,
    bookingFindUnique,
    incidentUpdate,
    damageChargeCreate,
    damageChargeUpdate,
    damageChargeFindMany,
  };
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

  it("CONFLICTs on a second call once a live charge reference exists (idempotency)", async () => {
    const { prisma, paymentCreate, paymentFindMany } = makeFixture({
      priorSlices: [
        { id: "pay-prior", reference: "INC-2026-0042", status: "SUCCEEDED", amount: 500, notes: null },
      ],
    });

    await expect(
      chargeCustomerForIncident(prisma, { incidentId: "incident1", amount: 800, actorId: "mgr1" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(capturePaymentIntentMock).not.toHaveBeenCalled();
    expect(paymentCreate).not.toHaveBeenCalled();
    // The pre-check must cover BOTH slice spellings — a card-only run lands
    // only `INC-<num>-CARD`, and missing it would P2002 on the retry.
    expect(paymentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { reference: { in: ["INC-2026-0042", "INC-2026-0042-CARD"] } },
      }),
    );
  });

  it("CONFLICTs cleanly on a retry after a card-only charge (only PENDING INC-<num>-CARD exists) — no P2002", async () => {
    // Bond already consumed → the first run was card-only and created ONLY
    // the `INC-2026-0042-CARD` payment, still awaiting the capture sweep.
    const { prisma, paymentCreate } = makeFixture({
      bondLedger: {
        heldAmount: 500,
        capturedAmount: 500,
        status: "FULLY_CAPTURED",
        stripePaymentIntentId: "pi_bond_1",
        deductions: [],
      },
      priorSlices: [
        { id: "pay-prior-card", reference: "INC-2026-0042-CARD", status: "PENDING", amount: 250, notes: null },
      ],
    });

    await expect(
      chargeCustomerForIncident(prisma, { incidentId: "incident1", amount: 250, actorId: "mgr1" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(capturePaymentIntentMock).not.toHaveBeenCalled();
    expect(paymentCreate).not.toHaveBeenCalled();
  });

  it("reports CONFLICT (not cap-exhausted) when the prior charge already consumed the excess cap", async () => {
    // The prior charge itself counts into getDamageLiabilityUsed, so a retry
    // used to die on the misleading "cap exhausted — override to proceed"
    // BAD_REQUEST. The idempotency pre-check now runs FIRST.
    const { prisma, paymentCreate } = makeFixture({
      priorSlices: [
        { id: "pay-prior", reference: "INC-2026-0042", status: "SUCCEEDED", amount: 300, notes: null },
      ],
    });
    getBookingExcessMock.mockResolvedValue({ excess: 1000, source: "BOOKING_INSURANCE", tierName: "Basic" });
    getDamageLiabilityUsedMock.mockResolvedValue(1000);

    await expect(
      chargeCustomerForIncident(prisma, { incidentId: "incident1", amount: 300, actorId: "mgr1" }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("already been charged"),
    });
    expect(paymentCreate).not.toHaveBeenCalled();
  });

  // ---- Round 2: FAILED-slice resurrection (hard-decline retry path) ----

  const failedCardFixtureArgs = {
    bondLedger: {
      heldAmount: 500,
      capturedAmount: 500,
      status: "FULLY_CAPTURED",
      stripePaymentIntentId: "pi_bond_1",
      deductions: [],
    },
    priorSlices: [
      {
        id: "pay-failed-card",
        reference: "INC-2026-0042-CARD",
        status: "FAILED",
        amount: 300,
        notes: "capture-pending: failed — card_declined",
      },
    ],
    supersededCharges: [
      { id: "dc-old", amount: 300, capturedPaymentId: "pay-failed-card" },
    ],
    bookingBalanceDue: 300,
  };

  it("resurrects a hard-declined card slice: single PENDING row reused, notes appended, no duplicate", async () => {
    const { prisma, paymentCreate, paymentUpdate, damageChargeCreate, damageChargeUpdate } =
      makeFixture(failedCardFixtureArgs);

    const res = await chargeCustomerForIncident(prisma, {
      incidentId: "incident1",
      amount: 250,
      actorId: "mgr1",
    });

    expect(res.fromBond).toBe(0);
    expect(res.fromCard).toBe(250);
    // The FAILED row is flipped back to PENDING with the new slice — no
    // second Payment row, so the unique INC-<num>-CARD reference survives.
    expect(paymentCreate).not.toHaveBeenCalled();
    expect(paymentUpdate).toHaveBeenCalledTimes(1);
    const upd = paymentUpdate.mock.calls[0]?.[0] as {
      where: { id: string };
      data: Record<string, unknown>;
    };
    expect(upd.where).toEqual({ id: "pay-failed-card" });
    expect(upd.data).toMatchObject({ status: "PENDING", amount: 250 });
    expect(Number(upd.data.gstAmount)).toBeCloseTo(22.73, 2);
    // Failure history preserved, retry marker + reconcile marker appended
    // (the marker keeps reconcile-incident-charges.ts pass 2 off this row).
    expect(String(upd.data.notes)).toMatch(
      /^capture-pending: failed — card_declined\n\[RETRY: previous attempt FAILED/,
    );
    expect(String(upd.data.notes)).toContain("[RECONCILED:balance-due]");
    // The failed attempt's DamageCharge row is updated, not duplicated —
    // a second row would double getDamageLiabilityUsed.
    expect(damageChargeCreate).not.toHaveBeenCalled();
    expect(damageChargeUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "dc-old" },
        data: expect.objectContaining({ amount: 250, status: "CONFIRMED" }),
      }),
    );
  });

  it("resurrection applies only the balanceDue DELTA — the failed raise was never decremented on decline", async () => {
    // capture-pending-payments.ts / capture-retry.ts mark hard declines
    // FAILED without touching balanceDue, so the failed A$300 raise is still
    // on the booking. Re-raising A$250 must land net A$250, i.e. −A$50.
    const { prisma, bookingUpdate } = makeFixture(failedCardFixtureArgs);

    await chargeCustomerForIncident(prisma, {
      incidentId: "incident1",
      amount: 250,
      actorId: "mgr1",
    });

    expect(bookingUpdate).toHaveBeenCalledTimes(1);
    expect(bookingUpdate).toHaveBeenCalledWith({
      where: { id: "bk1" },
      data: { balanceDue: 250 },
    });
  });

  it("resurrection at the same amount leaves balanceDue untouched (delta zero)", async () => {
    const { prisma, bookingUpdate } = makeFixture(failedCardFixtureArgs);

    await chargeCustomerForIncident(prisma, {
      incidentId: "incident1",
      amount: 300,
      actorId: "mgr1",
    });

    expect(bookingUpdate).not.toHaveBeenCalled();
  });

  it("frees the failed slice's excess-cap consumption so the retry is not falsely cap-exhausted", async () => {
    // The failed attempt's CONFIRMED DamageCharge row still counts into
    // getDamageLiabilityUsed; without subtracting it the retry of the SAME
    // amount would die on "cap exhausted".
    const { prisma } = makeFixture(failedCardFixtureArgs);
    getBookingExcessMock.mockResolvedValue({ excess: 300, source: "BOOKING_INSURANCE", tierName: "Basic" });
    getDamageLiabilityUsedMock.mockResolvedValue(300); // entirely the failed slice

    const res = await chargeCustomerForIncident(prisma, {
      incidentId: "incident1",
      amount: 300,
      actorId: "mgr1",
    });

    expect(res.fromCard).toBe(300);
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

  // ---- Area 5: unified damage surface — DamageCharge rows per money slice ----

  it("creates a DamageCharge row per slice: bond slice CAPTURED with the bond deduction, card slice CONFIRMED on the PENDING payment", async () => {
    const { prisma, damageChargeCreate } = makeFixture();

    await chargeCustomerForIncident(prisma, {
      incidentId: "incident1",
      amount: 800,
      actorId: "mgr1",
    });

    expect(damageChargeCreate).toHaveBeenCalledTimes(2);
    const rows = damageChargeCreate.mock.calls.map(
      (c) => (c[0] as { data: Record<string, unknown> }).data,
    );
    const bondRow = rows.find((r) => r.status === "CAPTURED");
    const cardRow = rows.find((r) => r.status === "CONFIRMED");
    // Bond slice: money already captured — terminal row linked to the
    // SUCCEEDED bond Payment, with the bond deduction recorded in cents.
    expect(bondRow).toMatchObject({
      incidentId: "incident1",
      resolution: "STANDARD",
      severity: "MODERATE",
      amount: 500,
      capturedPaymentId: "pay-INC-2026-0042",
      bondDeductionCents: 50000,
      createdById: "mgr1",
    });
    // Card slice: raised but not yet collected — linked to the PENDING
    // card Payment the off-session sweep captures.
    expect(cardRow).toMatchObject({
      incidentId: "incident1",
      resolution: "STANDARD",
      severity: "MODERATE",
      amount: 300,
      capturedPaymentId: "pay-INC-2026-0042-CARD",
      createdById: "mgr1",
    });
    expect(cardRow?.bondDeductionCents).toBeUndefined();
    // CHECK-satisfying parent: incidentId set, no return-assessment parent.
    for (const row of rows) {
      expect(row.incidentId).toBe("incident1");
      expect(row.returnAssessmentId).toBeUndefined();
      expect(typeof row.description).toBe("string");
      expect((row.description as string).length).toBeGreaterThan(0);
    }
  });

  it("creates only the card-slice DamageCharge when no bond hold remains", async () => {
    const { prisma, damageChargeCreate } = makeFixture({
      bondLedger: {
        heldAmount: 500,
        capturedAmount: 500,
        status: "FULLY_CAPTURED",
        stripePaymentIntentId: "pi_bond_1",
        deductions: [],
      },
    });

    await chargeCustomerForIncident(prisma, {
      incidentId: "incident1",
      amount: 250,
      actorId: "mgr1",
    });

    expect(capturePaymentIntentMock).not.toHaveBeenCalled();
    expect(damageChargeCreate).toHaveBeenCalledTimes(1);
    const row = (damageChargeCreate.mock.calls[0]?.[0] as { data: Record<string, unknown> })
      .data;
    expect(row).toMatchObject({
      incidentId: "incident1",
      status: "CONFIRMED",
      amount: 250,
      capturedPaymentId: "pay-INC-2026-0042-CARD",
    });
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

// ---- Area 5: work-order → incident actual-cost feedback ----

function makeWoFixture(over: {
  actualDamageCost?: number | null;
  customerLiable?: boolean;
  chargePayments?: Array<{ amount: number }>;
  incident?: null;
} = {}) {
  const incident =
    over.incident === null
      ? null
      : {
          id: "incident1",
          incidentNumber: "2026-0042",
          customerLiable: over.customerLiable ?? true,
          actualDamageCost:
            over.actualDamageCost === undefined ? null : over.actualDamageCost,
          vehicle: { depotId: "depot1", internalCode: "SC-01" },
        };
  const incidentUpdate = vi.fn().mockResolvedValue({});
  const prisma = {
    incident: {
      findUnique: vi.fn().mockResolvedValue(incident),
      update: incidentUpdate,
    },
    payment: {
      findMany: vi.fn().mockResolvedValue(over.chargePayments ?? []),
    },
    user: {
      findMany: vi.fn().mockResolvedValue([{ id: "mgrA" }, { id: "mgrB" }]),
    },
  };
  return { prisma: prisma as never, incidentUpdate };
}

describe("recordWorkOrderCostForIncident", () => {
  it("backfills actualDamageCost when the incident has none, and audits the write", async () => {
    const { prisma, incidentUpdate } = makeWoFixture({
      chargePayments: [{ amount: 400 }],
    });

    const res = await recordWorkOrderCostForIncident(prisma, {
      incidentId: "incident1",
      workOrderNumber: "WO-77",
      actualCost: 512.5,
      actorId: "staff1",
    });

    expect(res.actualDamageCostWritten).toBe(true);
    expect(incidentUpdate).toHaveBeenCalledWith({
      where: { id: "incident1" },
      data: { actualDamageCost: 512.5 },
    });
    expect(writeAuditAsyncMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "INCIDENT_ACTUAL_COST_RECORDED",
        entityId: "incident1",
        newData: expect.objectContaining({ actualDamageCost: 512.5 }),
      }),
    );
  });

  it("does not overwrite an existing actualDamageCost", async () => {
    const { prisma, incidentUpdate } = makeWoFixture({
      actualDamageCost: 900,
      chargePayments: [{ amount: 900 }],
    });

    const res = await recordWorkOrderCostForIncident(prisma, {
      incidentId: "incident1",
      workOrderNumber: "WO-77",
      actualCost: 512.5,
      actorId: "staff1",
    });

    expect(res.actualDamageCostWritten).toBe(false);
    expect(incidentUpdate).not.toHaveBeenCalled();
  });

  it("nudges managers to review the charge when customer-liable but not yet charged", async () => {
    const { prisma } = makeWoFixture({ chargePayments: [] });

    await recordWorkOrderCostForIncident(prisma, {
      incidentId: "incident1",
      workOrderNumber: "WO-77",
      actualCost: 512.5,
      actorId: "staff1",
    });

    // One notification per manager (two mocked).
    expect(sendNotificationMock).toHaveBeenCalledTimes(2);
    const first = sendNotificationMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(String(first.subject)).toContain("actual repair cost recorded");
    expect(String(first.body)).toContain("has not been charged yet");
    expect([first.userId, (sendNotificationMock.mock.calls[1]?.[0] as Record<string, unknown>).userId]).toEqual([
      "mgrA",
      "mgrB",
    ]);
  });

  it("nudges managers to issue a partial refund when the actual cost came in under what was charged (ACL)", async () => {
    const { prisma } = makeWoFixture({
      chargePayments: [{ amount: 500 }, { amount: 300 }],
    });

    await recordWorkOrderCostForIncident(prisma, {
      incidentId: "incident1",
      workOrderNumber: "WO-77",
      actualCost: 512.5,
      actorId: "staff1",
    });

    expect(sendNotificationMock).toHaveBeenCalledTimes(2);
    const call = sendNotificationMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(String(call.subject)).toContain("below amount charged");
    // charged 800 − actual 512.50 = 287.50 refund suggestion.
    expect(String(call.body)).toContain("287.50");
  });

  it("stays quiet when the charge already matches or undercuts the actual cost", async () => {
    const { prisma } = makeWoFixture({ chargePayments: [{ amount: 500 }] });

    await recordWorkOrderCostForIncident(prisma, {
      incidentId: "incident1",
      workOrderNumber: "WO-77",
      actualCost: 512.5,
      actorId: "staff1",
    });

    expect(sendNotificationMock).not.toHaveBeenCalled();
  });

  it("stays quiet when the customer is not liable or there is no actual cost", async () => {
    const notLiable = makeWoFixture({ customerLiable: false });
    await recordWorkOrderCostForIncident(notLiable.prisma, {
      incidentId: "incident1",
      workOrderNumber: "WO-77",
      actualCost: 512.5,
      actorId: "staff1",
    });
    expect(sendNotificationMock).not.toHaveBeenCalled();

    const noCost = makeWoFixture({});
    const res = await recordWorkOrderCostForIncident(noCost.prisma, {
      incidentId: "incident1",
      workOrderNumber: "WO-77",
      actualCost: null,
      actorId: "staff1",
    });
    expect(res.actualDamageCostWritten).toBe(false);
    expect(sendNotificationMock).not.toHaveBeenCalled();
  });
});
