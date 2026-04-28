import type { StaffTaskActivityStatus } from "@prisma/client";

export interface MetricsBucket {
  total: number;
  completed: number;
  superseded: number;
  abandoned: number;
  durations: number[];
  waitDurations?: number[];
  cycleDurations?: number[];
}

export function emptyBucket(): MetricsBucket {
  return { total: 0, completed: 0, superseded: 0, abandoned: 0, durations: [] };
}

export function emptyTimingBucket(): MetricsBucket {
  return {
    total: 0,
    completed: 0,
    superseded: 0,
    abandoned: 0,
    durations: [],
    waitDurations: [],
    cycleDurations: [],
  };
}

export function upsertBucket<K, V>(map: Map<K, V>, key: K, make: () => V): V {
  let v = map.get(key);
  if (!v) {
    v = make();
    map.set(key, v);
  }
  return v;
}

export function recordRow(
  bucket: MetricsBucket,
  status: StaffTaskActivityStatus,
  durationSec: number,
) {
  bucket.total += 1;
  if (status === "COMPLETED") {
    bucket.completed += 1;
    bucket.durations.push(durationSec);
  } else if (status === "SUPERSEDED") {
    bucket.superseded += 1;
  } else if (status === "ABANDONED") {
    bucket.abandoned += 1;
  }
}

export function recordRowWithTimings(
  bucket: MetricsBucket,
  status: StaffTaskActivityStatus,
  workSec: number,
  waitSec: number | null,
  cycleSec: number | null,
) {
  recordRow(bucket, status, workSec);
  if (status !== "COMPLETED") return;
  if (waitSec !== null && bucket.waitDurations) bucket.waitDurations.push(waitSec);
  if (cycleSec !== null && bucket.cycleDurations) bucket.cycleDurations.push(cycleSec);
}

/**
 * Nearest-rank percentile on a pre-sorted ascending array. Empty array → 0.
 */
export function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.floor(p * sortedAsc.length));
  return sortedAsc[idx] ?? 0;
}

export interface MetricsSummary {
  total: number;
  completed: number;
  superseded: number;
  abandoned: number;
  avgSeconds: number;
  p50Seconds: number;
  p95Seconds: number;
  abandonRate: number;
  supersedeRate: number;
}

export interface MetricsSummaryWithTimings extends MetricsSummary {
  waitAvgSeconds: number;
  waitP50Seconds: number;
  waitP95Seconds: number;
  cycleAvgSeconds: number;
  cycleP50Seconds: number;
  cycleP95Seconds: number;
}

export function summariseBucket(b: MetricsBucket): MetricsSummary {
  const sorted = [...b.durations].sort((a, c) => a - c);
  const avg = sorted.length ? sorted.reduce((s, x) => s + x, 0) / sorted.length : 0;
  return {
    total: b.total,
    completed: b.completed,
    superseded: b.superseded,
    abandoned: b.abandoned,
    avgSeconds: Math.round(avg),
    p50Seconds: Math.round(percentile(sorted, 0.5)),
    p95Seconds: Math.round(percentile(sorted, 0.95)),
    abandonRate: b.total > 0 ? b.abandoned / b.total : 0,
    supersedeRate: b.total > 0 ? b.superseded / b.total : 0,
  };
}

export function summariseBucketWithTimings(b: MetricsBucket): MetricsSummaryWithTimings {
  const base = summariseBucket(b);
  const waits = [...(b.waitDurations ?? [])].sort((a, c) => a - c);
  const cycles = [...(b.cycleDurations ?? [])].sort((a, c) => a - c);
  const waitAvg = waits.length ? waits.reduce((s, x) => s + x, 0) / waits.length : 0;
  const cycleAvg = cycles.length ? cycles.reduce((s, x) => s + x, 0) / cycles.length : 0;
  return {
    ...base,
    waitAvgSeconds: Math.round(waitAvg),
    waitP50Seconds: Math.round(percentile(waits, 0.5)),
    waitP95Seconds: Math.round(percentile(waits, 0.95)),
    cycleAvgSeconds: Math.round(cycleAvg),
    cycleP50Seconds: Math.round(percentile(cycles, 0.5)),
    cycleP95Seconds: Math.round(percentile(cycles, 0.95)),
  };
}
