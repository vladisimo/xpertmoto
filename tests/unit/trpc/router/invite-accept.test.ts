import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn().mockResolvedValue({ ok: true, remaining: 10, resetAt: 0 }),
}));

vi.mock("bcryptjs", () => ({
  default: {
    hash: (value: string) => Promise.resolve(`hashed:${value}`),
  },
}));

const writeAuditSpy = vi.fn();
vi.mock("@/server/services/audit", () => ({
  writeAudit: (...a: unknown[]) => writeAuditSpy(...a),
  // The tRPC audit middleware calls writeAuditAsync on every request — stub
  // it out as a no-op so the middleware doesn't crash in unit tests.
  writeAuditAsync: vi.fn(),
  captureCustomerId: vi.fn(),
  readCapturedCustomerId: () => undefined,
}));

import { inviteRouter } from "@/server/trpc/router/invite";

type Caller = ReturnType<typeof inviteRouter.createCaller>;

interface TokenRow {
  identifier: string;
  token: string;
  expires: Date;
}
interface UserRow {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
  passwordHash: string | null;
}

function makeCtx(opts: {
  tokenRow?: TokenRow | null;
  userRow?: UserRow | null;
}) {
  const transactionCalls: unknown[][] = [];
  const prisma = {
    verificationToken: {
      findUnique: vi.fn().mockResolvedValue(opts.tokenRow ?? null),
      delete: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    user: {
      findFirst: vi.fn().mockResolvedValue(opts.userRow ?? null),
      update: vi.fn().mockResolvedValue({}),
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
      ipAddress: "127.0.0.1",
      userAgent: "test",
      reqId: "r1",
      session: null,
      headers: undefined,
    } as unknown as Parameters<Caller["accept"]>[0],
  };
}

function caller(ctx: unknown): Caller {
  return inviteRouter.createCaller(ctx as never);
}

const VALID_TOKEN = "a".repeat(64);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("invite.preview", () => {
  it("returns valid=true with the invitee profile for a good token", async () => {
    const { ctx } = makeCtx({
      tokenRow: {
        identifier: "invite:new@xpert.test",
        token: VALID_TOKEN,
        expires: new Date(Date.now() + 60_000),
      },
      userRow: {
        id: "u1",
        email: "new@xpert.test",
        firstName: "New",
        lastName: "Hire",
        role: "STAFF",
        passwordHash: null,
      },
    });
    const c = caller(ctx);
    const res = await c.preview({ token: VALID_TOKEN });
    expect(res).toMatchObject({
      valid: true,
      email: "new@xpert.test",
      role: "STAFF",
    });
  });

  it("rejects a token that doesn't carry the invite: prefix", async () => {
    const { ctx } = makeCtx({
      tokenRow: {
        identifier: "password-reset:x@y.test",
        token: VALID_TOKEN,
        expires: new Date(Date.now() + 60_000),
      },
    });
    const c = caller(ctx);
    const res = await c.preview({ token: VALID_TOKEN });
    expect(res).toEqual({ valid: false, reason: "invalid" });
  });

  it("burns an expired token and reports reason=expired", async () => {
    const { ctx, prisma } = makeCtx({
      tokenRow: {
        identifier: "invite:stale@xpert.test",
        token: VALID_TOKEN,
        expires: new Date(Date.now() - 1_000),
      },
    });
    const c = caller(ctx);
    const res = await c.preview({ token: VALID_TOKEN });
    expect(res).toEqual({ valid: false, reason: "expired" });
    expect(prisma.verificationToken.delete).toHaveBeenCalledWith({
      where: { token: VALID_TOKEN },
    });
  });

  it("reports already_activated when the user already has a passwordHash", async () => {
    const { ctx } = makeCtx({
      tokenRow: {
        identifier: "invite:replay@xpert.test",
        token: VALID_TOKEN,
        expires: new Date(Date.now() + 60_000),
      },
      userRow: {
        id: "u1",
        email: "replay@xpert.test",
        firstName: "R",
        lastName: "E",
        role: "STAFF",
        passwordHash: "already-set",
      },
    });
    const c = caller(ctx);
    const res = await c.preview({ token: VALID_TOKEN });
    expect(res).toEqual({ valid: false, reason: "already_activated" });
  });
});

describe("invite.accept", () => {
  it("hashes the password, activates the user, burns the token, writes audit", async () => {
    const { ctx, prisma, transactionCalls } = makeCtx({
      tokenRow: {
        identifier: "invite:new@xpert.test",
        token: VALID_TOKEN,
        expires: new Date(Date.now() + 60_000),
      },
      userRow: {
        id: "u1",
        email: "new@xpert.test",
        firstName: "New",
        lastName: "Hire",
        role: "STAFF",
        passwordHash: null,
      },
    });
    const c = caller(ctx);
    const res = await c.accept({ token: VALID_TOKEN, password: "Str0ng!Pass" });
    expect(res).toEqual({
      ok: true,
      email: "new@xpert.test",
      requiresTotp: true,
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // Two ops in the activation transaction: user.update + verificationToken.deleteMany
    expect(transactionCalls[0]).toHaveLength(2);
    expect(writeAuditSpy).toHaveBeenCalledTimes(1);
    expect(writeAuditSpy.mock.calls[0]?.[1]).toMatchObject({
      action: "auth.invite_accepted",
      entity: "User",
      entityId: "u1",
    });
  });

  it("returns requiresTotp=false for a CUSTOMER role (e.g. a hand-crafted customer invite)", async () => {
    const { ctx } = makeCtx({
      tokenRow: {
        identifier: "invite:cust@xpert.test",
        token: VALID_TOKEN,
        expires: new Date(Date.now() + 60_000),
      },
      userRow: {
        id: "u2",
        email: "cust@xpert.test",
        firstName: null,
        lastName: null,
        role: "CUSTOMER",
        passwordHash: null,
      },
    });
    const c = caller(ctx);
    const res = await c.accept({ token: VALID_TOKEN, password: "Str0ng!Pass" });
    expect(res.requiresTotp).toBe(false);
  });

  it("rejects an expired token with a user-safe message", async () => {
    const { ctx } = makeCtx({
      tokenRow: {
        identifier: "invite:stale@xpert.test",
        token: VALID_TOKEN,
        expires: new Date(Date.now() - 1_000),
      },
    });
    const c = caller(ctx);
    await expect(
      c.accept({ token: VALID_TOKEN, password: "Str0ng!Pass" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects a password-reset-prefixed token (wrong token type)", async () => {
    const { ctx } = makeCtx({
      tokenRow: {
        identifier: "password-reset:x@y.test",
        token: VALID_TOKEN,
        expires: new Date(Date.now() + 60_000),
      },
    });
    const c = caller(ctx);
    await expect(
      c.accept({ token: VALID_TOKEN, password: "Str0ng!Pass" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects a replay after activation with the 'already used' message", async () => {
    const { ctx } = makeCtx({
      tokenRow: {
        identifier: "invite:replay@xpert.test",
        token: VALID_TOKEN,
        expires: new Date(Date.now() + 60_000),
      },
      userRow: {
        id: "u3",
        email: "replay@xpert.test",
        firstName: null,
        lastName: null,
        role: "STAFF",
        passwordHash: "already-set",
      },
    });
    const c = caller(ctx);
    await expect(
      c.accept({ token: VALID_TOKEN, password: "Str0ng!Pass" }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("already been used"),
    });
  });

  it("rejects a weak password at the input schema level (no transaction starts)", async () => {
    const { ctx, prisma } = makeCtx({
      tokenRow: {
        identifier: "invite:new@xpert.test",
        token: VALID_TOKEN,
        expires: new Date(Date.now() + 60_000),
      },
      userRow: {
        id: "u1",
        email: "new@xpert.test",
        firstName: "N",
        lastName: "H",
        role: "STAFF",
        passwordHash: null,
      },
    });
    const c = caller(ctx);
    await expect(
      c.accept({ token: VALID_TOKEN, password: "weak" }),
    ).rejects.toThrow();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
