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
  incident: { create: vi.fn(async (..._a: unknown[]) => ({ id: "inc-auto-1" })) },
  incidentNote: { create: vi.fn(async (..._a: unknown[]) => ({})) },
};
vi.mock("@/lib/prisma", () => ({
  prisma: {
    booking: {
      findMany: vi.fn(),
      update: vi.fn(async () => ({})),
    },
    user: { findMany: vi.fn(async () => []) },
    vehicleLivePosition: { findUnique: vi.fn(async () => null) },
    $transaction: vi.fn(async (cb: (tx: typeof txMock) => Promise<unknown>) => cb(txMock)),
  },
}));
const ensureFreshBondHoldMock = vi.fn(
  async (..._a: unknown[]) => ({ ok: true, action: "fresh" }) as { ok: boolean; action: string },
);
vi.mock("@/server/services/bond", () => ({
  ensureFreshBondHold: (...a: unknown[]) => ensureFreshBondHoldMock(...a),
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
const mockedLivePosition = prisma.vehicleLivePosition.findUnique as unknown as MockFn;

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

  it("stage 4 (Area 3): snapshots the last GPS fix, notes the maps link, re-holds the bond, pages managers with the fix", async () => {
    // overdueStage 3 → only stage 4 fires on this run.
    (prisma.user.findMany as unknown as MockFn).mockResolvedValue([{ id: "mgr1" }]);
    mockedLivePosition.mockResolvedValue({
      deviceId: "dev1",
      latitude: -27.5,
      longitude: 153.01,
      speedKph: 12,
      ignitionOn: true,
      timestamp: new Date(Date.now() - 5 * 60_000),
    });
    mockedFindMany.mockResolvedValue([
      makeCandidate({
        overdueStage: 3,
        status: "OVERDUE",
        returnDateTime: new Date(Date.now() - 80 * 3600_000),
      }),
    ]);

    const res = await runOverdueCheck();

    expect(res.stageAdvances).toEqual({ 1: 0, 2: 0, 3: 0, 4: 1 });
    expect(res.incidentsCreated).toBe(1);

    // GPS snapshot persisted on the incident (only fields the model carries).
    const incidentData = (
      txMock.incident.create.mock.calls[0]?.[0] as { data: Record<string, unknown> }
    ).data;
    expect(incidentData.gpsSnapshot).toMatchObject({
      lat: -27.5,
      lng: 153.01,
      speedKph: 12,
      ignitionOn: true,
      deviceId: "dev1",
    });

    // Internal incident note carries the Google Maps link.
    const noteData = (
      txMock.incidentNote.create.mock.calls[0]?.[0] as { data: Record<string, unknown> }
    ).data;
    expect(noteData.incidentId).toBe("inc-auto-1");
    expect(noteData.isInternal).toBe(true);
    expect(String(noteData.note)).toContain("https://www.google.com/maps?q=-27.5,153.01");

    // Theft-suspected bond re-hold fired immediately.
    expect(ensureFreshBondHoldMock).toHaveBeenCalledTimes(1);
    expect(ensureFreshBondHoldMock.mock.calls[0]?.[1]).toMatchObject({
      bookingId: "bLate",
      reason: "theft-suspected",
    });

    // Manager page includes the position, fix age and the maps link.
    const managerBody = sendNotificationMock.mock.calls
      .map((c) => (c[0] as { body?: string }).body ?? "")
      .find((b) => b.includes("72+ hours"));
    expect(managerBody).toContain("Last GPS fix: -27.5, 153.01");
    expect(managerBody).toContain("5 min ago");
    expect(managerBody).toContain("https://www.google.com/maps?q=-27.5,153.01");
  });

  it("stage 4 degrades gracefully for a vehicle without a live position", async () => {
    mockedLivePosition.mockResolvedValue(null);
    mockedFindMany.mockResolvedValue([
      makeCandidate({
        overdueStage: 3,
        status: "OVERDUE",
        returnDateTime: new Date(Date.now() - 80 * 3600_000),
      }),
    ]);

    const res = await runOverdueCheck();

    expect(res.stageAdvances[4]).toBe(1);
    const incidentData = (
      txMock.incident.create.mock.calls[0]?.[0] as { data: Record<string, unknown> }
    ).data;
    expect(incidentData.gpsSnapshot).toBeUndefined();
    expect(txMock.incidentNote.create).not.toHaveBeenCalled();
    // The bond re-hold still runs — theft suspicion doesn't need GPS.
    expect(ensureFreshBondHoldMock).toHaveBeenCalledTimes(1);
  });

  it("stage 4 survives a failed bond re-hold (non-fatal, stage still advances)", async () => {
    mockedLivePosition.mockResolvedValue(null);
    ensureFreshBondHoldMock.mockResolvedValueOnce({ ok: false, action: "no_pm" });
    mockedFindMany.mockResolvedValue([
      makeCandidate({
        overdueStage: 3,
        status: "OVERDUE",
        returnDateTime: new Date(Date.now() - 80 * 3600_000),
      }),
    ]);

    const res = await runOverdueCheck();

    expect(res.stageAdvances[4]).toBe(1);
    expect(res.incidentsCreated).toBe(1);
  });

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
