import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { staffCustomerRouter } from "@/server/trpc/router/staff-customer";

type Caller = ReturnType<typeof staffCustomerRouter.createCaller>;

function buildCtx(rows: unknown[] = []) {
  const findMany = vi.fn().mockResolvedValue(rows);
  return {
    findMany,
    ctx: {
      prisma: { auditLog: { findMany } },
      user: { id: "staff1", role: "STAFF" as const },
      session: { user: { id: "staff1", role: "STAFF" } },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      reqId: "r1",
    } as unknown as Parameters<Caller["activityLog"]>[0],
  };
}

function caller(ctx: unknown): Caller {
  return staffCustomerRouter.createCaller(ctx as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

// The resolver composes the where clause as:
//   where.AND = [
//     buildAuditWhere(input),
//     {
//       OR: [
//         { entity: "User", entityId: customerId },
//         { userId: customerId, category: { in: ["AUTH", "PAGE_VIEW"] } },
//       ],
//     },
//   ]
// The first AND-entry holds the filter-builder output (timestamp, status,
// action, cursor); the second scopes the row to the target customer via
// either the entity tag or an AUTH/PAGE_VIEW row attributed to them.
function getCustomerScope(where: Record<string, unknown>): {
  OR: Array<Record<string, unknown>>;
} {
  const and = where.AND as Array<Record<string, unknown>>;
  return and[1] as { OR: Array<Record<string, unknown>> };
}

describe("staffCustomer.activityLog", () => {
  it("scopes rows to entity='User'+entityId OR userId in AUTH/PAGE_VIEW", async () => {
    const { ctx, findMany } = buildCtx([]);
    await caller(ctx).activityLog({ customerId: "cust-1" });
    const where = findMany.mock.calls[0]![0].where;
    const scope = getCustomerScope(where);
    expect(scope.OR).toEqual([
      { entity: "User", entityId: "cust-1" },
      { userId: "cust-1", category: { in: ["AUTH", "PAGE_VIEW"] } },
    ]);
  });

  it("ignores a spoofed entity filter in input", async () => {
    const { ctx, findMany } = buildCtx([]);
    // `entity` is not in the procedure's input schema, so it's stripped by
    // Zod before reaching the resolver. The customer-scope branch still
    // pins entity='User'.
    await caller(ctx).activityLog({
      customerId: "cust-1",
      entity: "Booking",
    } as never);
    const where = findMany.mock.calls[0]![0].where;
    const scope = getCustomerScope(where);
    expect(scope.OR[0]).toEqual({ entity: "User", entityId: "cust-1" });
  });

  it("orders desc by (timestamp, id) and asks for take+1 rows for pagination", async () => {
    const { ctx, findMany } = buildCtx([]);
    await caller(ctx).activityLog({ customerId: "cust-1", take: 25 });
    const args = findMany.mock.calls[0]![0];
    expect(args.orderBy).toEqual([{ timestamp: "desc" }, { id: "desc" }]);
    expect(args.take).toBe(26);
  });

  it("returns nextCursor when more rows exist than requested", async () => {
    const ts1 = new Date("2026-04-19T10:00:00Z");
    const ts2 = new Date("2026-04-19T09:00:00Z");
    const ts3 = new Date("2026-04-19T08:00:00Z");
    const { ctx } = buildCtx([
      { id: "a", timestamp: ts1 },
      { id: "b", timestamp: ts2 },
      { id: "c", timestamp: ts3 },
    ]);
    const res = await caller(ctx).activityLog({ customerId: "cust-1", take: 2 });
    expect(res.rows).toHaveLength(2);
    expect(res.nextCursor).toEqual({ timestamp: ts2, id: "b" });
  });

  it("returns nextCursor=null when fewer rows than requested", async () => {
    const { ctx } = buildCtx([{ id: "a", timestamp: new Date() }]);
    const res = await caller(ctx).activityLog({ customerId: "cust-1", take: 50 });
    expect(res.nextCursor).toBeNull();
  });

  it("forwards cursor, status, and action filters into the where builder", async () => {
    const ts = new Date("2026-04-19T00:00:00Z");
    const { ctx, findMany } = buildCtx([]);
    await caller(ctx).activityLog({
      customerId: "cust-1",
      cursor: { timestamp: ts, id: "row-50" },
      status: "FAILURE",
      action: "booking",
    });
    const where = findMany.mock.calls[0]![0].where;
    const filterLeg = (where.AND as Array<Record<string, unknown>>)[0];
    expect(filterLeg!.status).toBe("FAILURE");
    expect(filterLeg!.action).toEqual({ contains: "booking", mode: "insensitive" });
    expect(filterLeg!.OR).toEqual([
      { timestamp: { lt: ts } },
      { timestamp: ts, id: { lt: "row-50" } },
    ]);
  });

  it("rejects non-staff callers (UNAUTHORIZED / FORBIDDEN)", async () => {
    const { ctx } = buildCtx([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nonStaff = { ...(ctx as any) } as any;
    nonStaff.user = { id: "customer1", role: "CUSTOMER" };
    nonStaff.session = { user: { id: "customer1", role: "CUSTOMER" } };
    await expect(
      caller(nonStaff).activityLog({ customerId: "cust-1" }),
    ).rejects.toBeInstanceOf(TRPCError);
  });
});
