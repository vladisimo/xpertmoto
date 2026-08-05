import { test, expect } from "vitest";
import { formatCurrency } from "../src/lib/utils";
import { generateBookingReference } from "../src/lib/id-gen";

test("formatCurrency uses AUD locale", () => {
  expect(formatCurrency(49)).toBe("$49.00");
  expect(formatCurrency(1234.5)).toBe("$1,234.50");
});

test("generateBookingReference matches SCT-YYYYMMDD-XXXXXX", () => {
  // Crockford-lite alphabet (no 0/O/1/I) × 6 chars gives ~10^9 combos/day,
  // dwarfing the prior 4-digit numeric pool (10^4) that was collision-prone
  // under concurrent booking confirmations. See src/lib/id-gen.ts.
  const ref = generateBookingReference();
  expect(ref).toMatch(/^SCT-\d{8}-[A-HJ-NP-Z2-9]{6}$/);
});

test("generateBookingReference is collision-resistant across many calls", () => {
  // 5000 draws from the 32^6 (~1.07e9) same-day pool collide with ~1.2%
  // probability per run (birthday bound) — demanding zero collisions makes
  // this test flake about one CI run in 85. Tolerating a single collision
  // drops the false-failure rate below 1 in 10^4 while still failing
  // instantly on any regression toward a small pool (the old 4-digit pool
  // would produce ~1200 collisions here).
  const seen = new Set<string>();
  for (let i = 0; i < 5000; i++) {
    seen.add(generateBookingReference());
  }
  expect(seen.size).toBeGreaterThanOrEqual(4999);
});
