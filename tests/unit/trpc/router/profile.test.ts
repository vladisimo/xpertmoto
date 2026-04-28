import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import bcrypt from "bcryptjs";

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn().mockResolvedValue({ ok: true, remaining: 10, resetAt: 0 }),
}));

vi.mock("@/server/services/notification-sender", () => ({
  sendNotification: vi.fn().mockResolvedValue({
    results: [],
    logIds: [],
    notificationIds: [],
  }),
}));

import { sendNotification } from "@/server/services/notification-sender";

vi.mock("@/lib/branding", () => ({
  getBranding: vi.fn().mockResolvedValue({ siteName: "XPERT Moto" }),
}));

import { profileRouter } from "@/server/trpc/router/profile";

type Caller = ReturnType<typeof profileRouter.createCaller>;

function makeCtx(overrides: {
  user?: Record<string, unknown> | null;
  userId?: string;
} = {}) {
  const userId = overrides.userId ?? "u1";
  const prisma = {
    user: {
      findUnique: vi.fn().mockResolvedValue(overrides.user ?? null),
      update: vi.fn().mockResolvedValue({}),
    },
  };
  return {
    prisma,
    session: { user: { id: userId, role: "STAFF" } },
    user: { id: userId, role: "STAFF" },
    ipAddress: "127.0.0.1",
    reqId: "r1",
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  } as unknown as Parameters<Caller["me"]>[0];
}

function caller(ctx: unknown): Caller {
  return profileRouter.createCaller(ctx as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("profile.updateBasics", () => {
  it("persists the trimmed name + normalises an empty phone to null", async () => {
    const ctx = makeCtx();
    const c = caller(ctx);
    await c.updateBasics({
      firstName: "  Alice  ",
      lastName: "Chen",
      phone: "",
    });
    const updateArgs = (ctx as unknown as {
      prisma: { user: { update: { mock: { calls: unknown[][] } } } };
    }).prisma.user.update.mock.calls[0]?.[0];
    expect(updateArgs).toMatchObject({
      where: { id: "u1" },
      data: { firstName: "Alice", lastName: "Chen", phone: null },
    });
  });
});

describe("profile.changePassword", () => {
  it("rotates the password when the current one is correct", async () => {
    const hash = await bcrypt.hash("oldpassword1", 4);
    const ctx = makeCtx({
      user: { passwordHash: hash, email: "v@example.com" },
    });
    const c = caller(ctx);
    await c.changePassword({
      currentPassword: "oldpassword1",
      newPassword: "Brand-New-Secret-99",
    });
    const updateArgs = (ctx as unknown as {
      prisma: { user: { update: { mock: { calls: unknown[][] } } } };
    }).prisma.user.update.mock.calls[0]?.[0] as {
      data: { passwordHash: string };
    };
    expect(updateArgs.data.passwordHash).toBeDefined();
    expect(updateArgs.data.passwordHash).not.toBe(hash);
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it("rejects when the current password is wrong", async () => {
    const hash = await bcrypt.hash("oldpassword1", 4);
    const ctx = makeCtx({
      user: { passwordHash: hash, email: "v@example.com" },
    });
    const c = caller(ctx);
    await expect(
      c.changePassword({
        currentPassword: "not-the-right-one",
        newPassword: "Brand-New-Secret-99",
      }),
    ).rejects.toBeInstanceOf(TRPCError);
    const updates = (ctx as unknown as {
      prisma: { user: { update: { mock: { calls: unknown[][] } } } };
    }).prisma.user.update.mock.calls;
    expect(updates).toHaveLength(0);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("refuses to rotate when the account has no password yet", async () => {
    const ctx = makeCtx({
      user: { passwordHash: null, email: "v@example.com" },
    });
    const c = caller(ctx);
    await expect(
      c.changePassword({
        currentPassword: "anything",
        newPassword: "Brand-New-Secret-99",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
