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

vi.mock("bcryptjs", () => ({
  default: { hash: vi.fn().mockResolvedValue("hashed-pw") },
}));

import { authRouter } from "@/server/trpc/router/auth";
import { TERMS_VERSION, PRIVACY_VERSION } from "@/lib/consent-versions";

type Caller = ReturnType<typeof authRouter.createCaller>;

const VALID_INPUT = {
  email: "newcustomer@example.com",
  password: "TenChars9!X",
  firstName: "Riley",
  lastName: "Nguyen",
  phone: "+61400111222",
  acceptedTerms: true as const,
  acceptedPrivacy: true as const,
  marketingOptIn: true,
  marketingSmsOptIn: false,
};

function makeCtx(overrides: {
  existingUser?: Record<string, unknown> | null;
  createdUser?: Record<string, unknown>;
} = {}) {
  const userCreate = vi
    .fn()
    .mockResolvedValue(overrides.createdUser ?? { id: "u_new", email: VALID_INPUT.email });
  const prisma = {
    user: {
      findFirst: vi.fn().mockResolvedValue(overrides.existingUser ?? null),
      create: userCreate,
    },
  };
  return {
    prisma,
    ipAddress: "127.0.0.1",
    userAgent: "test",
    reqId: "r1",
    session: undefined,
    headers: undefined,
  } as unknown as Parameters<Caller["register"]>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("auth.register", () => {
  it("creates a customer with consent timestamps and current versions stamped server-side", async () => {
    const ctx = makeCtx();
    const c = authRouter.createCaller(ctx as never);

    const result = await c.register(VALID_INPUT);

    expect(result).toEqual({ id: "u_new", email: VALID_INPUT.email });
    const prisma = (ctx as unknown as { prisma: { user: { create: ReturnType<typeof vi.fn> } } }).prisma;
    expect(prisma.user.create).toHaveBeenCalledTimes(1);
    const createCall = prisma.user.create.mock.calls[0];
    if (!createCall) throw new Error("create not called");
    const createArgs = createCall[0];
    expect(createArgs.data.email).toBe(VALID_INPUT.email);
    expect(createArgs.data.role).toBe("CUSTOMER");

    const profile = createArgs.data.customerProfile.create;
    expect(profile.marketingOptIn).toBe(true);
    expect(profile.marketingSmsOptIn).toBe(false);
    expect(profile.termsVersion).toBe(TERMS_VERSION);
    expect(profile.privacyVersion).toBe(PRIVACY_VERSION);
    expect(profile.termsAcceptedAt).toBeInstanceOf(Date);
    expect(profile.privacyAcceptedAt).toBeInstanceOf(Date);
    // Both timestamps should be the same `Date` instance (single `new Date()` per call).
    expect(profile.termsAcceptedAt).toBe(profile.privacyAcceptedAt);
  });

  it("returns CONFLICT when the email is already registered (case-insensitive)", async () => {
    const ctx = makeCtx({ existingUser: { id: "u_existing", email: "newcustomer@example.com" } });
    const c = authRouter.createCaller(ctx as never);

    await expect(c.register(VALID_INPUT)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    const prisma = (ctx as unknown as { prisma: { user: { create: ReturnType<typeof vi.fn> } } }).prisma;
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it("rejects with validation error when acceptedTerms is missing", async () => {
    const ctx = makeCtx();
    const c = authRouter.createCaller(ctx as never);
    const { acceptedTerms: _, ...rest } = VALID_INPUT;
    void _;
    await expect(c.register(rest as typeof VALID_INPUT)).rejects.toBeInstanceOf(TRPCError);
  });

  it("rejects with validation error when acceptedPrivacy is missing", async () => {
    const ctx = makeCtx();
    const c = authRouter.createCaller(ctx as never);
    const { acceptedPrivacy: _, ...rest } = VALID_INPUT;
    void _;
    await expect(c.register(rest as typeof VALID_INPUT)).rejects.toBeInstanceOf(TRPCError);
  });
});
