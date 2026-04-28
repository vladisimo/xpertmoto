import { describe, expect, it } from "vitest";
import {
  emptyBucket,
  percentile,
  recordRow,
  summariseBucket,
  upsertBucket,
} from "@/lib/tasks/metrics";
import { compareVirtualTasks } from "@/lib/tasks/tiers";
import { decodeTaskId, encodeTaskId, type VirtualTask } from "@/lib/tasks/types";

describe("metrics.percentile", () => {
  it("returns 0 for empty input", () => {
    expect(percentile([], 0.5)).toBe(0);
  });
  it("returns a representative value for small sorted arrays", () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(3);
    expect(percentile([1, 2, 3, 4], 0.95)).toBe(4);
  });
});

describe("metrics.recordRow + summariseBucket", () => {
  it("separates COMPLETED durations from SUPERSEDED/ABANDONED counts", () => {
    const b = emptyBucket();
    recordRow(b, "COMPLETED", 60);
    recordRow(b, "COMPLETED", 120);
    recordRow(b, "SUPERSEDED", 9999);
    recordRow(b, "ABANDONED", 9999);
    const s = summariseBucket(b);
    expect(s.total).toBe(4);
    expect(s.completed).toBe(2);
    expect(s.superseded).toBe(1);
    expect(s.abandoned).toBe(1);
    expect(s.avgSeconds).toBe(90); // (60 + 120) / 2
    expect(s.abandonRate).toBeCloseTo(0.25);
    expect(s.supersedeRate).toBeCloseTo(0.25);
  });

  it("returns zeros for an empty bucket", () => {
    expect(summariseBucket(emptyBucket())).toMatchObject({
      total: 0,
      avgSeconds: 0,
      abandonRate: 0,
    });
  });
});

describe("metrics.upsertBucket", () => {
  it("creates on first hit and reuses on subsequent hits", () => {
    const m = new Map<string, ReturnType<typeof emptyBucket>>();
    const a = upsertBucket(m, "k", emptyBucket);
    const b = upsertBucket(m, "k", emptyBucket);
    expect(a).toBe(b);
  });
});

describe("compareVirtualTasks", () => {
  const mk = (tier: VirtualTask["tier"], at: string): VirtualTask => ({
    taskType: "BOOKING_PICKUP",
    targetEntityKind: "Booking",
    targetEntityId: at,
    tier,
    depotId: null,
    title: "",
    actionUrl: "",
    actionableSince: new Date(at),
  });

  it("sorts URGENT before HIGH before MEDIUM before LOW", () => {
    const arr = [mk("LOW", "2026-04-01"), mk("URGENT", "2026-04-02"), mk("HIGH", "2026-04-03")];
    arr.sort(compareVirtualTasks);
    expect(arr.map((t) => t.tier)).toEqual(["URGENT", "HIGH", "LOW"]);
  });

  it("within a tier, oldest-first wins", () => {
    const arr = [mk("HIGH", "2026-04-05"), mk("HIGH", "2026-04-02"), mk("HIGH", "2026-04-04")];
    arr.sort(compareVirtualTasks);
    expect(arr.map((t) => t.targetEntityId)).toEqual([
      "2026-04-02",
      "2026-04-04",
      "2026-04-05",
    ]);
  });
});

describe("composedId encode/decode", () => {
  it("round-trips a composite id", () => {
    const id = encodeTaskId("BOOKING_PICKUP", "bkg_abc");
    expect(id).toBe("BOOKING_PICKUP:bkg_abc");
    expect(decodeTaskId(id)).toEqual({ taskType: "BOOKING_PICKUP", targetEntityId: "bkg_abc" });
  });

  it("rejects malformed composite ids", () => {
    expect(() => decodeTaskId("no-colon")).toThrow();
  });
});
