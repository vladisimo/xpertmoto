import { describe, expect, test, vi } from "vitest";
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
