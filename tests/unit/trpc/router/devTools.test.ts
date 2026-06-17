import { describe, expect, test, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

// `injectToll` delegates the matching + write to upsertInfringementFromRow,
// which is exhaustively unit-tested via `classifyRowAction`. Stub it here so
// the router test focuses on the wiring (input mapping, account creation,
// return shape) without re-mocking the full matching pipeline.
const { upsertInfringementFromRow } = vi.hoisted(() => ({
  upsertInfringementFromRow: vi.fn(),
}));
vi.mock("@/server/services/linkt", () => ({
  upsertInfringementFromRow,
}));

import { assertNotProduction, devToolsRouter } from "@/server/trpc/router/devTools";

describe("assertNotProduction", () => {
  test("throws FORBIDDEN in production", () => {
    try {
      assertNotProduction("production");
      expect.fail("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      expect((err as TRPCError).code).toBe("FORBIDDEN");
      expect((err as TRPCError).message).toMatch(/disabled in production/);
    }
  });

  test("is a no-op in development", () => {
    expect(() => assertNotProduction("development")).not.toThrow();
  });

  test("is a no-op in test", () => {
    expect(() => assertNotProduction("test")).not.toThrow();
  });

  test("is a no-op when NODE_ENV is undefined", () => {
    expect(() => assertNotProduction(undefined)).not.toThrow();
  });
});

describe("devTools.injectToll", () => {
  const TEST_ACCOUNT = {
    id: "acct_test",
    name: "Test injections",
    isActive: false,
  } as const;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeCtx(opts: { account: typeof TEST_ACCOUNT | null }) {
    return {
      prisma: {
        vehicle: {
          findUniqueOrThrow: vi.fn().mockResolvedValue({ rego: "ESG40" }),
        },
        linktAccount: {
          findFirst: vi.fn().mockResolvedValue(opts.account),
          create: vi.fn().mockResolvedValue(TEST_ACCOUNT),
        },
      },
      session: { user: { id: "su1", role: "SUPER_ADMIN" } },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      reqId: "r1",
    };
  }

  test("forwards a LinktTripRow to the production matching pipeline", async () => {
    upsertInfringementFromRow.mockResolvedValueOnce("created");
    const ctx = makeCtx({ account: TEST_ACCOUNT });
    const c = devToolsRouter.createCaller(ctx as never);

    const eventAt = new Date("2026-04-28T04:10:00Z");
    const out = await c.injectToll({
      vehicleId: "veh_esg40",
      eventAt,
      amountCents: 450,
      tollpoint: "M4-EAST",
    });

    expect(upsertInfringementFromRow).toHaveBeenCalledTimes(1);
    const [, row, account] = upsertInfringementFromRow.mock.calls[0]!;
    expect(row).toMatchObject({
      eventAt,
      plate: "ESG40",
      tollpoint: "M4-EAST",
      amountCents: 450,
      rawDetails: "Injected by test-data panel",
    });
    expect(typeof row.externalHash).toBe("string");
    expect(row.externalHash).toMatch(/^test-/);
    expect(account).toBe(TEST_ACCOUNT);
    expect(out).toEqual({ result: "created", externalHash: row.externalHash });
    expect(ctx.prisma.linktAccount.create).not.toHaveBeenCalled();
  });

  test("creates the dedicated test account on first use", async () => {
    upsertInfringementFromRow.mockResolvedValueOnce("unmatched");
    const ctx = makeCtx({ account: null });
    const c = devToolsRouter.createCaller(ctx as never);

    const out = await c.injectToll({
      vehicleId: "veh_esg40",
      eventAt: new Date("2026-04-28T04:10:00Z"),
      amountCents: 450,
    });

    expect(ctx.prisma.linktAccount.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: "Test injections",
          isActive: false,
        }),
      }),
    );
    // tollpoint defaults to "TEST" so unmatched rows still display a value.
    const [, row] = upsertInfringementFromRow.mock.calls[0]!;
    expect(row.tollpoint).toBe("TEST");
    expect(out.result).toBe("unmatched");
  });
});
