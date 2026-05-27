import { beforeEach, describe, expect, it, vi } from "vitest";

const issueStaffInviteSpy = vi.fn();

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn().mockResolvedValue({ ok: true, remaining: 10, resetAt: 0 }),
}));

vi.mock("@/server/services/staff-invite", () => ({
  issueStaffInvite: (...a: unknown[]) => issueStaffInviteSpy(...a),
  buildInviteIdentifier: (email: string) => `invite:${email.toLowerCase()}`,
}));

import { adminRouter } from "@/server/trpc/router/admin";

type Caller = ReturnType<typeof adminRouter.createCaller>;

function makeCtx(overrides: {
  findFirst?: unknown;
  findUnique?: unknown;
  userCreate?: unknown;
  transactionCalls?: unknown[];
}) {
  const transactionCalls: unknown[][] = [];
  const prisma = {
    user: {
      findFirst: vi.fn().mockResolvedValue(overrides.findFirst ?? null),
      findUnique: vi.fn().mockResolvedValue(overrides.findUnique ?? null),
      create: vi.fn().mockResolvedValue(
        overrides.userCreate ?? {
          id: "new-user",
          email: "new@xpert.test",
          role: "STAFF",
        },
      ),
      delete: vi.fn().mockResolvedValue({}),
    },
    verificationToken: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    staffProfile: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    $transaction: vi.fn().mockImplementation(async (ops: unknown[]) => {
      transactionCalls.push(ops);
      return [];
    }),
  };
  return {
    prisma,
    transactionCalls,
    ctx: {
      prisma,
      user: {
        id: "admin1",
        email: "admin@xpert.test",
        name: "Admin One",
        role: "ADMIN",
        depotId: null,
      },
      session: {
        user: {
          id: "admin1",
          email: "admin@xpert.test",
          name: "Admin One",
          role: "ADMIN",
          depotId: null,
        },
      },
      ipAddress: "127.0.0.1",
      userAgent: "test",
      reqId: "r1",
      headers: undefined,
    } as unknown as Parameters<Caller["inviteStaff"]>[0],
  };
}

function caller(ctx: unknown): Caller {
  return adminRouter.createCaller(ctx as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  issueStaffInviteSpy.mockResolvedValue({
    token: "t",
    expiresAt: new Date("2026-05-01"),
  });
});

describe("admin.inviteStaff", () => {
  it("creates a suspended user with no password and issues an invite email", async () => {
    const { ctx, prisma } = makeCtx({
      findFirst: null,
      userCreate: { id: "new-user", email: "new@xpert.test", role: "STAFF" },
    });
    const c = caller(ctx);

    const res = await c.inviteStaff({
      email: "New@Xpert.test",
      firstName: "New",
      lastName: "Hire",
      role: "STAFF",
    });

    expect(prisma.user.create).toHaveBeenCalledTimes(1);
    const createArg = prisma.user.create.mock.calls[0]?.[0] as {
      data: {
        passwordHash: null;
        status: string;
        email: string;
        staffProfile: unknown;
        customerProfile: { create: Record<string, unknown> };
      };
    };
    expect(createArg.data.passwordHash).toBeNull();
    expect(createArg.data.status).toBe("SUSPENDED");
    expect(createArg.data.email).toBe("new@xpert.test"); // lowercased by zod preprocess
    // Back-office users also get a bare CustomerProfile so they can rent.
    expect(createArg.data.staffProfile).toBeDefined();
    expect(createArg.data.customerProfile).toEqual({ create: {} });
    expect(issueStaffInviteSpy).toHaveBeenCalledTimes(1);
    expect(issueStaffInviteSpy.mock.calls[0]?.[1]).toMatchObject({
      email: "new@xpert.test",
      role: "STAFF",
      inviterName: "Admin One",
    });
    expect(res).not.toHaveProperty("tempPassword");
    expect(res).toMatchObject({ id: "new-user", email: "new@xpert.test" });
  });

  it("rejects when the email is already registered", async () => {
    const { ctx, prisma } = makeCtx({ findFirst: { id: "existing" } });
    const c = caller(ctx);
    await expect(
      c.inviteStaff({
        email: "taken@xpert.test",
        firstName: "Dup",
        lastName: "Licate",
        role: "STAFF",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(issueStaffInviteSpy).not.toHaveBeenCalled();
  });
});

describe("admin.resendInvite", () => {
  it("re-issues the invite for a pending (null passwordHash) staff user", async () => {
    const { ctx } = makeCtx({
      findUnique: {
        email: "pending@xpert.test",
        role: "STAFF",
        status: "SUSPENDED",
        passwordHash: null,
        firstName: "Pending",
        lastName: "User",
      },
    });
    const c = caller(ctx);
    const res = await c.resendInvite({ userId: "u2" });
    expect(issueStaffInviteSpy).toHaveBeenCalledTimes(1);
    expect(res.email).toBe("pending@xpert.test");
  });

  it("refuses to resend once the account has been activated (has a passwordHash)", async () => {
    const { ctx } = makeCtx({
      findUnique: {
        email: "active@xpert.test",
        role: "STAFF",
        status: "ACTIVE",
        passwordHash: "already-set",
        firstName: "A",
        lastName: "B",
      },
    });
    const c = caller(ctx);
    await expect(c.resendInvite({ userId: "u2" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(issueStaffInviteSpy).not.toHaveBeenCalled();
  });

  it("refuses to resend to CUSTOMER accounts — this is for staff only", async () => {
    const { ctx } = makeCtx({
      findUnique: {
        email: "cust@xpert.test",
        role: "CUSTOMER",
        status: "SUSPENDED",
        passwordHash: null,
        firstName: "C",
        lastName: "D",
      },
    });
    const c = caller(ctx);
    await expect(c.resendInvite({ userId: "u3" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("returns NOT_FOUND for an unknown user id", async () => {
    const { ctx } = makeCtx({ findUnique: null });
    const c = caller(ctx);
    await expect(c.resendInvite({ userId: "missing" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("admin.revokeInvite", () => {
  it("deletes the token + staff profile + user when the account has not been activated", async () => {
    const { ctx, prisma, transactionCalls } = makeCtx({
      findUnique: {
        email: "pending@xpert.test",
        role: "STAFF",
        passwordHash: null,
      },
    });
    const c = caller(ctx);
    await c.revokeInvite({ userId: "u5" });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // One batched transaction with three write ops (tokens, staffProfile, user).
    expect(transactionCalls[0]).toHaveLength(3);
  });

  it("refuses to revoke an already-activated account", async () => {
    const { ctx, prisma } = makeCtx({
      findUnique: {
        email: "active@xpert.test",
        role: "STAFF",
        passwordHash: "already-set",
      },
    });
    const c = caller(ctx);
    await expect(c.revokeInvite({ userId: "u6" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
