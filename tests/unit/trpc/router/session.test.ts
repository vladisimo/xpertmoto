import { beforeEach, describe, expect, it, vi } from "vitest";
import { sessionRouter } from "@/server/trpc/router/session";

/**
 * Mirror test for src/server/trpc/router/session.ts.
 *
 * Scoped to `whoAmI` (NT-006) plus the auth-behaviour guard rails for the
 * rest of the router — a fuller session-router suite is NT-018.
 *
 * `whoAmI` is the ambient identity probe the SentryIdentify / PostHogIdentify
 * components fire from the root layout, so it runs on public pages for
 * logged-out visitors. It must answer `null` rather than throw UNAUTHORIZED;
 * every other procedure here stays gated.
 */

type Row = Record<string, unknown>;

interface Over {
  anon?: boolean;
  role?: "CUSTOMER" | "STAFF" | "MANAGER" | "ADMIN" | "SUPER_ADMIN";
  impersonatorId?: string | null;
  pending2fa?: boolean;
  requiresOnboarding?: boolean;
}

function makeCtx(over: Over = {}) {
  const prisma: Row = {
    session: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      delete: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    auditLog: { create: vi.fn().mockResolvedValue({ id: "a1" }) },
  };

  const sessionUser = { id: "u1", role: over.role ?? "CUSTOMER", email: "ada@example.com" };
  const ctx = over.anon
    ? {
        prisma,
        session: null,
        user: null,
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        reqId: "r1",
      }
    : {
        prisma,
        session: {
          user: sessionUser,
          impersonatorId: over.impersonatorId ?? null,
          ...(over.pending2fa ? { pending2fa: true } : {}),
          ...(over.requiresOnboarding ? { requiresOnboarding: true } : {}),
        },
        user: sessionUser,
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        reqId: "r1",
      };

  return { ctx, caller: sessionRouter.createCaller(ctx as never), prisma };
}

beforeEach(() => vi.clearAllMocks());

describe("session.whoAmI", () => {
  it("returns the identity payload for a signed-in caller", async () => {
    const { caller } = makeCtx({ role: "STAFF" });

    await expect(caller.whoAmI()).resolves.toEqual({
      id: "u1",
      role: "STAFF",
      impersonatorId: null,
    });
  });

  it("passes the impersonating admin through so the client can show the banner", async () => {
    const { caller } = makeCtx({ role: "CUSTOMER", impersonatorId: "admin1" });

    await expect(caller.whoAmI()).resolves.toEqual({
      id: "u1",
      role: "CUSTOMER",
      impersonatorId: "admin1",
    });
  });

  it("returns null for an anonymous caller instead of throwing UNAUTHORIZED", async () => {
    const { caller } = makeCtx({ anon: true });

    // The root-layout probe runs on public pages: a throw here is a console
    // error + wasted request on every logged-out page view (NT-006).
    await expect(caller.whoAmI()).resolves.toBeNull();
  });

  it("returns null for a half-authenticated session (pending2fa / onboarding)", async () => {
    const pending = makeCtx({ role: "STAFF", pending2fa: true });
    await expect(pending.caller.whoAmI()).resolves.toBeNull();

    const onboarding = makeCtx({ role: "CUSTOMER", requiresOnboarding: true });
    await expect(onboarding.caller.whoAmI()).resolves.toBeNull();
  });
});

describe("session router — auth gates on every other procedure", () => {
  it("rejects anonymous callers on the protected procedures", async () => {
    const { caller, prisma } = makeCtx({ anon: true });

    await expect(caller.mine()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller.revokeMine({ sessionId: "s1" })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(caller.revokeAllMineExceptCurrent()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect((prisma.session as Row).delete).not.toHaveBeenCalled();
    expect((prisma.session as Row).deleteMany).not.toHaveBeenCalled();
  });

  it("rejects anonymous callers on the admin procedures", async () => {
    const { caller } = makeCtx({ anon: true });

    await expect(caller.listForUser({ userId: "u2" })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(
      caller.revokeForUser({ sessionId: "s1", userId: "u2" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller.revokeAllForUser({ userId: "u2" })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("rejects non-admin signed-in callers on the admin procedures", async () => {
    const { caller, prisma } = makeCtx({ role: "STAFF" });

    await expect(caller.listForUser({ userId: "u2" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      caller.revokeForUser({ sessionId: "s1", userId: "u2" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.revokeAllForUser({ userId: "u2" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect((prisma.session as Row).deleteMany).not.toHaveBeenCalled();
  });

  it("still serves the signed-in caller's own sessions", async () => {
    const { caller, prisma } = makeCtx();
    const findMany = (prisma.session as Row).findMany as ReturnType<typeof vi.fn>;
    findMany.mockResolvedValue([{ id: "s1", expires: new Date("2030-01-01") }]);

    const result = await caller.mine();

    expect(result).toEqual([{ id: "s1", expires: new Date("2030-01-01") }]);
    expect(findMany.mock.calls[0]?.[0]).toMatchObject({
      where: { userId: "u1" },
      select: { id: true, expires: true },
    });
  });
});
