import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { referralRouter } from "@/server/trpc/router/referral";

/**
 * Mirror test for src/server/trpc/router/referral.ts.
 *
 * The referral *service* is deliberately NOT mocked: referral credits are
 * money, so the specs drive the real applyReferral/ensureReferralCode logic
 * against a prisma stub and assert the exact payloads that reach the DB.
 */

type Row = Record<string, unknown>;

interface Over {
  anon?: boolean;
  email?: string | null;
  /** prisma.user.findUniqueOrThrow — the referrer's own user row. */
  userRow?: Row | null;
  /** customerProfile.findUnique({ where: { userId } }) */
  profileByUserId?: Row | null;
  /** customerProfile.findUnique({ where: { referralCode } }) */
  profileByCode?: Row | null;
  groups?: Array<{ status: string; _count: { _all: number } }>;
  existingReferral?: Row | null;
  mine?: Row[];
}

const DEFAULT_USER: Row = {
  id: "u1",
  firstName: "Ada",
  lastName: "Lovelace",
  customerProfile: { id: "cp1", referralCode: "AL-K9P2" },
};

function makeCtx(over: Over = {}) {
  const userFindUniqueOrThrow = vi
    .fn()
    .mockResolvedValue("userRow" in over ? over.userRow : DEFAULT_USER);

  // One findUnique serves two lookups — by referral code (collision probe /
  // public lookup) and by userId (credit balance). Dispatch on the where key.
  const profileFindUnique = vi
    .fn()
    .mockImplementation(({ where }: { where: { userId?: string; referralCode?: string } }) =>
      Promise.resolve(
        where.referralCode !== undefined
          ? ("profileByCode" in over ? over.profileByCode : null)
          : ("profileByUserId" in over ? over.profileByUserId : null),
      ),
    );
  const profileUpdate = vi
    .fn()
    .mockImplementation(({ data }: { data: Row }) => Promise.resolve({ id: "cp1", ...data }));

  const referralGroupBy = vi.fn().mockResolvedValue(over.groups ?? []);
  const referralFindFirst = vi.fn().mockResolvedValue(over.existingReferral ?? null);
  const referralCreate = vi
    .fn()
    .mockImplementation(({ data }: { data: Row }) => Promise.resolve({ id: "ref1", ...data }));
  const referralFindMany = vi.fn().mockResolvedValue(over.mine ?? []);

  const prisma = {
    user: { findUniqueOrThrow: userFindUniqueOrThrow },
    customerProfile: { findUnique: profileFindUnique, update: profileUpdate },
    referral: {
      groupBy: referralGroupBy,
      findFirst: referralFindFirst,
      create: referralCreate,
      findMany: referralFindMany,
    },
    auditLog: { create: vi.fn().mockResolvedValue({ id: "a1" }) },
  };

  const sessionUser = {
    id: "u1",
    role: "CUSTOMER",
    email: "email" in over ? over.email : "ada@example.com",
  };
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
    caller: referralRouter.createCaller(ctx as never),
    userFindUniqueOrThrow,
    profileFindUnique,
    profileUpdate,
    referralGroupBy,
    referralFindFirst,
    referralCreate,
    referralFindMany,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("referral.myCode", () => {
  it("returns the existing code, the credit balance as a number and per-status counts", async () => {
    const { caller, referralGroupBy, profileUpdate } = makeCtx({
      profileByUserId: { referralCreditBalance: new Prisma.Decimal("42.50") },
      groups: [
        { status: "PENDING", _count: { _all: 2 } },
        { status: "QUALIFIED", _count: { _all: 1 } },
        { status: "PAID", _count: { _all: 3 } },
      ],
    });

    const result = await caller.myCode();

    expect(result).toEqual({
      code: "AL-K9P2",
      creditBalance: 42.5,
      referrals: { PENDING: 2, QUALIFIED: 1, PAID: 3 },
    });
    // An existing code is immutable — no re-mint.
    expect(profileUpdate).not.toHaveBeenCalled();
    // Counts are scoped to the caller's own referrals.
    expect(referralGroupBy).toHaveBeenCalledWith({
      by: ["status"],
      where: { referrerId: "u1" },
      _count: { _all: true },
    });
  });

  it("mints an initials-prefixed code on first ask and persists exactly that code", async () => {
    const { caller, profileUpdate } = makeCtx({
      userRow: { id: "u1", firstName: "Ada", lastName: "Lovelace", customerProfile: { id: "cp1", referralCode: null } },
      profileByCode: null, // no collision
      profileByUserId: { referralCreditBalance: new Prisma.Decimal(0) },
    });

    const result = await caller.myCode();

    expect(result.code).toMatch(/^AL-[A-Z2-9]{4}$/);
    expect(profileUpdate).toHaveBeenCalledTimes(1);
    expect(profileUpdate).toHaveBeenCalledWith({
      where: { userId: "u1" },
      data: { referralCode: result.code },
    });
  });

  it("reports a zero balance and no referrals when the profile row is unreadable", async () => {
    const { caller } = makeCtx({ profileByUserId: null, groups: [] });

    const result = await caller.myCode();

    expect(result.creditBalance).toBe(0);
    expect(result.referrals).toEqual({});
  });

  it("fails with PRECONDITION_FAILED when the user has no customer profile", async () => {
    const { caller } = makeCtx({
      userRow: { id: "u1", firstName: "Ada", lastName: "Lovelace", customerProfile: null },
    });

    await expect(caller.myCode()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("rejects an anonymous caller (protectedProcedure)", async () => {
    const { caller } = makeCtx({ anon: true });

    await expect(caller.myCode()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("referral.lookup", () => {
  it("resolves a code to the referrer's first name for an anonymous visitor", async () => {
    const { caller, profileFindUnique } = makeCtx({
      anon: true,
      profileByCode: { id: "cp1", user: { firstName: "Ada" } },
    });

    const result = await caller.lookup({ code: "AL-K9P2" });

    expect(result).toEqual({ referrerFirstName: "Ada", valid: true });
    expect(profileFindUnique).toHaveBeenCalledWith({
      where: { referralCode: "AL-K9P2" },
      include: { user: { select: { firstName: true } } },
    });
  });

  it("returns null for an unknown code instead of throwing", async () => {
    const { caller } = makeCtx({ anon: true, profileByCode: null });

    await expect(caller.lookup({ code: "NOPE-1" })).resolves.toBeNull();
  });

  it("rejects a code shorter than 3 characters (Zod bound)", async () => {
    const { caller, profileFindUnique } = makeCtx({ anon: true });

    await expect(caller.lookup({ code: "ab" })).rejects.toThrow();
    expect(profileFindUnique).not.toHaveBeenCalled();
  });
});

describe("referral.applyCode", () => {
  it("creates a PENDING referral bound to the session user, not to a caller-supplied id", async () => {
    const { caller, referralCreate } = makeCtx({
      profileByCode: { userId: "referrer1" },
      existingReferral: null,
    });

    const result = await caller.applyCode({ code: "AL-K9P2", bookingId: "bk1" });

    expect(referralCreate).toHaveBeenCalledTimes(1);
    expect(referralCreate).toHaveBeenCalledWith({
      data: {
        referrerId: "referrer1",
        refereeId: "u1",
        refereeEmail: "ada@example.com",
        code: "AL-K9P2",
        status: "PENDING",
        qualifyingBookingId: "bk1",
      },
    });
    expect(result).toMatchObject({ id: "ref1", status: "PENDING" });
  });

  it("omits the qualifying booking when none is supplied", async () => {
    const { caller, referralCreate } = makeCtx({ profileByCode: { userId: "referrer1" } });

    await caller.applyCode({ code: "AL-K9P2" });

    expect(referralCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ qualifyingBookingId: undefined }),
    });
  });

  it("is idempotent — an existing (referrer, referee) pair is returned, not duplicated", async () => {
    const { caller, referralCreate } = makeCtx({
      profileByCode: { userId: "referrer1" },
      existingReferral: { id: "ref-existing", status: "PENDING" },
    });

    const result = await caller.applyCode({ code: "AL-K9P2" });

    expect(result).toEqual({ id: "ref-existing", status: "PENDING" });
    expect(referralCreate).not.toHaveBeenCalled();
  });

  it("blocks self-referral — no credit for using your own code", async () => {
    const { caller, referralCreate } = makeCtx({ profileByCode: { userId: "u1" } });

    await expect(caller.applyCode({ code: "AL-K9P2" })).resolves.toBeNull();
    expect(referralCreate).not.toHaveBeenCalled();
  });

  it("returns null for an unknown code without writing a referral", async () => {
    const { caller, referralCreate } = makeCtx({ profileByCode: null });

    await expect(caller.applyCode({ code: "GHOST-1" })).resolves.toBeNull();
    expect(referralCreate).not.toHaveBeenCalled();
  });

  it("rejects an anonymous caller (protectedProcedure)", async () => {
    const { caller, referralCreate } = makeCtx({ anon: true });

    await expect(caller.applyCode({ code: "AL-K9P2" })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(referralCreate).not.toHaveBeenCalled();
  });
});

describe("referral.listMine", () => {
  it("lists only the caller's own referrals, newest first, with referee + booking joins", async () => {
    const { caller, referralFindMany } = makeCtx({
      mine: [
        {
          id: "ref1",
          status: "QUALIFIED",
          referee: { firstName: "Bob", lastName: "Chan" },
          qualifyingBooking: { bookingReference: "BK-1", totalAmount: new Prisma.Decimal("120.00") },
        },
      ],
    });

    const result = await caller.listMine();

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "ref1", status: "QUALIFIED" });
    expect(referralFindMany).toHaveBeenCalledWith({
      where: { referrerId: "u1" },
      include: {
        referee: { select: { firstName: true, lastName: true } },
        qualifyingBooking: { select: { bookingReference: true, totalAmount: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  });

  it("rejects an anonymous caller (protectedProcedure)", async () => {
    const { caller, referralFindMany } = makeCtx({ anon: true });

    await expect(caller.listMine()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(referralFindMany).not.toHaveBeenCalled();
  });
});
