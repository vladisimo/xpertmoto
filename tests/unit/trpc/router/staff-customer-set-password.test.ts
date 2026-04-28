import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("bcryptjs", () => ({
  default: {
    hash: (value: string) => Promise.resolve(`hashed:${value}`),
  },
}));

import { staffCustomerRouter } from "@/server/trpc/router/staff-customer";

type Caller = ReturnType<typeof staffCustomerRouter.createCaller>;

function makeCtx(target: { id: string; role: string; deletedAt: Date | null } | null) {
  const prisma = {
    user: {
      findUnique: vi.fn().mockResolvedValue(target),
      update: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...(target ?? {}), ...data }),
      ),
    },
  };
  return {
    prisma,
    ctx: {
      prisma,
      user: { id: "staff1", role: "STAFF" },
      session: { user: { id: "staff1", role: "STAFF" } },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      reqId: "r1",
    } as unknown as Parameters<Caller["setCustomerPassword"]>[0],
  };
}

function caller(ctx: unknown): Caller {
  return staffCustomerRouter.createCaller(ctx as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("staffCustomer.setCustomerPassword", () => {
  it("hashes the new password and updates the customer, clearing lockout", async () => {
    const { ctx, prisma } = makeCtx({ id: "cust1", role: "CUSTOMER", deletedAt: null });
    const c = caller(ctx);

    const res = await c.setCustomerPassword({ customerId: "cust1", password: "Correct9!Horse" });

    expect(res).toEqual({ ok: true });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "cust1" },
      data: {
        passwordHash: "hashed:Correct9!Horse",
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });
  });

  it("rejects passwords shorter than 10 characters via input validation", async () => {
    const { ctx, prisma } = makeCtx({ id: "cust1", role: "CUSTOMER", deletedAt: null });
    const c = caller(ctx);

    await expect(
      c.setCustomerPassword({ customerId: "cust1", password: "short" }),
    ).rejects.toThrow();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("refuses to reset a non-CUSTOMER account", async () => {
    const { ctx, prisma } = makeCtx({ id: "staff2", role: "STAFF", deletedAt: null });
    const c = caller(ctx);

    await expect(
      c.setCustomerPassword({ customerId: "staff2", password: "Correct9!Horse" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("returns NOT_FOUND when the target does not exist or is soft-deleted", async () => {
    const { ctx: ctxMissing } = makeCtx(null);
    await expect(
      caller(ctxMissing).setCustomerPassword({ customerId: "missing", password: "Correct9!Horse" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const { ctx: ctxDeleted, prisma } = makeCtx({
      id: "cust1",
      role: "CUSTOMER",
      deletedAt: new Date("2026-01-01"),
    });
    await expect(
      caller(ctxDeleted).setCustomerPassword({ customerId: "cust1", password: "Correct9!Horse" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
