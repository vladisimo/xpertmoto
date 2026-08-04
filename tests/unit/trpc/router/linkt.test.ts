import { describe, expect, test, vi, beforeEach } from "vitest";

// resolveUnmatched dynamically imports the fee + charge helpers; stub them so
// the manual staff-charge path is observable without hitting Stripe/DB.
const applyInfringementRecoveryCharge = vi.fn();
vi.mock("@/server/services/infringement-charge", () => ({
  applyInfringementRecoveryCharge: (...a: unknown[]) => applyInfringementRecoveryCharge(...a),
}));
vi.mock("@/server/services/toll-admin-fee", () => ({
  getTollAdminFee: vi.fn().mockResolvedValue(2.5),
}));
vi.mock("@/server/services/audit", () => ({ writeAuditAsync: vi.fn() }));

import { linktRouter, validateResolveInputs } from "@/server/trpc/router/linkt";

describe("validateResolveInputs", () => {
  const BASE = {
    alreadyResolved: false,
    bookingVehicleId: null,
    selectedVehicleId: "veh_1",
    linkMode: "none" as const,
    hasBookingId: false,
    hasCustomerId: false,
  };

  test("accepts no-customer mode with just a vehicle", () => {
    expect(validateResolveInputs(BASE).ok).toBe(true);
  });

  test("rejects when the row is already resolved (race with the sync worker)", () => {
    const r = validateResolveInputs({ ...BASE, alreadyResolved: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/already been resolved/);
  });

  test("booking mode requires a bookingId", () => {
    const r = validateResolveInputs({ ...BASE, linkMode: "booking", hasBookingId: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/Missing booking/);
  });

  test("booking mode rejects a booking bound to a different vehicle", () => {
    const r = validateResolveInputs({
      ...BASE,
      linkMode: "booking",
      hasBookingId: true,
      bookingVehicleId: "veh_OTHER",
      selectedVehicleId: "veh_1",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/not for the selected vehicle/);
  });

  test("booking mode accepts a booking whose vehicle matches the selection", () => {
    const r = validateResolveInputs({
      ...BASE,
      linkMode: "booking",
      hasBookingId: true,
      bookingVehicleId: "veh_1",
      selectedVehicleId: "veh_1",
    });
    expect(r.ok).toBe(true);
  });

  test("customer mode requires a customerId", () => {
    const r = validateResolveInputs({ ...BASE, linkMode: "customer", hasCustomerId: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/Missing customer/);
  });
});

describe("linkt router auth", () => {
  // adminProcedure / managerProcedure must reject an anonymous (null-session)
  // caller before any DB work happens.
  function anonCtx() {
    return {
      prisma: {},
      session: null,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      reqId: "r1",
    } as never;
  }

  test("createAccount (admin) rejects without a session", async () => {
    const caller = linktRouter.createCaller(anonCtx());
    await expect(
      caller.createAccount({ name: "Linkt NSW", username: "u", password: "p", region: "NSW" }),
    ).rejects.toThrow();
  });

  test("listAccounts (manager) rejects without a session", async () => {
    const caller = linktRouter.createCaller(anonCtx());
    await expect(caller.listAccounts()).rejects.toThrow();
  });

  test("scrapeNow (manager) rejects without a session", async () => {
    const caller = linktRouter.createCaller(anonCtx());
    await expect(caller.scrapeNow({ id: "acc_1" })).rejects.toThrow();
  });

  test("setScrapeEnabled (admin) rejects without a session", async () => {
    const caller = linktRouter.createCaller(anonCtx());
    await expect(caller.setScrapeEnabled({ id: "acc_1", enabled: true })).rejects.toThrow();
  });
});

describe("linkt.resolveUnmatched — staff manual assignment", () => {
  const ROW = {
    id: "row_1",
    externalHash: "hash_abc",
    eventAt: new Date("2026-06-15T02:33:00Z"),
    plate: "ABC123",
    tollpoint: "M5 South West",
    rawDetails: "raw details",
    amountCents: 1079,
    resolvedAt: null as Date | null,
    account: { id: "acc_1", name: "Fleet", region: "NSW" },
  };

  function makePrisma(over: Record<string, unknown> = {}) {
    return {
      linktUnmatchedRow: {
        findUnique: vi.fn().mockResolvedValue({ ...ROW }),
        update: vi.fn().mockResolvedValue({ id: ROW.id }),
      },
      booking: {
        findUnique: vi.fn().mockResolvedValue({ id: "bk_1", vehicleId: "veh_1", customerId: "cust_1" }),
      },
      user: { findUnique: vi.fn().mockResolvedValue({ id: "cust_1" }) },
      infringement: {
        findUnique: vi.fn().mockResolvedValue(null), // no race by default
        create: vi.fn().mockResolvedValue({
          id: "inf_1",
          type: "TOLL",
          issuer: "Linkt-NSW (Fleet)",
          referenceNumber: ROW.externalHash,
        }),
      },
      ...over,
    };
  }

  function managerCtx(prisma: unknown) {
    const user = { id: "mgr1", email: "mgr@xpert.test", name: "Mgr", role: "MANAGER", depotId: null };
    return {
      prisma,
      user,
      session: { user },
      ipAddress: "127.0.0.1",
      userAgent: "test",
      reqId: "r1",
      headers: undefined,
    } as unknown as Parameters<typeof linktRouter.createCaller>[0];
  }

  beforeEach(() => {
    vi.clearAllMocks();
    applyInfringementRecoveryCharge.mockResolvedValue({
      paymentId: "pay_1",
      alreadyExisted: false,
      amount: 13.29,
    });
  });

  test("a booking match creates a CUSTOMER_CHARGED toll and raises the recovery charge", async () => {
    const prisma = makePrisma();
    const caller = linktRouter.createCaller(managerCtx(prisma));

    const res = await caller.resolveUnmatched({ id: "row_1", vehicleId: "veh_1", bookingId: "bk_1" });

    expect(res).toEqual({ infringementId: "inf_1" });
    const createArgs = prisma.infringement.create.mock.calls[0]![0] as {
      data: { status: string; bookingId?: string; customerId?: string; type: string };
    };
    expect(createArgs.data).toMatchObject({
      type: "TOLL",
      status: "CUSTOMER_CHARGED",
      bookingId: "bk_1",
      customerId: "cust_1",
    });
    expect(applyInfringementRecoveryCharge).toHaveBeenCalledTimes(1);
    expect(applyInfringementRecoveryCharge.mock.calls[0]![0]).toMatchObject({
      infringement: { customerId: "cust_1", bookingId: "bk_1", referenceNumber: "hash_abc" },
    });
    expect(prisma.linktUnmatchedRow.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ resolvedAction: "RESOLVED" }) }),
    );
  });

  test("rejects a booking that belongs to a different vehicle (no charge)", async () => {
    const prisma = makePrisma();
    prisma.booking.findUnique.mockResolvedValue({ id: "bk_1", vehicleId: "OTHER", customerId: "cust_1" });
    const caller = linktRouter.createCaller(managerCtx(prisma));
    await expect(
      caller.resolveUnmatched({ id: "row_1", vehicleId: "veh_1", bookingId: "bk_1" }),
    ).rejects.toThrow(/not for the selected vehicle/);
    expect(prisma.infringement.create).not.toHaveBeenCalled();
    expect(applyInfringementRecoveryCharge).not.toHaveBeenCalled();
  });

  test("vehicle-only resolution records a RECEIVED toll and does not charge", async () => {
    const prisma = makePrisma();
    const caller = linktRouter.createCaller(managerCtx(prisma));

    await caller.resolveUnmatched({ id: "row_1", vehicleId: "veh_1" });

    const createArgs = prisma.infringement.create.mock.calls[0]![0] as {
      data: { status: string; bookingId?: string };
    };
    expect(createArgs.data.status).toBe("RECEIVED");
    expect(createArgs.data.bookingId).toBeUndefined();
    expect(applyInfringementRecoveryCharge).not.toHaveBeenCalled();
  });

  test("does not double-create/charge when the sync already created the Infringement", async () => {
    const prisma = makePrisma();
    prisma.infringement.findUnique.mockResolvedValue({ id: "inf_existing" });
    const caller = linktRouter.createCaller(managerCtx(prisma));

    const res = await caller.resolveUnmatched({ id: "row_1", vehicleId: "veh_1", bookingId: "bk_1" });

    expect(res).toEqual({ infringementId: "inf_existing" });
    expect(prisma.infringement.create).not.toHaveBeenCalled();
    expect(applyInfringementRecoveryCharge).not.toHaveBeenCalled();
    expect(prisma.linktUnmatchedRow.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ resolvedAction: "AUTO_MATCHED" }) }),
    );
  });

  test("conflicts when the row was already resolved", async () => {
    const prisma = makePrisma();
    prisma.linktUnmatchedRow.findUnique.mockResolvedValue({
      ...ROW,
      resolvedAt: new Date("2026-06-16T00:00:00Z"),
    });
    const caller = linktRouter.createCaller(managerCtx(prisma));
    await expect(
      caller.resolveUnmatched({ id: "row_1", vehicleId: "veh_1", bookingId: "bk_1" }),
    ).rejects.toThrow(/already been resolved/);
  });

  test("dismissUnmatched marks the row DISMISSED", async () => {
    const prisma = makePrisma({
      linktUnmatchedRow: {
        findUnique: vi.fn().mockResolvedValue({ id: "row_1", resolvedAt: null }),
        update: vi.fn().mockResolvedValue({ id: "row_1" }),
      },
    });
    const caller = linktRouter.createCaller(managerCtx(prisma));
    await caller.dismissUnmatched({ id: "row_1" });
    expect(prisma.linktUnmatchedRow.update as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ resolvedAction: "DISMISSED" }) }),
    );
  });
});
