import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Rolling bond re-hold (bond-auth-expiry-check).
 *
 *   - live-hire bond near/past its brand horizon → re-authorised
 *     off-session via ensureFreshBondHold, NO manager notification
 *   - already-expired holds are processed too (old code skipped daysLeft<0)
 *   - re-auth failure → manager alert, deduped per bond per 23h
 *   - CONFIRMED (pre-pickup) → skipped (check-out re-holds with the
 *     customer present)
 *   - horizon measured from authorizedAt (reset by prior re-auths)
 */

const ledgerFindMany = vi.fn();
const auditFindFirst = vi.fn();
const auditCreate = vi.fn().mockResolvedValue({});
const userFindMany = vi.fn().mockResolvedValue([{ id: "mgr_1" }]);
const sendNotification = vi.fn().mockResolvedValue({});
const ensureFreshBondHold = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    bondLedger: { findMany: ledgerFindMany },
    auditLog: { findFirst: auditFindFirst, create: auditCreate },
    user: { findMany: userFindMany },
  },
}));
vi.mock("@/server/services/notification-sender", () => ({ sendNotification }));
vi.mock("@/server/services/bond", async (orig) => ({
  ...(await orig<typeof import("@/server/services/bond")>()),
  ensureFreshBondHold: (...a: unknown[]) => ensureFreshBondHold(...a),
}));
vi.mock("@/server/jobs/queue", () => ({
  getQueue: vi.fn().mockReturnValue(null),
  registerWorker: vi.fn(),
  monitorCron: vi.fn(),
}));
vi.mock("@/lib/settings", () => ({
  getSetting: vi.fn().mockResolvedValue(2),
  SETTING_DEFAULTS: { "payment.bondReauthLeadDays": 2 },
}));

const DAY = 86_400_000;

function makeBond(over: Record<string, unknown> = {}) {
  return {
    id: "bond_1",
    status: "HELD",
    stripePaymentIntentId: "pi_1",
    authorizedAt: new Date(Date.now() - 6 * DAY), // Visa 7d horizon − 6d = 1d left
    createdAt: new Date(Date.now() - 20 * DAY),
    booking: {
      id: "b1",
      bookingReference: "SCT-0001",
      status: "ACTIVE",
      customer: {
        id: "cust_1",
        customerProfile: { stripePaymentMethodBrand: "visa" },
      },
    },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  auditFindFirst.mockResolvedValue(null);
  userFindMany.mockResolvedValue([{ id: "mgr_1" }]);
});

describe("bond-auth-expiry-check (rolling re-hold)", () => {
  it("re-authorises an expiring live-hire bond off-session with no notification", async () => {
    ledgerFindMany.mockResolvedValue([makeBond()]);
    ensureFreshBondHold.mockResolvedValue({ ok: true, action: "reauthorized" });
    const { runBondAuthExpiryCheck } = await import("@/server/jobs/bond-auth-expiry-check");
    const r = await runBondAuthExpiryCheck();
    expect(r.reauthorized).toBe(1);
    expect(ensureFreshBondHold).toHaveBeenCalledWith(expect.anything(), {
      bookingId: "b1",
      minRemainingDays: 2,
      reason: "rolling-reauth",
    });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("processes ALREADY-EXPIRED holds instead of skipping them", async () => {
    ledgerFindMany.mockResolvedValue([
      makeBond({ authorizedAt: new Date(Date.now() - 12 * DAY) }), // 5 days past Visa horizon
    ]);
    ensureFreshBondHold.mockResolvedValue({ ok: true, action: "reauthorized" });
    const { runBondAuthExpiryCheck } = await import("@/server/jobs/bond-auth-expiry-check");
    const r = await runBondAuthExpiryCheck();
    expect(r.reauthorized).toBe(1);
  });

  it("alerts managers when the re-auth fails, deduped per bond per day", async () => {
    ledgerFindMany.mockResolvedValue([makeBond()]);
    ensureFreshBondHold.mockResolvedValue({
      ok: false,
      action: "failed",
      errorCode: "card_declined",
    });
    const { runBondAuthExpiryCheck } = await import("@/server/jobs/bond-auth-expiry-check");
    const r = await runBondAuthExpiryCheck();
    expect(r.failed).toBe(1);
    expect(r.alerted).toBe(1);
    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "mgr_1" }),
    );

    // Second run inside the dedup window → no second alert.
    sendNotification.mockClear();
    auditFindFirst.mockResolvedValue({ id: "audit_1" });
    const r2 = await runBondAuthExpiryCheck();
    expect(r2.failed).toBe(1);
    expect(r2.alerted).toBe(0);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("skips CONFIRMED (pre-pickup) bonds — check-out refreshes those", async () => {
    ledgerFindMany.mockResolvedValue([
      makeBond({ booking: { ...makeBond().booking, status: "CONFIRMED" } }),
    ]);
    const { runBondAuthExpiryCheck } = await import("@/server/jobs/bond-auth-expiry-check");
    const r = await runBondAuthExpiryCheck();
    expect(r.skippedPrePickup).toBe(1);
    expect(ensureFreshBondHold).not.toHaveBeenCalled();
  });

  it("leaves bonds with plenty of horizon alone (measured from authorizedAt)", async () => {
    ledgerFindMany.mockResolvedValue([
      // Re-authed yesterday: 6 days left on Visa despite a 20-day-old row.
      makeBond({ authorizedAt: new Date(Date.now() - 1 * DAY) }),
    ]);
    const { runBondAuthExpiryCheck } = await import("@/server/jobs/bond-auth-expiry-check");
    const r = await runBondAuthExpiryCheck();
    expect(r.reauthorized).toBe(0);
    expect(ensureFreshBondHold).not.toHaveBeenCalled();
  });
});
