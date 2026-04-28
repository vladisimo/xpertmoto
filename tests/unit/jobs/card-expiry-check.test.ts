import { describe, expect, test } from "vitest";
import { cardExpiresBy } from "@/server/jobs/card-expiry-check";

describe("cardExpiresBy", () => {
  test("card valid through the END of its expiry month", () => {
    // Card with exp 12/2027 is still valid on 2027-12-31.
    const dec31 = new Date(Date.UTC(2027, 11, 31, 23, 59, 59));
    expect(cardExpiresBy(12, 2027, dec31)).toBe(false);
  });

  test("card expires at midnight UTC on the 1st of the following month", () => {
    // 12/2027 card — expired by 2028-01-01 00:00.
    const jan1 = new Date(Date.UTC(2028, 0, 1));
    expect(cardExpiresBy(12, 2027, jan1)).toBe(true);
  });

  test("future horizon — 30 days from today, card expiring in 60 days is still valid", () => {
    const now = new Date();
    const horizon30 = new Date(now.getTime() + 30 * 86_400_000);
    const futureMonth = (now.getUTCMonth() + 2) % 12;
    const futureYear = now.getUTCFullYear() + (now.getUTCMonth() + 2 >= 12 ? 1 : 0);
    // Card expires at start of (futureMonth + 1), still valid through end
    // of futureMonth — compare against horizon30 which is well before.
    expect(cardExpiresBy(futureMonth + 1, futureYear, horizon30)).toBe(false);
  });

  test("past card — expired relative to any future horizon", () => {
    const horizon = new Date();
    expect(cardExpiresBy(1, 2020, horizon)).toBe(true);
  });
});
