import { describe, expect, test } from "vitest";
import {
  computeLockoutUpdate,
  LOCKOUT_DURATION_MS,
  LOCKOUT_THRESHOLD,
} from "@/lib/auth-lockout";

const NOW = new Date("2026-04-18T12:00:00.000Z");

describe("computeLockoutUpdate", () => {
  test("does not lock below threshold; increments counter", () => {
    for (let current = 0; current < LOCKOUT_THRESHOLD - 1; current++) {
      const result = computeLockoutUpdate(current, NOW);
      expect(result.locked).toBe(false);
      expect(result.failedLoginCount).toBe(current + 1);
      expect(result.lockedUntil).toBeUndefined();
      expect(result.lastFailedLoginAt).toEqual(NOW);
    }
  });

  test("locks on the Nth attempt at threshold; resets counter", () => {
    // counter=4 (4 previous failures), this is attempt 5 → lock
    const result = computeLockoutUpdate(LOCKOUT_THRESHOLD - 1, NOW);
    expect(result.locked).toBe(true);
    expect(result.failedLoginCount).toBe(0);
    expect(result.lockedUntil).toEqual(new Date(NOW.getTime() + LOCKOUT_DURATION_MS));
  });

  test("stays locked if called again above threshold (defence-in-depth)", () => {
    const result = computeLockoutUpdate(LOCKOUT_THRESHOLD + 3, NOW);
    expect(result.locked).toBe(true);
    expect(result.lockedUntil).toBeInstanceOf(Date);
  });
});
