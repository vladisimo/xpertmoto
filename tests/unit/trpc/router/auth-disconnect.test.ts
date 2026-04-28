import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";

vi.mock("@/server/services/audit", () => ({
  writeAudit: vi.fn().mockResolvedValue(undefined),
  writeAuditAsync: vi.fn(),
  skipAutoAudit: vi.fn(),
  captureCustomerId: vi.fn(),
  readCapturedCustomerId: vi.fn(),
}));

import { authRouter } from "@/server/trpc/router/auth";
import { writeAudit } from "@/server/services/audit";

type Caller = ReturnType<typeof authRouter.createCaller>;

interface MockUser {
  passwordHash: string | null;
  accounts: Array<{ id: string; provider: string }>;
}

function makeCtx(user: MockUser | null) {
  const prisma = {
    user: {
      findUnique: vi.fn().mockResolvedValue(user),
    },
    account: {
      delete: vi.fn().mockResolvedValue({}),
    },
  };
  return {
    prisma,
    ipAddress: "127.0.0.1",
    userAgent: "test",
    reqId: "r1",
    session: { user: { id: "u1", role: "CUSTOMER", depotId: null } },
    headers: undefined,
  } as unknown as Parameters<Caller["disconnectProvider"]>[0];
}

function caller(ctx: unknown): Caller {
  return authRouter.createCaller(ctx as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("auth.disconnectProvider", () => {
  it("disconnects a provider when the user has a password set", async () => {
    const ctx = makeCtx({
      passwordHash: "hashed",
      accounts: [{ id: "acc-google", provider: "google" }],
    });
    const c = caller(ctx);
    const result = await c.disconnectProvider({ provider: "google" });
    expect(result).toEqual({ ok: true });
    const prisma = (ctx as unknown as { prisma: { account: { delete: { mock: { calls: unknown[][] } } } } })
      .prisma;
    expect(prisma.account.delete).toHaveBeenCalledWith({ where: { id: "acc-google" } });
    expect(writeAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "auth.unlink",
        newData: { provider: "google" },
      }),
    );
  });

  it("disconnects when multiple providers remain, even without a password", async () => {
    const ctx = makeCtx({
      passwordHash: null,
      accounts: [
        { id: "acc-google", provider: "google" },
        { id: "acc-github", provider: "github" },
      ],
    });
    const c = caller(ctx);
    const result = await c.disconnectProvider({ provider: "google" });
    expect(result).toEqual({ ok: true });
  });

  it("refuses to remove the last sign-in method when no password is set", async () => {
    const ctx = makeCtx({
      passwordHash: null,
      accounts: [{ id: "acc-google", provider: "google" }],
    });
    const c = caller(ctx);
    await expect(c.disconnectProvider({ provider: "google" })).rejects.toBeInstanceOf(TRPCError);
    const prisma = (ctx as unknown as { prisma: { account: { delete: { mock: { calls: unknown[][] } } } } })
      .prisma;
    expect(prisma.account.delete).not.toHaveBeenCalled();
  });

  it("returns NOT_FOUND when the provider is not connected", async () => {
    const ctx = makeCtx({
      passwordHash: "hashed",
      accounts: [{ id: "acc-google", provider: "google" }],
    });
    const c = caller(ctx);
    await expect(c.disconnectProvider({ provider: "github" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
