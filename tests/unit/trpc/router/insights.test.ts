import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";

vi.mock("@/server/services/insights/orchestrator", () => ({
  generateInsightsOverview: vi.fn(),
  generatePayload: vi.fn(),
}));

vi.mock("@/server/services/insights/cache", () => ({
  readOverviewCache: vi.fn(),
  writeOverviewCache: vi.fn(),
  invalidateOverviewCache: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn().mockResolvedValue({ ok: true }),
}));

import { insightsRouter } from "@/server/trpc/router/insights";
import {
  generateInsightsOverview,
  generatePayload,
} from "@/server/services/insights/orchestrator";
import {
  invalidateOverviewCache,
  readOverviewCache,
  writeOverviewCache,
} from "@/server/services/insights/cache";
import { InsightsDataInsufficientError } from "@/server/services/insights/readiness";

type Caller = ReturnType<typeof insightsRouter.createCaller>;

function buildCtx(role: "MANAGER" | "ADMIN" = "ADMIN", depotId: string | null = null) {
  return {
    prisma: {
      depot: { findUnique: vi.fn().mockResolvedValue({ name: "All depots" }) },
    },
    user: { id: "u1", role, depotId },
    session: { user: { id: "u1", role, depotId } },
  } as unknown as Parameters<Caller["overview"]>[0];
}

function caller(ctx: unknown): Caller {
  return insightsRouter.createCaller(ctx as never);
}

const insufficient = {
  cards: [],
  generatedAt: new Date().toISOString(),
  scopeLabel: "All depots",
  stale: false,
  readiness: {
    sufficient: false,
    missing: [
      { key: "completedBookings", label: "Completed bookings", have: 0, need: 10 },
    ],
  },
};

const sufficient = {
  cards: [],
  generatedAt: new Date().toISOString(),
  scopeLabel: "All depots",
  stale: false,
  readiness: { sufficient: true, missing: [] },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(readOverviewCache).mockResolvedValue(null);
});

describe("insights.overview", () => {
  it("short-circuits to readiness failure without caching when data is insufficient", async () => {
    vi.mocked(generateInsightsOverview).mockResolvedValue(insufficient as never);

    const res = await caller(buildCtx()).overview();
    expect(res.readiness.sufficient).toBe(false);
    expect(res.cards).toEqual([]);
    expect(generateInsightsOverview).toHaveBeenCalledOnce();
    expect(writeOverviewCache).not.toHaveBeenCalled();
    expect(invalidateOverviewCache).toHaveBeenCalledOnce();
  });

  it("caches the overview when readiness is sufficient", async () => {
    vi.mocked(generateInsightsOverview).mockResolvedValue(sufficient as never);

    await caller(buildCtx()).overview();
    expect(writeOverviewCache).toHaveBeenCalledOnce();
    expect(invalidateOverviewCache).not.toHaveBeenCalled();
  });

  it("ignores a cached insufficient entry and regenerates", async () => {
    vi.mocked(readOverviewCache).mockResolvedValue(insufficient as never);
    vi.mocked(generateInsightsOverview).mockResolvedValue(sufficient as never);

    await caller(buildCtx()).overview();
    expect(generateInsightsOverview).toHaveBeenCalledOnce();
  });
});

describe("insights.detail", () => {
  it("maps InsightsDataInsufficientError to PRECONDITION_FAILED", async () => {
    vi.mocked(generatePayload).mockRejectedValue(
      new InsightsDataInsufficientError({
        sufficient: false,
        missing: [],
      }),
    );

    await expect(
      caller(buildCtx()).detail({ id: "repeat-cohort" }),
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });

  it("re-throws non-readiness errors unchanged", async () => {
    vi.mocked(generatePayload).mockRejectedValue(
      new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "boom" }),
    );

    await expect(
      caller(buildCtx()).detail({ id: "repeat-cohort" }),
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
});
