import { beforeEach, describe, expect, it, vi } from "vitest";

// Focus (Area 2): the rolling re-auth keep-alive predicate. Loss-terminated
// hires land COMPLETED — normally a terminal status this job ignores — but a
// termination with bondDisposition HELD_FOR_CLAIM means the hold is
// deliberately kept alive for the incident claim, so it must be re-authorised
// like a live hire. Any other COMPLETED booking stays out of the keep-alive
// set (bond-auto-release owns those).

vi.mock("@/lib/prisma", () => ({
  prisma: {
    bondLedger: { findMany: vi.fn() },
    auditLog: { findFirst: vi.fn(async () => null), create: vi.fn(async () => ({})) },
    user: { findMany: vi.fn(async () => []) },
  },
}));
vi.mock("@/lib/settings", () => ({
  getSetting: vi.fn(async () => 3),
  SETTING_DEFAULTS: { "payment.bondReauthLeadDays": 3 },
}));
const ensureFreshBondHoldMock = vi.fn();
vi.mock("@/server/services/bond", () => ({
  bondAuthHorizonDays: vi.fn(() => 7),
  ensureFreshBondHold: (...a: unknown[]) => ensureFreshBondHoldMock(...a),
}));
vi.mock("@/server/services/notification-sender", () => ({
  sendNotification: vi.fn(async () => undefined),
}));

import { runBondAuthExpiryCheck } from "../../../src/server/jobs/bond-auth-expiry-check";
import { prisma } from "../../../src/lib/prisma";

type MockFn = ReturnType<typeof vi.fn>;
const mockedFindMany = prisma.bondLedger.findMany as unknown as MockFn;

function makeBond(over: {
  status?: string;
  termination?: { bondDisposition: string } | null;
}) {
  return {
    id: "bond1",
    authorizedAt: new Date(Date.now() - 6 * 86_400_000), // visa horizon 7 → ~1 day left
    createdAt: new Date(Date.now() - 6 * 86_400_000),
    booking: {
      id: "b1",
      bookingReference: "XPM-20260810-0001",
      status: over.status ?? "COMPLETED",
      termination: over.termination === undefined ? null : over.termination,
      customer: {
        id: "cust1",
        customerProfile: { stripePaymentMethodBrand: "visa" },
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  ensureFreshBondHoldMock.mockResolvedValue({ ok: true, action: "reauthorized" });
});

describe("bond-auth-expiry-check — HELD_FOR_CLAIM keep-alive (Area 2)", () => {
  it("re-authorises a COMPLETED loss-terminated booking whose bond is HELD_FOR_CLAIM", async () => {
    mockedFindMany.mockResolvedValue([
      makeBond({ termination: { bondDisposition: "HELD_FOR_CLAIM" } }),
    ]);

    const res = await runBondAuthExpiryCheck();

    expect(ensureFreshBondHoldMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        bookingId: "b1",
        minRemainingDays: 3,
        reason: "rolling-reauth",
      }),
    );
    expect(res.reauthorized).toBe(1);
    expect(res.failed).toBe(0);
  });

  it("leaves an ordinary COMPLETED booking (no termination) out of the keep-alive set", async () => {
    mockedFindMany.mockResolvedValue([makeBond({ termination: null })]);

    const res = await runBondAuthExpiryCheck();

    expect(ensureFreshBondHoldMock).not.toHaveBeenCalled();
    expect(res.reauthorized).toBe(0);
  });

  it("a termination whose bond was RELEASED (or captured) does not keep the hold alive", async () => {
    mockedFindMany.mockResolvedValue([
      makeBond({ termination: { bondDisposition: "RELEASED" } }),
      makeBond({ termination: { bondDisposition: "CAPTURED_VIA_INCIDENT" } }),
    ]);

    const res = await runBondAuthExpiryCheck();

    expect(ensureFreshBondHoldMock).not.toHaveBeenCalled();
    expect(res.reauthorized).toBe(0);
  });

  it("live hires still re-auth as before (regression anchor)", async () => {
    mockedFindMany.mockResolvedValue([
      makeBond({ status: "ACTIVE", termination: null }),
    ]);

    const res = await runBondAuthExpiryCheck();

    expect(ensureFreshBondHoldMock).toHaveBeenCalledTimes(1);
    expect(res.reauthorized).toBe(1);
  });
});
