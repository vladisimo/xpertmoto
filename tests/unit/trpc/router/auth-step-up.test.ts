import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn().mockResolvedValue({ ok: true, remaining: 10, resetAt: 0 }),
}));

vi.mock("@/server/services/audit", () => ({
  writeAudit: vi.fn().mockResolvedValue(undefined),
  writeAuditAsync: vi.fn(),
  skipAutoAudit: vi.fn(),
  captureCustomerId: vi.fn(),
  readCapturedCustomerId: vi.fn(),
}));

vi.mock("@/lib/totp", () => ({
  verifyTotpCode: vi.fn(),
  verifyRecoveryCode: vi.fn(),
}));

vi.mock("@/lib/auth-step-up-token", () => ({
  signStepUpToken: vi.fn(() => "step-up-token-fixture"),
}));

import { authRouter } from "@/server/trpc/router/auth";
import { writeAudit } from "@/server/services/audit";
import { verifyTotpCode, verifyRecoveryCode } from "@/lib/totp";
import { rateLimit } from "@/lib/rate-limit";
import { signStepUpToken } from "@/lib/auth-step-up-token";

type Caller = ReturnType<typeof authRouter.createCaller>;

interface MockUser {
  id: string;
  status: "ACTIVE" | "SUSPENDED" | "BANNED";
  deletedAt: Date | null;
  failedLoginCount: number;
  lockedUntil: Date | null;
  totp: {
    id: string;
    encryptedSecret: { enc: string; iv: string; tag: string };
    recoveryCodes: string[];
    enabled: boolean;
  } | null;
}

function activeUser(overrides: Partial<MockUser> = {}): MockUser {
  return {
    id: "u_step",
    status: "ACTIVE",
    deletedAt: null,
    failedLoginCount: 0,
    lockedUntil: null,
    totp: {
      id: "totp_1",
      encryptedSecret: { enc: "e", iv: "i", tag: "t" },
      recoveryCodes: ["hashed-1", "hashed-2"],
      enabled: true,
    },
    ...overrides,
  };
}

function makeCtx(user: MockUser | null, sessionUserId = "u_step") {
  const prisma = {
    user: {
      findUnique: vi.fn().mockResolvedValue(user),
      update: vi.fn().mockResolvedValue({}),
    },
    userTotp: {
      update: vi.fn().mockResolvedValue({}),
    },
  };
  return {
    prisma,
    ipAddress: "127.0.0.1",
    userAgent: "test",
    reqId: "r1",
    session: {
      user: { id: sessionUserId, role: "STAFF", depotId: null },
      // pending2fa flag is irrelevant — stepUpProcedure doesn't gate on it.
      pending2fa: true,
    },
    headers: undefined,
  } as unknown as Parameters<Caller["verifyOauthStepUp"]>[0];
}

function caller(ctx: unknown): Caller {
  return authRouter.createCaller(ctx as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("auth.verifyOauthStepUp", () => {
  it("accepts a valid 6-digit TOTP code and stamps lastUsedAt", async () => {
    vi.mocked(verifyTotpCode).mockReturnValue(true);
    const ctx = makeCtx(activeUser());
    const c = caller(ctx);

    const result = await c.verifyOauthStepUp({ code: "123456" });

    expect(result).toEqual({
      ok: true,
      stepUpToken: "step-up-token-fixture",
    });
    expect(signStepUpToken).toHaveBeenCalledWith("u_step");
    expect(verifyTotpCode).toHaveBeenCalledWith("123456", expect.any(Object));
    const prisma = (
      ctx as unknown as {
        prisma: {
          userTotp: { update: { mock: { calls: unknown[][] } } };
          user: { update: { mock: { calls: unknown[][] } } };
        };
      }
    ).prisma;
    expect(prisma.userTotp.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "totp_1" },
        data: expect.objectContaining({ lastUsedAt: expect.any(Date) }),
      }),
    );
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ failedLoginCount: 0, lockedUntil: null }),
      }),
    );
    expect(writeAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "auth.oauth.totp_step_up",
        status: "SUCCESS",
        newData: { usedRecoveryCode: false },
      }),
    );
  });

  it("consumes a recovery code on success and removes it from the list", async () => {
    vi.mocked(verifyRecoveryCode).mockReturnValue({ matched: true, index: 1 });
    const ctx = makeCtx(activeUser());
    const c = caller(ctx);

    const result = await c.verifyOauthStepUp({ code: "abcde-fghij" });

    expect(result).toEqual({
      ok: true,
      stepUpToken: "step-up-token-fixture",
    });
    const prisma = (
      ctx as unknown as {
        prisma: { userTotp: { update: { mock: { calls: unknown[][] } } } };
      }
    ).prisma;
    const updateCall = prisma.userTotp.update.mock.calls[0]?.[0] as {
      data: { recoveryCodes: string[] };
    };
    expect(updateCall.data.recoveryCodes).toEqual(["hashed-1"]);
    expect(writeAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: "SUCCESS",
        newData: { usedRecoveryCode: true },
      }),
    );
  });

  it("rejects bad codes, increments lockout, and writes a FAILURE audit row", async () => {
    vi.mocked(verifyTotpCode).mockReturnValue(false);
    const ctx = makeCtx(activeUser({ failedLoginCount: 2 }));
    const c = caller(ctx);

    await expect(c.verifyOauthStepUp({ code: "999999" })).rejects.toThrowError(
      TRPCError,
    );

    const prisma = (
      ctx as unknown as {
        prisma: { user: { update: { mock: { calls: unknown[][] } } } };
      }
    ).prisma;
    const updateCall = prisma.user.update.mock.calls[0]?.[0] as {
      data: { failedLoginCount: number; lastFailedLoginAt: Date };
    };
    expect(updateCall.data.failedLoginCount).toBe(3);
    expect(updateCall.data.lastFailedLoginAt).toBeInstanceOf(Date);
    expect(writeAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "auth.oauth.totp_step_up",
        status: "FAILURE",
        newData: { reason: "bad_code" },
      }),
    );
  });

  it("locks the account when the bad-code threshold is hit", async () => {
    vi.mocked(verifyTotpCode).mockReturnValue(false);
    // Lockout threshold is 5; after 4 prior failures the next one trips it.
    const ctx = makeCtx(activeUser({ failedLoginCount: 4 }));
    const c = caller(ctx);

    await expect(c.verifyOauthStepUp({ code: "000000" })).rejects.toThrowError(
      /locked/i,
    );

    expect(writeAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: "FAILURE",
        newData: { reason: "locked_now" },
      }),
    );
  });

  it("refuses verification when the user is currently locked", async () => {
    const future = new Date(Date.now() + 60 * 1000);
    const ctx = makeCtx(activeUser({ lockedUntil: future }));
    const c = caller(ctx);

    await expect(c.verifyOauthStepUp({ code: "123456" })).rejects.toThrowError(
      /locked/i,
    );
    expect(verifyTotpCode).not.toHaveBeenCalled();
  });

  it("returns ok when TOTP is unexpectedly disabled (defensive no-op)", async () => {
    const ctx = makeCtx(activeUser({ totp: null }));
    const c = caller(ctx);

    const result = await c.verifyOauthStepUp({ code: "123456" });
    expect(result).toEqual({
      ok: true,
      stepUpToken: "step-up-token-fixture",
    });
    expect(verifyTotpCode).not.toHaveBeenCalled();
  });

  it("returns TOO_MANY_REQUESTS when the per-user rate limit trips", async () => {
    vi.mocked(rateLimit).mockResolvedValueOnce({
      ok: false,
      remaining: 0,
      resetAt: Date.now() + 1000,
    });
    const ctx = makeCtx(activeUser());
    const c = caller(ctx);

    await expect(c.verifyOauthStepUp({ code: "123456" })).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
    });
  });
});
