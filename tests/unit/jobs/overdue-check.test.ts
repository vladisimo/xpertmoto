import { beforeEach, describe, expect, it, vi } from "vitest";

// Focus (Area 2): bookings whose vehicle is already in a disposition status
// (SOLD / END_OF_LIFE / STOLEN / WRITTEN_OFF) must be excluded from the
// WHOLE overdue ladder — stage 1–4 escalation, the stage-4 auto-theft
// incident, AND late-day fee accrual. The loss-termination / theft flows own
// those bookings; accruing fees against a vehicle that no longer exists in
// service would be pure balance pollution.

const txMock = {
  payment: { create: vi.fn(async () => ({})) },
  booking: { update: vi.fn(async () => ({})) },
  bookingStatusLog: { create: vi.fn(async () => ({})) },
  bookingNote: { create: vi.fn(async () => ({})) },
  incident: { create: vi.fn(async () => ({})) },
};
vi.mock("@/lib/prisma", () => ({
  prisma: {
    booking: {
      findMany: vi.fn(),
      update: vi.fn(async () => ({})),
    },
    user: { findMany: vi.fn(async () => []) },
    $transaction: vi.fn(async (cb: (tx: typeof txMock) => Promise<unknown>) => cb(txMock)),
  },
}));
vi.mock("@/lib/settings", () => ({
  getSettings: vi.fn(async () => ({ "booking.lateReturnGraceHours": 1 })),
  getSetting: vi.fn(async (_k: string, fallback: unknown) => fallback),
  SETTING_DEFAULTS: { "booking.lateReturnGraceHours": 1 },
}));
vi.mock("@/lib/branding", () => ({
  getBranding: vi.fn(async () => ({ siteName: "XPERT Moto" })),
}));
const sendNotificationMock = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock("@/server/services/notification-sender", () => ({
  sendNotification: (...a: unknown[]) => sendNotificationMock(...a),
}));
vi.mock("@/server/services/revenue-aggregator", () => ({
  recordIncidentForCustomer: vi.fn(async () => undefined),
}));
vi.mock("@/lib/analytics", () => ({
  trackServer: vi.fn(async () => undefined),
}));
vi.mock("@react-email/render", () => ({
  render: vi.fn(async () => "<html />"),
}));
vi.mock("../../../emails/overdue-notice", () => ({ default: () => null }));

import { runOverdueCheck } from "../../../src/server/jobs/overdue-check";
import { prisma } from "../../../src/lib/prisma";

type MockFn = ReturnType<typeof vi.fn>;
const mockedFindMany = prisma.booking.findMany as unknown as MockFn;
const mockedTransaction = prisma.$transaction as unknown as MockFn;

function makeCandidate(over: Record<string, unknown> = {}) {
  return {
    id: "bLate",
    bookingReference: "XPM-20260810-0002",
    status: "ACTIVE",
    overdueStage: 0,
    customerId: "cust1",
    pickupDepotId: "d1",
    returnDateTime: new Date(Date.now() - 30 * 3600_000),
    customer: {
      id: "cust1",
      email: "c@x.io",
      firstName: "Vlad",
      lastName: "T",
      phone: null,
    },
    category: { baseDailyRate: 100 },
    vehicle: { id: "v2", status: "ON_HIRE" },
    pickupDepot: { slug: "brisbane" },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("overdue-check — loss-event exclusion (Area 2)", () => {
  it("skips a booking whose vehicle is in a disposition status: no stages, no incident, no late fees", async () => {
    // 80h late — would otherwise fire ALL four stages (incl. the auto-theft
    // incident) and raise late-day fees.
    mockedFindMany.mockResolvedValue([
      makeCandidate({
        id: "bLost",
        bookingReference: "XPM-20260810-0001",
        status: "OVERDUE",
        vehicle: { id: "v1", status: "STOLEN" },
        returnDateTime: new Date(Date.now() - 80 * 3600_000),
      }),
    ]);

    const res = await runOverdueCheck();

    expect(res.scanned).toBe(1);
    expect(res.transitionedToOverdue).toBe(0);
    expect(res.incidentsCreated).toBe(0);
    expect(res.stageAdvances).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0 });
    // Nothing was written at all — no fee raise, no stage tx, no incident.
    expect(mockedTransaction).not.toHaveBeenCalled();
    expect(txMock.payment.create).not.toHaveBeenCalled();
    expect(txMock.incident.create).not.toHaveBeenCalled();
    expect(sendNotificationMock).not.toHaveBeenCalled();
  });

  it.each(["SOLD", "END_OF_LIFE", "WRITTEN_OFF"] as const)(
    "also skips vehicle status %s",
    async (status) => {
      mockedFindMany.mockResolvedValue([
        makeCandidate({
          id: "bGone",
          vehicle: { id: "v9", status },
          returnDateTime: new Date(Date.now() - 30 * 3600_000),
        }),
      ]);
      const res = await runOverdueCheck();
      expect(res.stageAdvances).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0 });
      expect(mockedTransaction).not.toHaveBeenCalled();
    },
  );

  it("the exclusion is targeted: a normal late booking still walks the ladder and accrues fees", async () => {
    // One lost-vehicle booking and one genuinely late booking (30h late →
    // stages 1–3 + one completed late day past the 1h grace).
    mockedFindMany.mockResolvedValue([
      makeCandidate({
        id: "bLost",
        bookingReference: "XPM-20260810-0001",
        vehicle: { id: "v1", status: "STOLEN" },
        returnDateTime: new Date(Date.now() - 80 * 3600_000),
      }),
      makeCandidate(),
    ]);

    const res = await runOverdueCheck();

    expect(res.scanned).toBe(2);
    expect(res.transitionedToOverdue).toBe(1);
    expect(res.stageAdvances).toEqual({ 1: 1, 2: 1, 3: 1, 4: 0 });

    // Exactly one late-day fee, and only for the normal booking.
    const feeRefs = txMock.payment.create.mock.calls.map(
      (c) => ((c as unknown[])[0] as { data: { reference: string } }).data.reference,
    );
    expect(feeRefs).toEqual(["LATE-bLate-D1"]);
    expect(feeRefs.some((r) => r.includes("bLost"))).toBe(false);
  });
});
