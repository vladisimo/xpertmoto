import { describe, expect, it, vi } from "vitest";
import { returnRouter } from "../../../../src/server/trpc/router/return";

/**
 * Smoke tests for the return router — enough to catch regressions in the
 * authorization chain and wiring of the customer-portal read procedure.
 */

type Caller = ReturnType<typeof returnRouter.createCaller>;

function makeCtx(overrides: {
  userId?: string;
  role?: "CUSTOMER" | "STAFF" | "MANAGER" | "ADMIN" | "SUPER_ADMIN";
  assessments?: unknown[];
  assessment?: unknown;
} = {}) {
  const prisma = {
    returnAssessment: {
      findUnique: vi.fn().mockResolvedValue(overrides.assessment ?? null),
      findMany: vi.fn().mockResolvedValue(overrides.assessments ?? []),
    },
  };
  const user = {
    id: overrides.userId ?? "cust1",
    role: overrides.role ?? "CUSTOMER",
  };
  return {
    prisma,
    // Role for staffProcedure gates comes from session.user.role.
    session: { user },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    reqId: "r1",
  } as unknown as Parameters<Caller["forCustomer"]>[0];
}

describe("return.forCustomer", () => {
  it("returns an empty array for non-customer roles", async () => {
    const ctx = makeCtx({ role: "STAFF" });
    const c = returnRouter.createCaller(ctx as never);
    const out = await c.forCustomer();
    expect(out).toEqual([]);
  });

  it("fetches the customer's own SIGNED / FINALISED assessments", async () => {
    const fake = [{ id: "ra1", status: "SIGNED" }];
    const ctx = makeCtx({ assessments: fake });
    const c = returnRouter.createCaller(ctx as never);
    const out = await c.forCustomer();
    expect(out).toEqual(fake);
  });
});

describe("return.byBooking", () => {
  it("returns null when no assessment exists for the booking", async () => {
    const ctx = makeCtx({ role: "STAFF", userId: "staff1" });
    const c = returnRouter.createCaller(ctx as never);
    const out = await c.byBooking({ bookingId: "b1" });
    expect(out).toBeNull();
  });
});
