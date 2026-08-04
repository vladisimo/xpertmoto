/**
 * Shared GPS freshness thresholds. Client-safe (no server imports) so the live
 * map, the sidebar list, and the server-side freshness/alerting job all agree on
 * what "stale" and "offline" mean. The poll runs every 60s, so a fix older than
 * STALE_AFTER_SECONDS means ~15 consecutive polls saw no update for that device.
 */

export const STALE_AFTER_SECONDS = 15 * 60; // 15 min → tracker likely dropped off
export const OFFLINE_AFTER_SECONDS = 60 * 60; // 1h → treat as offline

export function secondsSince(timestamp: Date, now: Date = new Date()): number {
  return Math.max(0, Math.round((now.getTime() - timestamp.getTime()) / 1000));
}

export type FreshnessState = "live" | "stale" | "offline";

export function freshnessState(timestamp: Date, now: Date = new Date()): FreshnessState {
  const age = secondsSince(timestamp, now);
  if (age > OFFLINE_AFTER_SECONDS) return "offline";
  if (age > STALE_AFTER_SECONDS) return "stale";
  return "live";
}

export function isStale(timestamp: Date, now: Date = new Date()): boolean {
  return secondsSince(timestamp, now) > STALE_AFTER_SECONDS;
}
