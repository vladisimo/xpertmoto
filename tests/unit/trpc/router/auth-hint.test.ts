import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn().mockResolvedValue({ ok: true, remaining: 10, resetAt: 0 }),
}));

import { authRouter } from "@/server/trpc/router/auth";

type Caller = ReturnType<typeof authRouter.createCaller>;

interface MockUser {
  id: string;
  passwordHash: string | null;
  accounts: Array<{ provider: string }>;
}

function makeCtx(user: MockUser | null) {
  const prisma = {
    user: {
      findFirst: vi.fn().mockResolvedValue(user),
    },
  };
  return {
    prisma,
    ipAddress: "127.0.0.1",
    userAgent: "test",
    reqId: "r1",
    session: null,
    headers: undefined,
  } as unknown as Parameters<Caller["existingAccountHint"]>[0];
}

function caller(ctx: unknown): Caller {
  return authRouter.createCaller(ctx as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("auth.existingAccountHint", () => {
  it("returns exists:false with no methods when the account is missing", async () => {
    const ctx = makeCtx(null);
    const c = caller(ctx);
    const result = await c.existingAccountHint({ email: "nobody@x.com" });
    expect(result).toEqual({ exists: false, methods: [] });
  });

  it("returns password + linked providers for an ACTIVE user", async () => {
    const ctx = makeCtx({
      id: "u1",
      passwordHash: "hashed",
      accounts: [{ provider: "google" }, { provider: "github" }],
    });
    const c = caller(ctx);
    const result = await c.existingAccountHint({ email: "v@x.com" });
    expect(result.exists).toBe(true);
    expect(result.methods).toEqual(["password", "google", "github"]);
  });

  it("omits password when the account has none", async () => {
    const ctx = makeCtx({
      id: "u1",
      passwordHash: null,
      accounts: [{ provider: "google" }],
    });
    const c = caller(ctx);
    const result = await c.existingAccountHint({ email: "v@x.com" });
    expect(result.methods).toEqual(["google"]);
  });

  it("filters out unknown providers so the UI never renders a button for them", async () => {
    const ctx = makeCtx({
      id: "u1",
      passwordHash: "hashed",
      accounts: [
        { provider: "google" },
        { provider: "some-legacy-provider" },
      ],
    });
    const c = caller(ctx);
    const result = await c.existingAccountHint({ email: "v@x.com" });
    expect(result.methods).toEqual(["password", "google"]);
  });

  it("queries case-insensitively and with the lowercased email", async () => {
    const ctx = makeCtx(null);
    const c = caller(ctx);
    await c.existingAccountHint({ email: "  Vlad@Example.COM " });
    // After the Zod transform, findFirst receives the lowercased/trimmed email.
    const call = (ctx as unknown as { prisma: { user: { findFirst: { mock: { calls: unknown[][] } } } } })
      .prisma.user.findFirst.mock.calls[0]?.[0];
    expect(call).toMatchObject({
      where: {
        email: { equals: "vlad@example.com", mode: "insensitive" },
        deletedAt: null,
        status: "ACTIVE",
      },
    });
  });
});
