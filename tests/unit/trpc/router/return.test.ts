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

describe("return.upsertDamageCharge — issue linkage", () => {
  function staffCtx(prisma: Record<string, unknown>) {
    const user = { id: "staff1", role: "STAFF" as const, depotId: "depot-a" };
    return {
      prisma,
      user,
      session: { user },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      reqId: "r1",
      _skipAudit: true,
    } as unknown as Parameters<Caller["upsertDamageCharge"]>[0];
  }

  it("links the charge to its inspection issue and derives the evidence photo", async () => {
    const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "dc1", ...data }));
    const prisma = {
      returnAssessment: {
        findUniqueOrThrow: vi.fn(async () => ({
          id: "ra1",
          status: "DRAFT",
          inspectionId: "insp1",
          bookingId: "b1",
          booking: { vehicleId: "v1" },
          inspection: { id: "insp1" },
        })),
      },
      inspectionIssue: {
        findUnique: vi.fn(async () => ({
          inspectionId: "insp1",
          inspectionPhoto: { url: "https://cdn/x.jpg" },
          inspection: { bookingId: "b1", purpose: "CHECK_IN", status: "COMPLETED" },
        })),
      },
      damageCharge: { create },
    };
    const c = returnRouter.createCaller(staffCtx(prisma) as never);
    await c.upsertDamageCharge({
      assessmentId: "ra1",
      inspectionIssueId: "iss1",
      description: "Broken mirror",
      severity: "MAJOR",
      resolution: "STANDARD",
      amount: 120,
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]?.[0].data).toMatchObject({
      inspectionIssueId: "iss1",
      photoUrls: ["https://cdn/x.jpg"],
    });
  });

  it("rejects an issue that belongs to a different inspection", async () => {
    const create = vi.fn();
    const prisma = {
      returnAssessment: {
        findUniqueOrThrow: vi.fn(async () => ({
          id: "ra1",
          status: "DRAFT",
          inspectionId: "insp1",
          bookingId: "b1",
          booking: { vehicleId: "v1" },
          inspection: { id: "insp1" },
        })),
      },
      inspectionIssue: {
        findUnique: vi.fn(async () => ({
          inspectionId: "OTHER",
          inspectionPhoto: null,
          inspection: { bookingId: "b1", purpose: "CHECK_IN", status: "COMPLETED" },
        })),
      },
      damageCharge: { create },
    };
    const c = returnRouter.createCaller(staffCtx(prisma) as never);
    await expect(
      c.upsertDamageCharge({
        assessmentId: "ra1",
        inspectionIssueId: "issX",
        description: "x",
        severity: "MINOR",
        resolution: "STANDARD",
        amount: 10,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(create).not.toHaveBeenCalled();
  });

  it("accepts an issue from a COMPLETED SWAP_OUT inspection on the same booking (PR7)", async () => {
    const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "dc2", ...data }));
    const prisma = {
      returnAssessment: {
        findUniqueOrThrow: vi.fn(async () => ({
          id: "ra1",
          status: "DRAFT",
          inspectionId: "insp-return",
          bookingId: "b1",
          booking: { vehicleId: "v1" },
          inspection: { id: "insp-return" },
        })),
      },
      inspectionIssue: {
        findUnique: vi.fn(async () => ({
          inspectionId: "insp-swapout",
          inspectionPhoto: null,
          inspection: { bookingId: "b1", purpose: "SWAP_OUT", status: "COMPLETED" },
        })),
      },
      damageCharge: { create },
    };
    const c = returnRouter.createCaller(staffCtx(prisma) as never);
    await c.upsertDamageCharge({
      assessmentId: "ra1",
      inspectionIssueId: "iss-swap",
      description: "Scrape recorded at swap-out",
      severity: "MODERATE",
      resolution: "STANDARD",
      amount: 80,
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]?.[0].data).toMatchObject({
      inspectionIssueId: "iss-swap",
      amount: 80,
    });
  });

  it("still rejects a SWAP_OUT issue that belongs to a different booking", async () => {
    const create = vi.fn();
    const prisma = {
      returnAssessment: {
        findUniqueOrThrow: vi.fn(async () => ({
          id: "ra1",
          status: "DRAFT",
          inspectionId: "insp-return",
          bookingId: "b1",
          booking: { vehicleId: "v1" },
          inspection: { id: "insp-return" },
        })),
      },
      inspectionIssue: {
        findUnique: vi.fn(async () => ({
          inspectionId: "insp-foreign",
          inspectionPhoto: null,
          inspection: { bookingId: "b-OTHER", purpose: "SWAP_OUT", status: "COMPLETED" },
        })),
      },
      damageCharge: { create },
    };
    const c = returnRouter.createCaller(staffCtx(prisma) as never);
    await expect(
      c.upsertDamageCharge({
        assessmentId: "ra1",
        inspectionIssueId: "iss-foreign",
        description: "x",
        severity: "MINOR",
        resolution: "STANDARD",
        amount: 10,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(create).not.toHaveBeenCalled();
  });
});
