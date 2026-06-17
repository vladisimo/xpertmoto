import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn().mockResolvedValue({ ok: true, remaining: 10, resetAt: 0 }),
}));
const sendEmail = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/email", () => ({ sendEmail: (...a: unknown[]) => sendEmail(...a) }));
vi.mock("@/lib/branding", () => ({
  getBranding: vi.fn().mockResolvedValue({ siteName: "XPERT Moto" }),
}));
vi.mock("@/lib/analytics", () => ({
  trackServer: vi.fn(),
  trackServerIdentify: vi.fn(),
}));
vi.mock("@/server/services/audit", () => ({
  writeAudit: vi.fn(),
  writeAuditAsync: vi.fn(),
  captureCustomerId: vi.fn(),
  readCapturedCustomerId: vi.fn(),
  capturePageView: vi.fn(),
  skipAutoAudit: vi.fn(),
}));

import { authRouter } from "@/server/trpc/router/auth";

type Over = {
  userFindFirst?: Record<string, unknown> | null;
  token?: Record<string, unknown> | null;
};

function makeCtx(over: Over = {}) {
  const prisma = {
    user: {
      findFirst: vi.fn(async () => over.userFindFirst ?? null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "u_new",
        email: data.email,
      })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "u1",
        ...data,
      })),
    },
    verificationToken: {
      findUnique: vi.fn(async () => over.token ?? null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => data),
      delete: vi.fn(async () => ({})),
      deleteMany: vi.fn(async () => ({ count: 1 })),
    },
    $transaction: vi.fn(async (arg: unknown) =>
      Array.isArray(arg) ? Promise.all(arg) : (arg as (p: unknown) => unknown)(prisma),
    ),
  };
  const ctx = {
    prisma,
    session: null,
    user: null,
    ipAddress: "127.0.0.1",
    userAgent: "test",
    reqId: "r1",
  };
  return { ctx, prisma };
}

const caller = (ctx: unknown) => authRouter.createCaller(ctx as never);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("auth.register — email verification (R2-M4)", () => {
  it("sends a verification email and leaves emailVerified unset", async () => {
    const { ctx, prisma } = makeCtx({ userFindFirst: null });

    await caller(ctx).register({
      email: "new@example.com",
      password: "Str0ng!Passw0rd",
      firstName: "Vlad",
      lastName: "Tester",
      acceptedTerms: true,
      acceptedPrivacy: true,
      marketingOptIn: false,
      marketingSmsOptIn: false,
    });

    // The new account is NOT pre-verified.
    expect(prisma.user.create.mock.calls[0]![0]!.data.emailVerified).toBeUndefined();
    // A namespaced email-verify token was minted and a mail sent.
    expect(prisma.verificationToken.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          identifier: "email-verify:new@example.com",
        }),
      }),
    );
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });
});

describe("auth.verifyEmail", () => {
  it("confirms a valid token and burns it", async () => {
    const { ctx, prisma } = makeCtx({
      token: {
        token: "tok123456789",
        identifier: "email-verify:user@example.com",
        expires: new Date(Date.now() + 60_000),
      },
      userFindFirst: { id: "u1", emailVerified: null, status: "ACTIVE", deletedAt: null },
    });

    const res = await caller(ctx).verifyEmail({ token: "tok123456789" });

    expect(res).toEqual({ ok: true });
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ emailVerified: expect.any(Date) }),
      }),
    );
    expect(prisma.verificationToken.deleteMany).toHaveBeenCalledWith({
      where: { identifier: "email-verify:user@example.com" },
    });
  });

  it("rejects a token that isn't an email-verify token", async () => {
    const { ctx } = makeCtx({
      token: {
        token: "tok123456789",
        identifier: "password-reset:user@example.com",
        expires: new Date(Date.now() + 60_000),
      },
    });

    await expect(caller(ctx).verifyEmail({ token: "tok123456789" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("rejects and clears an expired token", async () => {
    const { ctx, prisma } = makeCtx({
      token: {
        token: "tok123456789",
        identifier: "email-verify:user@example.com",
        expires: new Date(Date.now() - 60_000),
      },
    });

    await expect(caller(ctx).verifyEmail({ token: "tok123456789" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(prisma.verificationToken.delete).toHaveBeenCalled();
  });
});

describe("auth.resendVerification (non-enumerating)", () => {
  it("sends a fresh link for an active, unverified account", async () => {
    const { ctx } = makeCtx({
      userFindFirst: { id: "u1", emailVerified: null, status: "ACTIVE", deletedAt: null },
    });

    const res = await caller(ctx).resendVerification({ email: "user@example.com" });

    expect(res).toEqual({ ok: true });
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("does not send for an already-verified account but still returns ok", async () => {
    const { ctx } = makeCtx({
      userFindFirst: { id: "u1", emailVerified: new Date(), status: "ACTIVE", deletedAt: null },
    });

    const res = await caller(ctx).resendVerification({ email: "user@example.com" });

    expect(res).toEqual({ ok: true });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("does not send for an unknown email but still returns ok", async () => {
    const { ctx } = makeCtx({ userFindFirst: null });

    const res = await caller(ctx).resendVerification({ email: "nobody@example.com" });

    expect(res).toEqual({ ok: true });
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
