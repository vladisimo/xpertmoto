export const LOCKOUT_THRESHOLD = 5;
export const LOCKOUT_DURATION_MS = 30 * 60 * 1000; // 30 minutes

export interface LockoutUpdate {
  failedLoginCount: number;
  lockedUntil?: Date;
  lastFailedLoginAt: Date;
  locked: boolean;
}

/**
 * Pure decision: given the user's current failedLoginCount and the clock,
 * return the DB update and whether this attempt tripped the lockout.
 * Extracted so the logic is trivially unit-testable without NextAuth in
 * the import graph.
 */
export function computeLockoutUpdate(
  currentCount: number,
  now: Date = new Date(),
): LockoutUpdate {
  const nextCount = currentCount + 1;
  const shouldLock = nextCount >= LOCKOUT_THRESHOLD;
  return {
    failedLoginCount: shouldLock ? 0 : nextCount,
    lockedUntil: shouldLock ? new Date(now.getTime() + LOCKOUT_DURATION_MS) : undefined,
    lastFailedLoginAt: now,
    locked: shouldLock,
  };
}
