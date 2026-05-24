import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";

// Stub heavy service deps so importing the router stays cheap; activityLog
// only touches prisma.auditLog.findMany.
vi.mock("@/lib/stripe", () => ({ refundCharge: vi.fn() }));
vi.mock("@/server/services/audit", () => ({
  captureBookingId: vi.fn(),
  captureCustomerId: vi.fn(),
  readCapturedBookingId: vi.fn(),
  readCapturedCustomerId: vi.fn(),
  skipAutoAudit: vi.fn(),
  writeAudit: vi.fn().mockResolvedValue(undefined),
  writeAuditAsync: vi.fn(),
  writeCustomerAuditAsync: vi.fn(),
}));

import { staffBookingRouter } from "@/server/trpc/router/staff-booking";

type Caller = ReturnType<typeof staffBookingRouter.createCaller>;

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
  return staffBookingRouter.createCaller(ctx as never);
}

// where.AND = [ buildAuditWhere(input), { entity: "Booking", entityId } ]
function getBookingScope(where: Record<string, unknown>): Record<string, unknown> {
  const and = where.AND as Array<Record<string, unknown>>;
  return and[1]!;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("staffBooking.activityLog", () => {
  it("scopes rows to entity='Booking' + entityId=bookingId", async () => {
    const { ctx, findMany } = buildCtx([]);
    await caller(ctx).activityLog({ bookingId: "bk-1" });
    const where = findMany.mock.calls[0]![0].where;
    expect(getBookingScope(where)).toEqual({ entity: "Booking", entityId: "bk-1" });
  });

  it("ignores a spoofed entity filter in input", async () => {
    const { ctx, findMany } = buildCtx([]);
    await caller(ctx).activityLog({ bookingId: "bk-1", entity: "User" } as never);
    const where = findMany.mock.calls[0]![0].where;
    expect(getBookingScope(where)).toEqual({ entity: "Booking", entityId: "bk-1" });
  });

  it("orders desc by (timestamp, id) and asks for take+1 rows", async () => {
    const { ctx, findMany } = buildCtx([]);
    await caller(ctx).activityLog({ bookingId: "bk-1", take: 25 });
    const args = findMany.mock.calls[0]![0];
    expect(args.orderBy).toEqual([{ timestamp: "desc" }, { id: "desc" }]);
    expect(args.take).toBe(26);
    expect(args.include).toEqual({
      user: { select: { id: true, firstName: true, lastName: true, email: true } },
    });
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
    const res = await caller(ctx).activityLog({ bookingId: "bk-1", take: 2 });
    expect(res.rows).toHaveLength(2);
    expect(res.nextCursor).toEqual({ timestamp: ts2, id: "b" });
  });

  it("returns nextCursor=null when fewer rows than requested", async () => {
    const { ctx } = buildCtx([{ id: "a", timestamp: new Date() }]);
    const res = await caller(ctx).activityLog({ bookingId: "bk-1", take: 50 });
    expect(res.nextCursor).toBeNull();
  });

  it("forwards cursor, status, and action filters into the where builder", async () => {
    const ts = new Date("2026-04-19T00:00:00Z");
    const { ctx, findMany } = buildCtx([]);
    await caller(ctx).activityLog({
      bookingId: "bk-1",
      cursor: { timestamp: ts, id: "row-50" },
      status: "FAILURE",
      action: "payment",
    });
    const where = findMany.mock.calls[0]![0].where;
    const filterLeg = (where.AND as Array<Record<string, unknown>>)[0]!;
    expect(filterLeg.status).toBe("FAILURE");
    expect(filterLeg.action).toEqual({ contains: "payment", mode: "insensitive" });
    expect(filterLeg.OR).toEqual([
      { timestamp: { lt: ts } },
      { timestamp: ts, id: { lt: "row-50" } },
    ]);
  });

  it("rejects non-staff callers", async () => {
    const { ctx } = buildCtx([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nonStaff = { ...(ctx as any) } as any;
    nonStaff.user = { id: "customer1", role: "CUSTOMER" };
    nonStaff.session = { user: { id: "customer1", role: "CUSTOMER" } };
    await expect(
      caller(nonStaff).activityLog({ bookingId: "bk-1" }),
    ).rejects.toBeInstanceOf(TRPCError);
  });
});
