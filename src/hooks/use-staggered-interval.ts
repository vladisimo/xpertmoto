"use client";

import * as React from "react";

/**
 * A polling interval with per-mount jitter. Components that poll on the
 * same round number (the staff-tasks queue + my-active queries both sat
 * on exactly 30s) fire in lock-step — every open tab hits the server in
 * the same instant, forever. Adding up to `jitterMs` of random offset at
 * mount de-synchronises the herd without changing perceived freshness.
 */
export function useStaggeredInterval(baseMs: number, jitterMs = 5_000): number {
  const [interval] = React.useState(() => baseMs + Math.floor(Math.random() * jitterMs));
  return interval;
}
