import { beforeEach, describe, expect, it, vi } from "vitest";
import { sessionRouter } from "@/server/trpc/router/session";

/**
 * Mirror test for src/server/trpc/router/session.ts.
 *
 * Covers every procedure: `whoAmI` (NT-006) plus the session
 * list/revoke surface — customer-owned and admin-on-behalf-of (NT-018).
 *
 * `whoAmI` is the ambient identity probe the SentryIdentify / PostHogIdentify
 * components fire from the root layout, so it runs on public pages for
 * logged-out visitors. It must answer `null` rather than throw UNAUTHORIZED;
 * every other procedure here stays gated.
 *
 * The audit service is deliberately NOT mocked: revocation is a security
 * event, so the assertions read the rows the resolver actually hands to
 * `prisma.auditLog.create`. The auto-audit middleware writes its own row
 * through the same mock (fire-and-forget, action = the tRPC path), so the
 * helpers below filter on the `session.revoked*` actions the resolvers emit.
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
  const requestMeta = { reqId: "r1", ipAddress: "203.0.113.7", userAgent: "vitest-ua" };
  const ctx = over.anon
    ? {
        prisma,
        session: null,
        user: null,
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        ...requestMeta,
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
        ...requestMeta,
      };

  return { ctx, caller: sessionRouter.createCaller(ctx as never), prisma };
}

type Mock = ReturnType<typeof vi.fn>;

interface AuditRow {
  userId?: string | null;
  action?: string;
  entity?: string;
  entityId?: string;
  status?: string;
  reqId?: string;
  ipAddress?: string;
  userAgent?: string;
  newData?: Record<string, unknown>;
}

interface PrismaMocks {
  session: { findMany: Mock; findUnique: Mock; delete: Mock; deleteMany: Mock };
  auditLog: { create: Mock };
}

const sessionModel = (prisma: Row) => (prisma as unknown as PrismaMocks).session;

const auditRows = (prisma: Row): AuditRow[] =>
  (prisma as unknown as PrismaMocks).auditLog.create.mock.calls.map(
    (c) => (c[0] as { data: AuditRow }).data,
  );

/** Only the rows the resolvers wrote themselves (auto-audit rows use the tRPC path). */
const revokeAuditRows = (prisma: Row): AuditRow[] =>
  auditRows(prisma).filter((row) => (row.action ?? "").startsWith("session.revoked"));

const allAuditActions = (prisma: Row) => auditRows(prisma).map((row) => row.action);

/** Drain the microtask queue `writeAuditAsync` uses, so absence is assertable. */
const flushAudit = () => new Promise((resolve) => setTimeout(resolve, 0));

const activeSession = (id: string, userId: string, expires: string) => ({
  id,
  userId,
  expires: new Date(expires),
  sessionToken: `tok-${id}`,
});

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

describe("session.mine", () => {
  it("hides expired rows, orders newest-expiring first and never selects the token", async () => {
    const { caller, prisma } = makeCtx();

    await caller.mine();

    const args = sessionModel(prisma).findMany.mock.calls[0]?.[0] as {
      where: { userId: string; expires: { gt: Date } };
      orderBy: unknown;
      select: Record<string, boolean>;
    };
    expect(args.where).toMatchObject({ userId: "u1", expires: { gt: expect.any(Date) } });
    expect(args.orderBy).toEqual({ expires: "desc" });
    // The session token is the credential itself — it must never leave the server.
    expect(args.select).toEqual({ id: true, expires: true });
  });
});

describe("session.revokeMine", () => {
  it("deletes the caller's own session and writes the self-revoke audit row", async () => {
    const { caller, prisma } = makeCtx();
    const model = sessionModel(prisma);
    model.findUnique.mockResolvedValue(activeSession("s1", "u1", "2030-01-01"));

    await expect(caller.revokeMine({ sessionId: "s1" })).resolves.toEqual({ ok: true });

    expect(model.delete).toHaveBeenCalledTimes(1);
    expect(model.delete.mock.calls[0]?.[0]).toEqual({ where: { id: "s1" } });
    expect(model.deleteMany).not.toHaveBeenCalled();

    expect(revokeAuditRows(prisma)).toEqual([
      expect.objectContaining({
        userId: "u1",
        action: "session.revoked_self",
        entity: "User",
        entityId: "u1",
        status: "SUCCESS",
        reqId: "r1",
        ipAddress: "203.0.113.7",
        userAgent: "vitest-ua",
        newData: { sessionId: "s1" },
      }),
    ]);
  });

  it("suppresses the auto-audit row so the revocation is logged exactly once", async () => {
    const { caller, prisma } = makeCtx();
    sessionModel(prisma).findUnique.mockResolvedValue(activeSession("s1", "u1", "2030-01-01"));

    await caller.revokeMine({ sessionId: "s1" });
    await flushAudit();

    expect(allAuditActions(prisma)).toEqual(["session.revoked_self"]);
  });

  it("throws NOT_FOUND when the session id does not exist", async () => {
    const { caller, prisma } = makeCtx();
    sessionModel(prisma).findUnique.mockResolvedValue(null);

    await expect(caller.revokeMine({ sessionId: "ghost" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(sessionModel(prisma).delete).not.toHaveBeenCalled();
    expect(revokeAuditRows(prisma)).toEqual([]);
  });

  it("refuses to revoke another user's session, and reports NOT_FOUND rather than FORBIDDEN", async () => {
    const { caller, prisma } = makeCtx();
    // Someone else's live session — answering FORBIDDEN would confirm the id exists.
    sessionModel(prisma).findUnique.mockResolvedValue(activeSession("s9", "someone-else", "2030-01-01"));

    await expect(caller.revokeMine({ sessionId: "s9" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(sessionModel(prisma).delete).not.toHaveBeenCalled();
    expect(revokeAuditRows(prisma)).toEqual([]);
  });

  it("rejects a malformed input before touching the database", async () => {
    const { caller, prisma } = makeCtx();

    await expect(caller.revokeMine({} as never)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(sessionModel(prisma).findUnique).not.toHaveBeenCalled();
  });
});

describe("session.revokeAllMineExceptCurrent", () => {
  it("keeps the newest-expiring session and deletes the rest, with an audit row", async () => {
    const { caller, prisma } = makeCtx();
    const model = sessionModel(prisma);
    model.findMany.mockResolvedValue([
      activeSession("old", "u1", "2030-01-01"),
      activeSession("newest", "u1", "2030-06-01"),
      activeSession("middle", "u1", "2030-03-01"),
    ]);
    model.deleteMany.mockResolvedValue({ count: 2 });

    await expect(caller.revokeAllMineExceptCurrent()).resolves.toEqual({ revoked: 2 });

    expect(model.findMany.mock.calls[0]?.[0]).toMatchObject({
      where: { userId: "u1", expires: { gt: expect.any(Date) } },
    });
    const args = model.deleteMany.mock.calls[0]?.[0] as { where: { id: { in: string[] } } };
    expect(args.where.id.in.sort()).toEqual(["middle", "old"]);
    expect(model.delete).not.toHaveBeenCalled();

    expect(revokeAuditRows(prisma)).toEqual([
      expect.objectContaining({
        userId: "u1",
        action: "session.revoked_all_self",
        entity: "User",
        entityId: "u1",
        status: "SUCCESS",
        newData: { revoked: 2 },
      }),
    ]);
  });

  it("is a no-op when the caller only has the one session", async () => {
    const { caller, prisma } = makeCtx();
    const model = sessionModel(prisma);
    model.findMany.mockResolvedValue([activeSession("only", "u1", "2030-01-01")]);

    await expect(caller.revokeAllMineExceptCurrent()).resolves.toEqual({ revoked: 0 });

    expect(model.deleteMany).not.toHaveBeenCalled();
    expect(revokeAuditRows(prisma)).toEqual([]);
  });
});

describe("session.listForUser", () => {
  it("returns another user's active sessions for an admin", async () => {
    const { caller, prisma } = makeCtx({ role: "ADMIN" });
    const rows = [{ id: "s1", expires: new Date("2030-01-01"), userId: "u2" }];
    sessionModel(prisma).findMany.mockResolvedValue(rows);

    await expect(caller.listForUser({ userId: "u2" })).resolves.toEqual(rows);

    const args = sessionModel(prisma).findMany.mock.calls[0]?.[0] as {
      where: { userId: string; expires: { gt: Date } };
      orderBy: unknown;
      select: Record<string, boolean>;
    };
    expect(args.where).toMatchObject({ userId: "u2", expires: { gt: expect.any(Date) } });
    expect(args.orderBy).toEqual({ expires: "desc" });
    expect(args.select).toEqual({ id: true, expires: true, userId: true });
  });

  it("admits SUPER_ADMIN but not MANAGER", async () => {
    const superAdmin = makeCtx({ role: "SUPER_ADMIN" });
    await expect(superAdmin.caller.listForUser({ userId: "u2" })).resolves.toEqual([]);

    const manager = makeCtx({ role: "MANAGER" });
    await expect(manager.caller.listForUser({ userId: "u2" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("session.revokeForUser", () => {
  it("deletes the target session and audits it against the target user", async () => {
    const { caller, prisma } = makeCtx({ role: "ADMIN" });
    const model = sessionModel(prisma);
    model.findUnique.mockResolvedValue(activeSession("s1", "u2", "2030-01-01"));

    await expect(
      caller.revokeForUser({ sessionId: "s1", userId: "u2" }),
    ).resolves.toEqual({ ok: true });

    expect(model.delete.mock.calls[0]?.[0]).toEqual({ where: { id: "s1" } });
    expect(revokeAuditRows(prisma)).toEqual([
      expect.objectContaining({
        // Actor is the admin; the row is filed on the user who was signed out.
        userId: "u1",
        action: "session.revoked_by_admin",
        entity: "User",
        entityId: "u2",
        status: "SUCCESS",
        newData: { sessionId: "s1", targetUserId: "u2" },
      }),
    ]);
  });

  it("throws NOT_FOUND when the session belongs to a different user than claimed", async () => {
    const { caller, prisma } = makeCtx({ role: "ADMIN" });
    sessionModel(prisma).findUnique.mockResolvedValue(activeSession("s1", "u3", "2030-01-01"));

    await expect(
      caller.revokeForUser({ sessionId: "s1", userId: "u2" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(sessionModel(prisma).delete).not.toHaveBeenCalled();
    expect(revokeAuditRows(prisma)).toEqual([]);
  });

  it("throws NOT_FOUND when the session id does not exist", async () => {
    const { caller, prisma } = makeCtx({ role: "ADMIN" });
    sessionModel(prisma).findUnique.mockResolvedValue(null);

    await expect(
      caller.revokeForUser({ sessionId: "ghost", userId: "u2" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(sessionModel(prisma).delete).not.toHaveBeenCalled();
  });
});

describe("session.revokeAllForUser", () => {
  it("deletes every session for the target user — expired ones included — and audits the count", async () => {
    const { caller, prisma } = makeCtx({ role: "ADMIN" });
    const model = sessionModel(prisma);
    model.deleteMany.mockResolvedValue({ count: 3 });

    await expect(caller.revokeAllForUser({ userId: "u2" })).resolves.toEqual({ revoked: 3 });

    // Suspected-compromise path: no `expires` filter, the whole row set goes.
    expect(model.deleteMany.mock.calls[0]?.[0]).toEqual({ where: { userId: "u2" } });
    expect(revokeAuditRows(prisma)).toEqual([
      expect.objectContaining({
        userId: "u1",
        action: "session.revoked_all_by_admin",
        entity: "User",
        entityId: "u2",
        status: "SUCCESS",
        newData: { targetUserId: "u2", revoked: 3 },
      }),
    ]);
  });

  it("still audits when the user had no sessions left", async () => {
    const { caller, prisma } = makeCtx({ role: "ADMIN" });
    sessionModel(prisma).deleteMany.mockResolvedValue({ count: 0 });

    await expect(caller.revokeAllForUser({ userId: "u2" })).resolves.toEqual({ revoked: 0 });
    expect(revokeAuditRows(prisma)).toEqual([
      expect.objectContaining({ action: "session.revoked_all_by_admin", newData: { targetUserId: "u2", revoked: 0 } }),
    ]);
  });
});

describe("session router — half-authenticated sessions", () => {
  it("treats a pending2fa session as anonymous (UNAUTHORIZED, nothing revoked)", async () => {
    const { caller, prisma } = makeCtx({ pending2fa: true });

    await expect(caller.mine()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller.revokeMine({ sessionId: "s1" })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(sessionModel(prisma).delete).not.toHaveBeenCalled();
    expect(sessionModel(prisma).deleteMany).not.toHaveBeenCalled();
  });

  it("blocks a not-yet-onboarded session with FORBIDDEN", async () => {
    const { caller, prisma } = makeCtx({ requiresOnboarding: true });

    await expect(caller.mine()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.revokeAllMineExceptCurrent()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(sessionModel(prisma).deleteMany).not.toHaveBeenCalled();
  });

  it("runs the 2FA gate before the role gate for a pending2fa admin", async () => {
    const { caller } = makeCtx({ role: "ADMIN", pending2fa: true });

    await expect(caller.listForUser({ userId: "u2" })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(caller.revokeAllForUser({ userId: "u2" })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});
