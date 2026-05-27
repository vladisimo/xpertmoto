import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { globalSearchRouter } from "../../../../src/server/trpc/router/global-search";

type Caller = ReturnType<typeof globalSearchRouter.createCaller>;

type Role = "CUSTOMER" | "STAFF" | "MANAGER" | "ADMIN" | "SUPER_ADMIN";

/**
 * Builds a mock context with one row pre-seeded in each searchable model so
 * the happy-path resolver returns a populated group per entity type.
 */
function makeCtx(opts: { role?: Role | null } = {}) {
  const { role = "STAFF" } = opts;

  const booking = {
    findMany: vi.fn().mockResolvedValue([
      {
        id: "b1",
        bookingReference: "XM-10432",
        status: "CONFIRMED",
        pickupDateTime: new Date("2026-05-25T00:00:00Z"),
        returnDateTime: new Date("2026-05-28T00:00:00Z"),
        customer: { firstName: "Jane", lastName: "Smith", email: "jane@x.com" },
        vehicle: { make: "Honda", model: "PCX", rego: "1ABC" },
      },
    ]),
  };
  const vehicle = {
    findMany: vi.fn().mockResolvedValue([
      {
        id: "v1",
        internalCode: "XM-V-1",
        rego: "1ABC",
        make: "Honda",
        model: "PCX",
        year: 2024,
        status: "AVAILABLE",
      },
    ]),
  };
  const user = {
    findMany: vi.fn().mockResolvedValue([
      {
        id: "u1",
        firstName: "Jane",
        lastName: "Smith",
        email: "jane@x.com",
        phone: "0400000000",
      },
    ]),
  };
  const payment = {
    findMany: vi.fn().mockResolvedValue([
      {
        id: "p1",
        receiptNumber: "RCPT-1",
        reference: "ref-1",
        amount: new Prisma.Decimal("12.5"),
        booking: { id: "b1", bookingReference: "XM-10432" },
      },
    ]),
  };
  const invoice = {
    findMany: vi.fn().mockResolvedValue([
      {
        id: "i1",
        invoiceNumber: "INV-1",
        status: "PAID",
        totalAmount: new Prisma.Decimal("99"),
        issuedAt: new Date("2026-05-26T00:00:00Z"),
        booking: { id: "b1", bookingReference: "XM-10432" },
      },
    ]),
  };

  const prisma = { booking, vehicle, user, payment, invoice };
  const ctx = {
    prisma,
    session: role ? { user: { id: "staff1", role } } : null,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    reqId: "r1",
  } as unknown as Parameters<Caller["search"]>[0];

  return { ctx, prisma };
}

describe("globalSearch.search", () => {
  it("returns grouped, display-ready results with the right hrefs", async () => {
    const { ctx } = makeCtx();
    const caller = globalSearchRouter.createCaller(ctx as never);
    const res = await caller.search({ query: "honda" });

    expect(res.bookings[0]).toMatchObject({
      href: "/staff/bookings/b1",
      reference: "XM-10432",
      status: "CONFIRMED",
      customerName: "Jane Smith",
      vehicleLabel: "Honda PCX · 1ABC",
    });
    expect(res.vehicles[0]).toMatchObject({
      href: "/staff/fleet/vehicles/v1",
      label: "Honda PCX (2024)",
      rego: "1ABC",
    });
    expect(res.customers[0]).toMatchObject({
      href: "/staff/customers/u1",
      name: "Jane Smith",
      email: "jane@x.com",
    });
    // Receipts and invoices deep-link to their parent booking.
    expect(res.receipts[0]).toMatchObject({
      href: "/staff/bookings/b1",
      receiptNumber: "RCPT-1",
      amount: "12.50",
      bookingReference: "XM-10432",
    });
    expect(res.invoices[0]).toMatchObject({
      href: "/staff/bookings/b1",
      invoiceNumber: "INV-1",
      totalAmount: "99.00",
      bookingReference: "XM-10432",
    });
  });

  it("searches bookings case-insensitively across reference, customer and rego", async () => {
    const { ctx, prisma } = makeCtx();
    const caller = globalSearchRouter.createCaller(ctx as never);
    await caller.search({ query: "honda" });

    const where = prisma.booking.findMany.mock.calls[0]?.[0]?.where;
    expect(where.OR).toEqual(
      expect.arrayContaining([
        { bookingReference: { contains: "honda", mode: "insensitive" } },
        { vehicle: { rego: { contains: "honda", mode: "insensitive" } } },
      ]),
    );
    // Soft-deleted vehicles/payments/invoices are excluded.
    expect(prisma.vehicle.findMany.mock.calls[0]?.[0]?.where.deletedAt).toBeNull();
    expect(prisma.payment.findMany.mock.calls[0]?.[0]?.where.deletedAt).toBeNull();
  });

  it("only includes customers (profile-based) and receipts/invoices with a parent booking", async () => {
    const { ctx, prisma } = makeCtx();
    const caller = globalSearchRouter.createCaller(ctx as never);
    await caller.search({ query: "smith" });

    // Customer query is scoped to directory members (has a CustomerProfile).
    const userWhere = prisma.user.findMany.mock.calls[0]?.[0]?.where;
    expect(userWhere.AND[0]).toEqual({ customerProfile: { isNot: null } });
    // Receipts/invoices require a booking to deep-link to.
    expect(prisma.payment.findMany.mock.calls[0]?.[0]?.where.bookingId).toEqual({ not: null });
    expect(prisma.invoice.findMany.mock.calls[0]?.[0]?.where.bookingId).toEqual({ not: null });
  });

  it("rejects a query shorter than 2 characters", async () => {
    const { ctx } = makeCtx();
    const caller = globalSearchRouter.createCaller(ctx as never);
    await expect(caller.search({ query: "a" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("rejects an anonymous caller", async () => {
    const { ctx } = makeCtx({ role: null });
    const caller = globalSearchRouter.createCaller(ctx as never);
    await expect(caller.search({ query: "honda" })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("rejects a customer (non-staff) caller", async () => {
    const { ctx } = makeCtx({ role: "CUSTOMER" });
    const caller = globalSearchRouter.createCaller(ctx as never);
    await expect(caller.search({ query: "honda" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});
