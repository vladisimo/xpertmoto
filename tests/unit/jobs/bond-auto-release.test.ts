import { beforeEach, describe, expect, it, vi } from "vitest";

// Focus (Area 3): the nightly bond auto-release must never write off a bond
// while the booking still has an OPEN customer-liable incident — that bond
// is the funding source for the pending theft/damage claim.

const txMock = {
  bondLedger: { update: vi.fn(async () => ({})) },
  payment: { create: vi.fn(async () => ({})) },
};
vi.mock("@/lib/prisma", () => ({
  prisma: {
    bondLedger: { findMany: vi.fn(async () => []) },
    damageCharge: { count: vi.fn(async () => 0) },
    incident: { count: vi.fn(async () => 0) },
    auditLog: { findFirst: vi.fn(async () => null), create: vi.fn(async () => ({})) },
    user: { findMany: vi.fn(async () => [{ id: "mgr1" }]) },
    $transaction: vi.fn(async (cb: (tx: typeof txMock) => Promise<unknown>) => cb(txMock)),
  },
}));
vi.mock("@/lib/settings", () => ({
  getSetting: vi.fn(async (_k: string, fallback: unknown) => fallback),
  SETTING_DEFAULTS: { "payment.bondReleaseDays": 14 },
}));
const cancelPaymentIntentMock = vi.fn(async (..._a: unknown[]) => ({}));
vi.mock("@/lib/stripe", () => ({
  cancelPaymentIntent: (...a: unknown[]) => cancelPaymentIntentMock(...a),
}));
const sendNotificationMock = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock("@/server/services/notification-sender", () => ({
  sendNotification: (...a: unknown[]) => sendNotificationMock(...a),
}));
vi.mock("@/lib/analytics", () => ({
  trackServer: vi.fn(async () => undefined),
}));
vi.mock("@react-email/render", () => ({
  render: vi.fn(async () => "<html />"),
}));
vi.mock("../../../emails/bond-released", () => ({ default: () => null }));

import { runBondAutoRelease } from "../../../src/server/jobs/bond-auto-release";
import { prisma } from "../../../src/lib/prisma";

type MockFn = ReturnType<typeof vi.fn>;
const mockedCandidates = prisma.bondLedger.findMany as unknown as MockFn;
const mockedIncidentCount = prisma.incident.count as unknown as MockFn;
const mockedDamageCount = prisma.damageCharge.count as unknown as MockFn;
const mockedAuditFindFirst = prisma.auditLog.findFirst as unknown as MockFn;
const mockedAuditCreate = prisma.auditLog.create as unknown as MockFn;

function makeBond(over: Record<string, unknown> = {}) {
  return {
    id: "bond1",
    bookingId: "bk1",
    customerId: "cust1",
    heldAmount: 500,
    stripePaymentIntentId: "pi_bond_1",
    booking: {
      id: "bk1",
      bookingReference: "XPM-20260701-0001",
      balanceDue: 0,
      customer: { id: "cust1", firstName: "Ada", lastName: "Lovelace", email: "a@x.io" },
      pickupDepot: { slug: "brisbane" },
    },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedCandidates.mockResolvedValue([]);
  mockedIncidentCount.mockResolvedValue(0);
  mockedDamageCount.mockResolvedValue(0);
  mockedAuditFindFirst.mockResolvedValue(null);
});

describe("bond-auto-release — open customer-liable incident guard (Area 3)", () => {
  it("blocks the release while an open customer-liable incident exists, alerting managers once", async () => {
    mockedCandidates.mockResolvedValue([makeBond()]);
    mockedIncidentCount.mockResolvedValue(1);

    const released = await runBondAutoRelease();

    expect(released).toBe(0);
    // The guard fired before any Stripe or ledger write.
    expect(cancelPaymentIntentMock).not.toHaveBeenCalled();
    expect(txMock.bondLedger.update).not.toHaveBeenCalled();
    expect(txMock.payment.create).not.toHaveBeenCalled();

    // Query shape: open = not RESOLVED/CLOSED, customer-liable, not deleted.
    expect(mockedIncidentCount).toHaveBeenCalledWith({
      where: {
        bookingId: "bk1",
        customerLiable: true,
        deletedAt: null,
        status: { notIn: ["RESOLVED", "CLOSED"] },
      },
    });

    // Manager alert mentions the incident block; audit dedup row written.
    const alertBody = (sendNotificationMock.mock.calls[0]?.[0] as { body?: string })?.body ?? "";
    expect(alertBody).toContain("customer-liable incident");
    expect(mockedAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "bond.release_blocked_alert",
          newData: expect.objectContaining({ openIncidents: 1 }),
        }),
      }),
    );
  });

  it("suppresses the repeat alert within 24h but still skips the release", async () => {
    mockedCandidates.mockResolvedValue([makeBond()]);
    mockedIncidentCount.mockResolvedValue(1);
    mockedAuditFindFirst.mockResolvedValue({ id: "prior-alert" });

    const released = await runBondAutoRelease();

    expect(released).toBe(0);
    expect(sendNotificationMock).not.toHaveBeenCalled();
    expect(cancelPaymentIntentMock).not.toHaveBeenCalled();
  });

  it("releases normally once the incident is resolved (guard is targeted)", async () => {
    mockedCandidates.mockResolvedValue([makeBond()]);
    mockedIncidentCount.mockResolvedValue(0);

    const released = await runBondAutoRelease();

    expect(released).toBe(1);
    expect(cancelPaymentIntentMock).toHaveBeenCalledWith("pi_bond_1");
    expect(txMock.bondLedger.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "bond1" },
        data: expect.objectContaining({ status: "RELEASED" }),
      }),
    );
    expect(txMock.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: "BOND_RELEASE" }),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Round-2 item 1 — a loss termination that parked the bond HELD_FOR_CLAIM is
// deliberate state: never auto-release it, and never alert (nothing is
// wrong). Release resumes only via the incident capture flow or an explicit
// manager release.
// ---------------------------------------------------------------------------
describe("bond-auto-release — HELD_FOR_CLAIM termination guard", () => {
  it("excludes claim-held bonds in the candidate query itself", async () => {
    await runBondAutoRelease();
    expect(mockedCandidates).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          booking: expect.objectContaining({
            OR: [
              { termination: null },
              { termination: { bondDisposition: { not: "HELD_FOR_CLAIM" } } },
            ],
          }),
        }),
      }),
    );
  });

  it("skips a claim-held bond silently — no release, no Stripe cancel, no manager alert", async () => {
    const bond = makeBond();
    (bond.booking as Record<string, unknown>).termination = {
      bondDisposition: "HELD_FOR_CLAIM",
    };
    mockedCandidates.mockResolvedValue([bond]);

    const released = await runBondAutoRelease();

    expect(released).toBe(0);
    expect(cancelPaymentIntentMock).not.toHaveBeenCalled();
    expect(txMock.bondLedger.update).not.toHaveBeenCalled();
    expect(txMock.payment.create).not.toHaveBeenCalled();
    // Deliberate state → NOT the release-blocked alert path.
    expect(sendNotificationMock).not.toHaveBeenCalled();
    expect(mockedAuditCreate).not.toHaveBeenCalled();
  });

  it("releases normally when the termination disposition is RELEASED", async () => {
    const bond = makeBond();
    (bond.booking as Record<string, unknown>).termination = {
      bondDisposition: "RELEASED",
    };
    mockedCandidates.mockResolvedValue([bond]);

    const released = await runBondAutoRelease();

    expect(released).toBe(1);
    expect(cancelPaymentIntentMock).toHaveBeenCalledWith("pi_bond_1");
    expect(txMock.bondLedger.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "RELEASED" }) }),
    );
  });
});
