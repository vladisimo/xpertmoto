import { describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import type { PrismaClient } from "@prisma/client";
import {
  assertBookingDepotAccess,
  assertDepotAccess,
  scopedDepotFilter,
} from "../../../../src/server/trpc/router/_depot-scope";

const staffAtDepot = { role: "STAFF" as const, depotId: "depot-a" };
const staffNoDepot = { role: "STAFF" as const, depotId: null };
const manager = { role: "MANAGER" as const, depotId: "depot-a" };

describe("scopedDepotFilter", () => {
  it("pins STAFF to their own depot regardless of the requested filter", () => {
    expect(scopedDepotFilter(staffAtDepot, "depot-b")).toBe("depot-a");
    expect(scopedDepotFilter(staffAtDepot)).toBe("depot-a");
  });

  it("leaves STAFF without a depot assignment unrestricted", () => {
    expect(scopedDepotFilter(staffNoDepot, "depot-b")).toBeUndefined();
  });

  it("passes the requested filter through for MANAGER+", () => {
    expect(scopedDepotFilter(manager, "depot-b")).toBe("depot-b");
    expect(scopedDepotFilter(manager)).toBeUndefined();
  });
});

describe("assertDepotAccess", () => {
  it("throws FORBIDDEN when depot-assigned STAFF touch another depot's record", () => {
    expect(() => assertDepotAccess(staffAtDepot, "depot-b")).toThrow(TRPCError);
    try {
      assertDepotAccess(staffAtDepot, "depot-b");
    } catch (err) {
      expect((err as TRPCError).code).toBe("FORBIDDEN");
    }
  });

  it("allows STAFF to touch records in their own depot", () => {
    expect(() => assertDepotAccess(staffAtDepot, "depot-a")).not.toThrow();
  });

  it("allows records without a depot, STAFF without a depot, and MANAGER+", () => {
    expect(() => assertDepotAccess(staffAtDepot, null)).not.toThrow();
    expect(() => assertDepotAccess(staffNoDepot, "depot-b")).not.toThrow();
    expect(() => assertDepotAccess(manager, "depot-b")).not.toThrow();
  });
});

describe("assertBookingDepotAccess", () => {
  function makeCtx(user: { role: "STAFF" | "MANAGER"; depotId: string | null }, bookingDepotId: string | null) {
    const findUnique = vi.fn(async () =>
      bookingDepotId === null ? null : { depotId: bookingDepotId },
    );
    const ctx = {
      prisma: { booking: { findUnique } } as unknown as PrismaClient,
      user,
    };
    return { ctx, findUnique };
  }

  it("throws FORBIDDEN for a cross-depot booking", async () => {
    const { ctx } = makeCtx(staffAtDepot, "depot-b");
    await expect(assertBookingDepotAccess(ctx, "b1")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("passes for a same-depot booking", async () => {
    const { ctx } = makeCtx(staffAtDepot, "depot-a");
    await expect(assertBookingDepotAccess(ctx, "b1")).resolves.toBeUndefined();
  });

  it("falls through silently when the booking does not exist (NOT_FOUND stays with the caller)", async () => {
    const { ctx } = makeCtx(staffAtDepot, null);
    await expect(assertBookingDepotAccess(ctx, "missing")).resolves.toBeUndefined();
  });

  it("skips the lookup entirely for MANAGER+ and unassigned STAFF", async () => {
    const m = makeCtx(manager, "depot-b");
    await assertBookingDepotAccess(m.ctx, "b1");
    expect(m.findUnique).not.toHaveBeenCalled();

    const s = makeCtx(staffNoDepot, "depot-b");
    await assertBookingDepotAccess(s.ctx, "b1");
    expect(s.findUnique).not.toHaveBeenCalled();
  });
});
