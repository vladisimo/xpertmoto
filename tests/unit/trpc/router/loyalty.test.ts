import { beforeEach, describe, expect, it, vi } from "vitest";
import { loyaltyRouter } from "@/server/trpc/router/loyalty";

/**
 * Mirror test for src/server/trpc/router/loyalty.ts.
 *
 * The loyalty *service* is deliberately NOT mocked: points convert to dollars
 * (100 pts = A$1), so the specs drive the real award/burn logic against a
 * prisma stub and assert both the returned numbers and the exact ledger /
 * profile payloads that reach the DB.
 */

type Row = Record<string, unknown>;

interface Over {
  anon?: boolean;
  role?: "CUSTOMER" | "STAFF" | "MANAGER" | "ADMIN" | "SUPER_ADMIN";
  /** customerProfile.findUnique — myBalance */
  profile?: Row | null;
  /** customerProfile.findUniqueOrThrow — burn balance check */
  burnProfile?: Row;
  /** what customerProfile.update resolves to (drives the tier re-check) */
  updatedProfile?: Row;
  ledger?: Row[];
  /** loyaltyLedger.findFirst — award dedupe probe */
  existingLedger?: Row | null;
}

function makeCtx(over: Over = {}) {
  const profileFindUnique = vi
    .fn()
    .mockResolvedValue("profile" in over ? over.profile : null);
  const profileFindUniqueOrThrow = vi
    .fn()
    .mockResolvedValue(over.burnProfile ?? { userId: "u1", loyaltyPoints: 0, lifetimePoints: 0, loyaltyTier: "SILVER" });
  const profileUpdate = vi
    .fn()
    .mockResolvedValue(over.updatedProfile ?? { userId: "u1", lifetimePoints: 0, loyaltyTier: "SILVER" });

  const ledgerCreate = vi
    .fn()
    .mockImplementation(({ data }: { data: Row }) => Promise.resolve({ id: "led1", ...data }));
  const ledgerFindFirst = vi.fn().mockResolvedValue(over.existingLedger ?? null);
  const ledgerFindMany = vi.fn().mockResolvedValue(over.ledger ?? []);

  const prisma: Row = {
    customerProfile: {
      findUnique: profileFindUnique,
      findUniqueOrThrow: profileFindUniqueOrThrow,
      update: profileUpdate,
    },
    loyaltyLedger: { create: ledgerCreate, findFirst: ledgerFindFirst, findMany: ledgerFindMany },
    auditLog: { create: vi.fn().mockResolvedValue({ id: "a1" }) },
  };
  prisma.$transaction = vi
    .fn()
    .mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma));

  const sessionUser = { id: "u1", role: over.role ?? "CUSTOMER", email: "ada@example.com" };
  const ctx = over.anon
    ? { prisma, user: null, session: null, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, reqId: "r1" }
    : {
        prisma,
        user: sessionUser,
        session: { user: sessionUser },
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        reqId: "r1",
      };

  return {
    ctx,
    caller: loyaltyRouter.createCaller(ctx as never),
    profileFindUnique,
    profileFindUniqueOrThrow,
    profileUpdate,
    ledgerCreate,
    ledgerFindMany,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("loyalty.myBalance", () => {
  it("returns the SILVER balance with the exact gap to GOLD and the burn rate", async () => {
    const { caller, profileFindUnique } = makeCtx({
      profile: { loyaltyPoints: 150, lifetimePoints: 150, loyaltyTier: "SILVER" },
    });

    const result = await caller.myBalance();

    expect(result).toEqual({
      points: 150,
      lifetimePoints: 150,
      tier: "SILVER",
      nextTier: "GOLD",
      pointsToNextTier: 1850, // 2000 threshold − 150 lifetime
      centsPerPoint: 1, // 100 pts = A$1
    });
    expect(profileFindUnique).toHaveBeenCalledWith({
      where: { userId: "u1" },
      select: { loyaltyPoints: true, lifetimePoints: true, loyaltyTier: true },
    });
  });

  it("counts a GOLD member's gap against the 10,000-point PLATINUM threshold", async () => {
    const { caller } = makeCtx({
      profile: { loyaltyPoints: 900, lifetimePoints: 2400, loyaltyTier: "GOLD" },
    });

    const result = await caller.myBalance();

    expect(result).toMatchObject({ nextTier: "PLATINUM", pointsToNextTier: 7600 });
  });

  it("clamps the gap at zero when lifetime points already exceed the next threshold", async () => {
    const { caller } = makeCtx({
      profile: { loyaltyPoints: 0, lifetimePoints: 12000, loyaltyTier: "GOLD" },
    });

    const result = await caller.myBalance();

    expect(result).toMatchObject({ nextTier: "PLATINUM", pointsToNextTier: 0 });
  });

  it("has no next tier once PLATINUM", async () => {
    const { caller } = makeCtx({
      profile: { loyaltyPoints: 5000, lifetimePoints: 15000, loyaltyTier: "PLATINUM" },
    });

    const result = await caller.myBalance();

    expect(result).toMatchObject({ nextTier: null, pointsToNextTier: null });
  });

  it("returns null when the user has no customer profile", async () => {
    const { caller } = makeCtx({ profile: null });

    await expect(caller.myBalance()).resolves.toBeNull();
  });

  it("rejects an anonymous caller (protectedProcedure)", async () => {
    const { caller } = makeCtx({ anon: true });

    await expect(caller.myBalance()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("loyalty.myLedger", () => {
  it("reads only the caller's own ledger, newest first, defaulting to 50 rows", async () => {
    const { caller, ledgerFindMany } = makeCtx({
      ledger: [{ id: "led1", direction: "EARN", points: 120, booking: { bookingReference: "BK-1" } }],
    });

    const result = await caller.myLedger();

    expect(result).toHaveLength(1);
    expect(ledgerFindMany).toHaveBeenCalledWith({
      where: { userId: "u1" },
      include: { booking: { select: { bookingReference: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  });

  it("honours an explicit page size", async () => {
    const { caller, ledgerFindMany } = makeCtx();

    await caller.myLedger({ take: 25 });

    expect(ledgerFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 25 }));
  });

  it("rejects a page size above the 200 cap (Zod bound)", async () => {
    const { caller, ledgerFindMany } = makeCtx();

    await expect(caller.myLedger({ take: 500 })).rejects.toThrow();
    expect(ledgerFindMany).not.toHaveBeenCalled();
  });

  it("rejects an anonymous caller (protectedProcedure)", async () => {
    const { caller, ledgerFindMany } = makeCtx({ anon: true });

    await expect(caller.myLedger()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(ledgerFindMany).not.toHaveBeenCalled();
  });
});

describe("loyalty.redeem", () => {
  it("burns points at 100 pts = A$1 and writes the BURN ledger row for the session user", async () => {
    const { caller, ledgerCreate, profileUpdate, profileFindUniqueOrThrow } = makeCtx({
      burnProfile: { userId: "u1", loyaltyPoints: 500, lifetimePoints: 500, loyaltyTier: "SILVER" },
    });

    const credit = await caller.redeem({ bookingId: "bk1", points: 250 });

    expect(credit).toBe(2.5);
    // The balance read is keyed to the session user — no caller-supplied userId.
    expect(profileFindUniqueOrThrow).toHaveBeenCalledWith({ where: { userId: "u1" } });
    expect(ledgerCreate).toHaveBeenCalledTimes(1);
    expect(ledgerCreate).toHaveBeenCalledWith({
      data: {
        userId: "u1",
        bookingId: "bk1",
        direction: "BURN",
        points: 250,
        reason: "Burn 250pts on booking",
      },
    });
    expect(profileUpdate).toHaveBeenCalledWith({
      where: { userId: "u1" },
      data: { loyaltyPoints: { decrement: 250 } },
    });
  });

  it("converts an uneven burn to exact cents", async () => {
    const { caller } = makeCtx({
      burnProfile: { userId: "u1", loyaltyPoints: 1000, lifetimePoints: 1000, loyaltyTier: "SILVER" },
    });

    await expect(caller.redeem({ bookingId: "bk1", points: 333 })).resolves.toBe(3.33);
  });

  it("refuses to overdraw the balance and writes nothing", async () => {
    const { caller, ledgerCreate, profileUpdate } = makeCtx({
      burnProfile: { userId: "u1", loyaltyPoints: 100, lifetimePoints: 100, loyaltyTier: "SILVER" },
    });

    await expect(caller.redeem({ bookingId: "bk1", points: 250 })).rejects.toThrow(
      /Insufficient loyalty points/,
    );
    expect(ledgerCreate).not.toHaveBeenCalled();
    expect(profileUpdate).not.toHaveBeenCalled();
  });

  it("rejects a zero or fractional burn (Zod bound)", async () => {
    const { caller, ledgerCreate } = makeCtx({
      burnProfile: { userId: "u1", loyaltyPoints: 500, lifetimePoints: 500, loyaltyTier: "SILVER" },
    });

    await expect(caller.redeem({ bookingId: "bk1", points: 0 })).rejects.toThrow();
    await expect(caller.redeem({ bookingId: "bk1", points: 12.5 })).rejects.toThrow();
    expect(ledgerCreate).not.toHaveBeenCalled();
  });

  it("rejects an anonymous caller (protectedProcedure)", async () => {
    const { caller, ledgerCreate } = makeCtx({ anon: true });

    await expect(caller.redeem({ bookingId: "bk1", points: 100 })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(ledgerCreate).not.toHaveBeenCalled();
  });
});

describe("loyalty.adminAward", () => {
  it("awards to the target user with a prefixed reason and bumps both counters", async () => {
    const { caller, ledgerCreate, profileUpdate } = makeCtx({
      role: "ADMIN",
      updatedProfile: { userId: "cust1", lifetimePoints: 700, loyaltyTier: "SILVER" },
    });

    const awarded = await caller.adminAward({ userId: "cust1", points: 500, reason: "Goodwill" });

    expect(awarded).toBe(500);
    expect(ledgerCreate).toHaveBeenCalledWith({
      data: {
        userId: "cust1",
        bookingId: undefined,
        direction: "EARN",
        points: 500,
        reason: "Admin award: Goodwill",
        expiresAt: undefined,
      },
    });
    // No tier change at 700 lifetime points — a single profile write.
    expect(profileUpdate).toHaveBeenCalledTimes(1);
    expect(profileUpdate).toHaveBeenCalledWith({
      where: { userId: "cust1" },
      data: { loyaltyPoints: { increment: 500 }, lifetimePoints: { increment: 500 } },
    });
  });

  it("promotes the tier when the award crosses a lifetime threshold", async () => {
    const { caller, profileUpdate } = makeCtx({
      role: "ADMIN",
      updatedProfile: { userId: "cust1", lifetimePoints: 2500, loyaltyTier: "SILVER" },
    });

    await caller.adminAward({ userId: "cust1", points: 500, reason: "Service recovery" });

    expect(profileUpdate).toHaveBeenCalledTimes(2);
    expect(profileUpdate).toHaveBeenLastCalledWith({
      where: { userId: "cust1" },
      data: { loyaltyTier: "GOLD" },
    });
  });

  it("rejects a STAFF caller (adminProcedure)", async () => {
    const { caller, ledgerCreate } = makeCtx({ role: "STAFF" });

    await expect(
      caller.adminAward({ userId: "cust1", points: 500, reason: "Goodwill" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(ledgerCreate).not.toHaveBeenCalled();
  });

  it("rejects a customer awarding themselves points (adminProcedure)", async () => {
    const { caller, ledgerCreate } = makeCtx({ role: "CUSTOMER" });

    await expect(
      caller.adminAward({ userId: "u1", points: 10000, reason: "Free points" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(ledgerCreate).not.toHaveBeenCalled();
  });

  it("rejects an anonymous caller (adminProcedure)", async () => {
    const { caller } = makeCtx({ anon: true });

    await expect(
      caller.adminAward({ userId: "cust1", points: 500, reason: "Goodwill" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects a non-positive award and a too-short reason (Zod bounds)", async () => {
    const { caller, ledgerCreate } = makeCtx({ role: "ADMIN" });

    await expect(caller.adminAward({ userId: "cust1", points: 0, reason: "Goodwill" })).rejects.toThrow();
    await expect(caller.adminAward({ userId: "cust1", points: 500, reason: "ok" })).rejects.toThrow();
    expect(ledgerCreate).not.toHaveBeenCalled();
  });
});
