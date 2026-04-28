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
  const seen = new Set<string>();
  for (let i = 0; i < 5000; i++) {
    seen.add(generateBookingReference());
  }
  expect(seen.size).toBe(5000);
});
