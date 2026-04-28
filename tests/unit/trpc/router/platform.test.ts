import { beforeEach, describe, expect, it, vi } from "vitest";
import { platformRouter } from "@/server/trpc/router/platform";

type Caller = ReturnType<typeof platformRouter.createCaller>;

type Role = "STAFF" | "MANAGER" | "ADMIN" | "SUPER_ADMIN";

/**
 * Build a prisma mock whose aggregate / count / groupBy / findMany calls
 * default to "empty" shapes. Each test can override the pieces it cares
 * about to exercise the live branch.
 */
function emptyPrisma() {
  const emptyAgg = {
    _count: { _all: 0 },
    _sum: {
      costAud: null,
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      cacheCreationTokens: 0,
      sampleWeight: 0,
      bytesOut: null,
      sizeBytes: BigInt(0),
      numSegments: 0,
      priceAud: null,
      amount: null,
      feeAmountCents: 0,
      netAmountCents: 0,
    },
  };
  return {
    $queryRawUnsafe: vi.fn().mockResolvedValue([]),
    auditLog: { create: vi.fn().mockResolvedValue({}) },

    supportCostLog: {
      aggregate: vi.fn().mockResolvedValue(emptyAgg),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    ocrCostLog: {
      aggregate: vi.fn().mockResolvedValue(emptyAgg),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    serverRequestLog: {
      aggregate: vi.fn().mockResolvedValue(emptyAgg),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    storageUsageEvent: {
      aggregate: vi.fn().mockResolvedValue(emptyAgg),
      groupBy: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    emailSendLog: {
      count: vi.fn().mockResolvedValue(0),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    twilioMessageLog: {
      count: vi.fn().mockResolvedValue(0),
      aggregate: vi.fn().mockResolvedValue(emptyAgg),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    stripeFeeLedger: {
      aggregate: vi.fn().mockResolvedValue(emptyAgg),
    },
    payment: {
      aggregate: vi.fn().mockResolvedValue(emptyAgg),
    },
    observabilityUsageSnapshot: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
}

function buildCtx(role: Role = "SUPER_ADMIN", prismaOverride?: Record<string, unknown>) {
  return {
    prisma: prismaOverride ?? emptyPrisma(),
    user: { id: "u_super", role, depotId: null },
    session: { user: { id: "u_super", role, depotId: null } },
    reqId: "test-req",
  } as unknown as Parameters<Caller["databaseStats"]>[0];
}

function caller(ctx: unknown): Caller {
  return platformRouter.createCaller(ctx as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("platform router · role gating", () => {
  const PROCS = [
    "databaseStats",
    "serverUsage",
    "storageUsage",
    "llmSummary",
    "emailUsage",
    "smsUsage",
    "paymentsUsage",
    "observabilityUsage",
  ] as const;

  for (const role of ["STAFF", "MANAGER", "ADMIN"] as const) {
    it(`rejects ${role} on every procedure with FORBIDDEN`, async () => {
      const c = caller(buildCtx(role)) as Record<string, () => Promise<unknown>>;
      for (const proc of PROCS) {
        const fn = c[proc]!;
        await expect(fn(), `${proc} should reject ${role}`).rejects.toMatchObject({
          code: "FORBIDDEN",
        });
      }
    });
  }

  it("allows SUPER_ADMIN on every procedure", async () => {
    const c = caller(buildCtx("SUPER_ADMIN")) as Record<string, () => Promise<unknown>>;
    for (const proc of PROCS) {
      const fn = c[proc]!;
      await expect(fn(), `${proc} should accept SUPER_ADMIN`).resolves.toBeDefined();
    }
  });
});

describe("platform.databaseStats · live / placeholder", () => {
  it("returns live dbSizeBytes when pg_database_size succeeds", async () => {
    const prisma = emptyPrisma();
    prisma.$queryRawUnsafe.mockResolvedValueOnce([{ db_size_bytes: BigInt(12345) }]);
    const res = await caller(buildCtx("SUPER_ADMIN", prisma)).databaseStats();
    expect(res.source).toBe("live");
    expect(res.dbSizeBytes).toBe(12345);
  });

  it("falls back to placeholder when the raw query throws", async () => {
    const prisma = emptyPrisma();
    prisma.$queryRawUnsafe.mockRejectedValueOnce(new Error("no pg here"));
    const res = await caller(buildCtx("SUPER_ADMIN", prisma)).databaseStats();
    expect(res.source).toBe("placeholder");
    expect(res.dbSizeBytes).toBeNull();
  });
});

describe("platform.serverUsage · live / placeholder", () => {
  it("marks placeholder with an enable hint when nothing is sampled", async () => {
    const res = await caller(buildCtx()).serverUsage();
    expect(res.source).toBe("placeholder");
    expect(res.reason).toMatch(/PLATFORM_REQUEST_LOGGING/);
    expect(res.topPaths30d).toEqual([]);
  });

  it("flips to live when samples exist and extrapolates via sampleWeight", async () => {
    const prisma = emptyPrisma();
    prisma.serverRequestLog.aggregate.mockResolvedValue({
      _count: { _all: 3 },
      _sum: { sampleWeight: 30, bytesOut: null },
    });
    prisma.serverRequestLog.groupBy.mockResolvedValue([
      { path: "/api/foo", _count: { _all: 3 }, _sum: { sampleWeight: 30 } },
    ]);
    const res = await caller(buildCtx("SUPER_ADMIN", prisma)).serverUsage();
    expect(res.source).toBe("live");
    expect(res.extrapolatedRequests30d).toBe(30);
    expect(res.sampledRequests30d).toBe(3);
    expect(res.topPaths30d).toHaveLength(1);
    expect(res.topPaths30d[0]).toMatchObject({
      path: "/api/foo",
      sampled: 3,
      extrapolated: 30,
    });
  });
});

describe("platform.storageUsage · live / placeholder", () => {
  it("placeholder when no events", async () => {
    const res = await caller(buildCtx()).storageUsage();
    expect(res.source).toBe("placeholder");
    expect(res.totalBytes).toBe(0);
    expect(res.byFolder).toEqual([]);
  });

  it("live when UPLOAD events exist; sums bytes and groups by folder", async () => {
    const prisma = emptyPrisma();
    prisma.storageUsageEvent.aggregate.mockResolvedValue({
      _sum: { sizeBytes: BigInt(1024 * 1024) },
      _count: { _all: 5 },
    });
    prisma.storageUsageEvent.groupBy.mockResolvedValue([
      { folder: "invoices", _sum: { sizeBytes: BigInt(700_000) }, _count: { _all: 3 } },
      { folder: "inspections", _sum: { sizeBytes: BigInt(324_576) }, _count: { _all: 2 } },
    ]);
    prisma.storageUsageEvent.count.mockResolvedValue(2);
    const res = await caller(buildCtx("SUPER_ADMIN", prisma)).storageUsage();
    expect(res.source).toBe("live");
    expect(res.totalBytes).toBe(1024 * 1024);
    expect(res.byFolder).toHaveLength(2);
    expect(res.byFolder[0]).toMatchObject({ folder: "invoices", events: 3 });
  });
});

describe("platform.llmSummary · support always live; ocr reflects usage", () => {
  it("returns zeros for both when empty — both still tagged live (tables exist)", async () => {
    const res = await caller(buildCtx()).llmSummary();
    expect(res.support.source).toBe("live");
    expect(res.support.costAud30d).toBe(0);
    expect(res.ocr.source).toBe("live");
    expect(res.ocr.costAud30d).toBe(0);
    expect(res.ocr.byModel30d).toEqual([]);
  });

  it("sums support + ocr cost and returns by-model breakdown", async () => {
    const prisma = emptyPrisma();
    prisma.supportCostLog.aggregate
      .mockResolvedValueOnce({ _count: { _all: 2 }, _sum: { costAud: 0.5 } })
      .mockResolvedValueOnce({ _count: { _all: 7 }, _sum: { costAud: 1.25 } })
      .mockResolvedValueOnce({ _count: { _all: 30 }, _sum: { costAud: 4 } });
    prisma.supportCostLog.groupBy.mockResolvedValue([
      {
        provider: "anthropic",
        model: "claude-haiku-4-5",
        _count: { _all: 30 },
        _sum: {
          costAud: 4,
          inputTokens: 1000,
          outputTokens: 500,
          cachedInputTokens: 0,
          cacheCreationTokens: 0,
        },
      },
    ]);
    prisma.ocrCostLog.aggregate
      .mockResolvedValueOnce({ _count: { _all: 1 }, _sum: { costAud: 0.05 } })
      .mockResolvedValueOnce({ _count: { _all: 4 }, _sum: { costAud: 0.22 } })
      .mockResolvedValueOnce({ _count: { _all: 15 }, _sum: { costAud: 0.8 } });
    prisma.ocrCostLog.groupBy.mockResolvedValue([
      {
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        kind: "LICENCE",
        _count: { _all: 10 },
        _sum: {
          costAud: 0.6,
          inputTokens: 2000,
          outputTokens: 200,
          cachedInputTokens: 0,
          cacheCreationTokens: 0,
        },
      },
    ]);

    const res = await caller(buildCtx("SUPER_ADMIN", prisma)).llmSummary();
    expect(res.support.costAud30d).toBe(4);
    expect(res.support.calls30d).toBe(30);
    expect(res.support.byModel30d[0]).toMatchObject({
      provider: "anthropic",
      model: "claude-haiku-4-5",
      inputTokens: 1000,
    });
    expect(res.ocr.costAud30d).toBe(0.8);
    expect(res.ocr.byModel30d[0]).toMatchObject({
      kind: "LICENCE",
      model: "claude-sonnet-4-6",
    });
  });
});

describe("platform.emailUsage · live / placeholder", () => {
  it("placeholder when no sends", async () => {
    const res = await caller(buildCtx()).emailUsage();
    expect(res.source).toBe("placeholder");
    expect(res.sent30d).toBe(0);
  });

  it("live when at least one send row exists", async () => {
    const prisma = emptyPrisma();
    prisma.emailSendLog.count
      .mockResolvedValueOnce(3) // sent24h
      .mockResolvedValueOnce(12) // sent7d
      .mockResolvedValueOnce(40) // sent30d
      .mockResolvedValueOnce(38) // delivered30d
      .mockResolvedValueOnce(2); // bounced30d
    prisma.emailSendLog.groupBy.mockResolvedValue([
      { provider: "resend", _count: { _all: 40 } },
    ]);
    const res = await caller(buildCtx("SUPER_ADMIN", prisma)).emailUsage();
    expect(res.source).toBe("live");
    expect(res.sent30d).toBe(40);
    expect(res.delivered30d).toBe(38);
    expect(res.bounced30d).toBe(2);
    expect(res.byProvider30d[0]).toMatchObject({ provider: "resend", count: 40 });
  });
});

describe("platform.smsUsage · live / placeholder", () => {
  it("placeholder when no sends", async () => {
    const res = await caller(buildCtx()).smsUsage();
    expect(res.source).toBe("placeholder");
    expect(res.sent30d).toBe(0);
  });

  it("live with segments + cost", async () => {
    const prisma = emptyPrisma();
    prisma.twilioMessageLog.count
      .mockResolvedValueOnce(5) // sent24h
      .mockResolvedValueOnce(20); // sent7d
    prisma.twilioMessageLog.aggregate.mockResolvedValue({
      _count: { _all: 80 },
      _sum: { numSegments: 112, priceAud: 6.4 },
    });
    prisma.twilioMessageLog.groupBy.mockResolvedValue([
      { status: "delivered", _count: { _all: 78 } },
      { status: "failed", _count: { _all: 2 } },
    ]);
    const res = await caller(buildCtx("SUPER_ADMIN", prisma)).smsUsage();
    expect(res.source).toBe("live");
    expect(res.sent30d).toBe(80);
    expect(res.segments30d).toBe(112);
    expect(res.costAud30d).toBe(6.4);
    expect(res.byStatus30d).toHaveLength(2);
  });
});

describe("platform.paymentsUsage · live / placeholder", () => {
  it("placeholder when ledger is empty", async () => {
    const res = await caller(buildCtx()).paymentsUsage();
    expect(res.source).toBe("placeholder");
    expect(res.feesAud30d).toBe(0);
    expect(res.effectiveFeePct).toBe(0);
  });

  it("live: converts cents → AUD and computes effective fee %", async () => {
    const prisma = emptyPrisma();
    prisma.stripeFeeLedger.aggregate.mockResolvedValue({
      _count: { _all: 100 },
      _sum: { feeAmountCents: 32_500, netAmountCents: 967_500 },
    });
    prisma.payment.aggregate.mockResolvedValue({
      _count: { _all: 100 },
      _sum: { amount: 10_000 }, // gross AUD
    });
    const res = await caller(buildCtx("SUPER_ADMIN", prisma)).paymentsUsage();
    expect(res.source).toBe("live");
    expect(res.feesAud30d).toBe(325);
    expect(res.netAud30d).toBe(9675);
    expect(res.grossProcessedAud).toBe(10_000);
    expect(res.effectiveFeePct).toBeCloseTo(3.25, 4);
  });
});

describe("platform.observabilityUsage · live / placeholder", () => {
  it("placeholder when no snapshots", async () => {
    const res = await caller(buildCtx()).observabilityUsage();
    expect(res.source).toBe("placeholder");
    expect(res.dailySeries).toEqual([]);
  });

  it("aggregates snapshots per metric", async () => {
    const prisma = emptyPrisma();
    prisma.observabilityUsageSnapshot.findMany.mockResolvedValue([
      {
        date: new Date("2026-04-20"),
        provider: "sentry",
        metric: "error",
        quantity: BigInt(1200),
        costAud: null,
      },
      {
        date: new Date("2026-04-21"),
        provider: "sentry",
        metric: "error",
        quantity: BigInt(900),
        costAud: null,
      },
      {
        date: new Date("2026-04-21"),
        provider: "sentry",
        metric: "transaction",
        quantity: BigInt(50_000),
        costAud: null,
      },
    ]);
    const res = await caller(buildCtx("SUPER_ADMIN", prisma)).observabilityUsage();
    expect(res.source).toBe("live");
    const byMetric = Object.fromEntries(res.metrics.map((m) => [m.metric, m.quantity]));
    expect(byMetric.error).toBe(2100);
    expect(byMetric.transaction).toBe(50_000);
    expect(res.dailySeries).toHaveLength(3);
  });
});
