import { describe, expect, it } from "vitest";
import {
  emptyTimingBucket,
  recordRowWithTimings,
  summariseBucketWithTimings,
  upsertBucket,
} from "@/lib/tasks/metrics";
import {
  compareHistoryRows,
  enrichHistoryRow,
  type HistoryRawRow,
} from "@/lib/tasks/history";

const baseRaw: HistoryRawRow = {
  id: "act-1",
  taskType: "BOOKING_PICKUP",
  status: "COMPLETED",
  outcome: "closed_by_claimant",
  outcomeNote: null,
  startedAt: new Date("2026-04-17T10:00:00Z"),
  completedAt: new Date("2026-04-17T10:12:00Z"),
  actionableSinceSnapshot: new Date("2026-04-17T09:30:00Z"),
  staffId: "staff-a",
  staffFirstName: "Alex",
  staffLastName: "Park",
  depotId: "depot-gc",
  targetEntityKind: "Booking",
  targetEntityId: "book-1",
  tierSnapshot: "HIGH",
};

describe("enrichHistoryRow", () => {
  it("computes workSec from startedAt → completedAt", () => {
    const r = enrichHistoryRow(baseRaw);
    expect(r.workSec).toBe(12 * 60);
    expect(r.staffName).toBe("Alex Park");
  });

  it("computes waitSec from actionableSinceSnapshot → startedAt", () => {
    const r = enrichHistoryRow(baseRaw);
    expect(r.waitSec).toBe(30 * 60);
  });

  it("computes cycleSec from actionableSinceSnapshot → completedAt", () => {
    const r = enrichHistoryRow(baseRaw);
    expect(r.cycleSec).toBe(42 * 60);
  });

  it("returns null wait/cycle when actionableSinceSnapshot is missing", () => {
    const r = enrichHistoryRow({ ...baseRaw, actionableSinceSnapshot: null });
    expect(r.waitSec).toBeNull();
    expect(r.cycleSec).toBeNull();
    // work is unaffected — it only needs start + complete
    expect(r.workSec).toBe(12 * 60);
  });

  it("clamps negative durations to 0 (clock skew defensive)", () => {
    const r = enrichHistoryRow({
      ...baseRaw,
      startedAt: new Date("2026-04-17T10:00:00Z"),
      completedAt: new Date("2026-04-17T09:58:00Z"),
    });
    expect(r.workSec).toBe(0);
  });
});

describe("compareHistoryRows", () => {
  const mk = (over: Partial<HistoryRawRow>): ReturnType<typeof enrichHistoryRow> =>
    enrichHistoryRow({ ...baseRaw, ...over });

  it("sorts by completedAt desc by default ordering", () => {
    const rows = [
      mk({ id: "a", completedAt: new Date("2026-04-17T09:00:00Z") }),
      mk({ id: "b", completedAt: new Date("2026-04-17T11:00:00Z") }),
      mk({ id: "c", completedAt: new Date("2026-04-17T10:00:00Z") }),
    ];
    rows.sort(compareHistoryRows("completedAt", "desc"));
    expect(rows.map((r) => r.id)).toEqual(["b", "c", "a"]);
  });

  it("sorts by workSec asc", () => {
    const rows = [
      mk({
        id: "a",
        startedAt: new Date("2026-04-17T10:00:00Z"),
        completedAt: new Date("2026-04-17T10:20:00Z"),
      }),
      mk({
        id: "b",
        startedAt: new Date("2026-04-17T10:00:00Z"),
        completedAt: new Date("2026-04-17T10:05:00Z"),
      }),
    ];
    rows.sort(compareHistoryRows("workSec", "asc"));
    expect(rows.map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("treats null cycleSec as lowest when sorting desc", () => {
    const rows = [
      mk({ id: "a", actionableSinceSnapshot: null }),
      mk({
        id: "b",
        actionableSinceSnapshot: new Date("2026-04-17T09:00:00Z"),
      }),
    ];
    rows.sort(compareHistoryRows("cycleSec", "desc"));
    expect(rows.map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("sorts by staff name alphabetically", () => {
    const rows = [
      mk({ id: "a", staffFirstName: "Zoe", staffLastName: "Lim" }),
      mk({ id: "b", staffFirstName: "Alex", staffLastName: "Park" }),
    ];
    rows.sort(compareHistoryRows("staff", "asc"));
    expect(rows.map((r) => r.id)).toEqual(["b", "a"]);
  });
});

describe("recordRowWithTimings + summariseBucketWithTimings", () => {
  it("captures wait + cycle for completed rows only", () => {
    const b = emptyTimingBucket();
    recordRowWithTimings(b, "COMPLETED", 60, 30, 90);
    recordRowWithTimings(b, "COMPLETED", 120, 60, 180);
    recordRowWithTimings(b, "ABANDONED", 45, 10, 55);
    recordRowWithTimings(b, "SUPERSEDED", 45, 10, 55);

    const s = summariseBucketWithTimings(b);
    expect(s.total).toBe(4);
    expect(s.completed).toBe(2);
    expect(s.abandoned).toBe(1);
    expect(s.superseded).toBe(1);
    // Work durations include only completed rows (60, 120 → avg 90)
    expect(s.avgSeconds).toBe(90);
    expect(s.waitAvgSeconds).toBe(45);
    expect(s.cycleAvgSeconds).toBe(135);
  });

  it("skips null wait/cycle gracefully", () => {
    const b = emptyTimingBucket();
    recordRowWithTimings(b, "COMPLETED", 60, null, null);
    recordRowWithTimings(b, "COMPLETED", 120, 60, 180);
    const s = summariseBucketWithTimings(b);
    expect(s.completed).toBe(2);
    expect(s.waitAvgSeconds).toBe(60);
    expect(s.cycleAvgSeconds).toBe(180);
  });

  it("returns zero timings for an empty bucket", () => {
    const s = summariseBucketWithTimings(emptyTimingBucket());
    expect(s.total).toBe(0);
    expect(s.waitAvgSeconds).toBe(0);
    expect(s.cycleAvgSeconds).toBe(0);
    expect(s.cycleP50Seconds).toBe(0);
    expect(s.cycleP95Seconds).toBe(0);
  });

  it("aggregates across a Map via upsertBucket for per-staff rollup", () => {
    const m = new Map<string, ReturnType<typeof emptyTimingBucket>>();
    recordRowWithTimings(upsertBucket(m, "alex", emptyTimingBucket), "COMPLETED", 60, 30, 90);
    recordRowWithTimings(upsertBucket(m, "alex", emptyTimingBucket), "COMPLETED", 120, 60, 180);
    recordRowWithTimings(upsertBucket(m, "zoe", emptyTimingBucket), "COMPLETED", 300, 10, 310);
    const summaries = new Map(
      [...m.entries()].map(([k, b]) => [k, summariseBucketWithTimings(b)]),
    );
    expect(summaries.get("alex")?.completed).toBe(2);
    expect(summaries.get("alex")?.avgSeconds).toBe(90);
    expect(summaries.get("zoe")?.completed).toBe(1);
    expect(summaries.get("zoe")?.avgSeconds).toBe(300);
  });
});
