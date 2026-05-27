import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The job module pulls in prisma / queue at import time; stub the
// side-effecting deps so we can unit-test the pull + parse in isolation.
const upsert = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: { observabilityUsageSnapshot: { upsert: (args: unknown) => upsert(args) } },
}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/server/jobs/queue", () => ({ getQueue: vi.fn(), registerWorker: vi.fn() }));

import { runPlatformSentryStats, backfillSentryStats } from "@/server/jobs/platform-sentry-stats";

// A stats-summary payload with `accepted` usage for the requested category.
const summary = (category: string, accepted: number) => ({
  start: "2026-05-25T00:00:00Z",
  end: "2026-05-26T00:00:00Z",
  projects: [
    {
      id: 1,
      slug: "javascript-nextjs",
      stats: [{ category, outcomes: { accepted, filtered: 0, invalid: 1 }, totals: { "sum(quantity)": accepted + 1 } }],
    },
  ],
});

describe("runPlatformSentryStats", () => {
  beforeEach(() => {
    upsert.mockReset();
    process.env.SENTRY_AUTH_TOKEN = "tok";
    process.env.SENTRY_ORG_SLUG = "dfortixai";
    delete process.env.SENTRY_API_BASE_URL;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("no-ops when env is missing", async () => {
    delete process.env.SENTRY_AUTH_TOKEN;
    const result = await runPlatformSentryStats();
    expect(result.snapshotted).toBe(0);
    expect(result.skipped).toMatch(/SENTRY_AUTH_TOKEN/);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("parses the stats-summary shape and upserts accepted quantity per category", async () => {
    const byCategory: Record<string, number> = {
      error: 26,
      transaction: 4557,
      replay: 0,
      attachment: 0,
    };
    const fetchMock = vi.fn(async (url: string) => {
      const category = new URL(url).searchParams.get("category")!;
      return new Response(JSON.stringify(summary(category, byCategory[category] ?? 0)), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runPlatformSentryStats();

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(result.snapshotted).toBe(4);
    expect(upsert).toHaveBeenCalledTimes(4);

    const written = Object.fromEntries(
      upsert.mock.calls.map(([args]) => [args.create.metric, args.create.quantity]),
    );
    expect(written).toEqual({
      error: 26n,
      transaction: 4557n,
      replay: 0n,
      attachment: 0n,
    });
  });

  it("sums accepted across multiple projects, ignoring foreign categories", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const category = new URL(url).searchParams.get("category")!;
      if (category !== "error") return new Response(JSON.stringify(summary(category, 0)), { status: 200 });
      return new Response(
        JSON.stringify({
          start: "x",
          end: "y",
          projects: [
            { id: 1, slug: "a", stats: [{ category: "error", outcomes: { accepted: 10 }, totals: {} }] },
            { id: 2, slug: "b", stats: [{ category: "error", outcomes: { accepted: 5 }, totals: {} }] },
            // a foreign category leaking into the same response must be ignored
            { id: 3, slug: "c", stats: [{ category: "transaction", outcomes: { accepted: 999 }, totals: {} }] },
          ],
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await runPlatformSentryStats();

    const errorCall = upsert.mock.calls.find(([a]) => a.create.metric === "error")!;
    expect(errorCall[0].create.quantity).toBe(15n);
  });

  it("skips a category on a non-OK response instead of throwing", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const category = new URL(url).searchParams.get("category")!;
      if (category === "error") return new Response("nope", { status: 500 });
      return new Response(JSON.stringify(summary(category, 1)), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runPlatformSentryStats();

    expect(result.snapshotted).toBe(3);
    expect(upsert).toHaveBeenCalledTimes(3);
    expect(upsert.mock.calls.some(([a]) => a.create.metric === "error")).toBe(false);
  });
});

describe("backfillSentryStats", () => {
  beforeEach(() => {
    upsert.mockReset();
    process.env.SENTRY_AUTH_TOKEN = "tok";
    process.env.SENTRY_ORG_SLUG = "dfortixai";
    delete process.env.SENTRY_API_BASE_URL;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("no-ops without env", async () => {
    delete process.env.SENTRY_ORG_SLUG;
    const result = await backfillSentryStats(7);
    expect(result.snapshotted).toBe(0);
    expect(result.skipped).toBeTruthy();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("walks one day per offset oldest→newest and upserts 4 metrics each", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const category = new URL(url).searchParams.get("category")!;
      return new Response(JSON.stringify(summary(category, 1)), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await backfillSentryStats(3);

    // 3 days × 4 metrics
    expect(result.days).toBe(3);
    expect(result.snapshotted).toBe(12);
    expect(upsert).toHaveBeenCalledTimes(12);

    // distinct dates, ascending, ending yesterday (none is today)
    const dates = [...new Set(upsert.mock.calls.map(([a]) => a.create.date.toISOString().slice(0, 10)))];
    expect(dates).toHaveLength(3);
    expect([...dates].sort()).toEqual(dates); // already oldest→newest
    expect(result.from).toBe(dates[0]);
    expect(result.to).toBe(dates[2]);
    const todayUtc = new Date().toISOString().slice(0, 10);
    expect(dates).not.toContain(todayUtc);
  });
});
