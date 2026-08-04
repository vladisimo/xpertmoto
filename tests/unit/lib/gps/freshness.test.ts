import { describe, it, expect } from "vitest";
import {
  STALE_AFTER_SECONDS,
  OFFLINE_AFTER_SECONDS,
  secondsSince,
  freshnessState,
  isStale,
} from "@/lib/gps/freshness";

const now = new Date("2026-07-05T12:00:00Z");
const ago = (sec: number) => new Date(now.getTime() - sec * 1000);

describe("secondsSince", () => {
  it("measures elapsed seconds and never goes negative", () => {
    expect(secondsSince(ago(90), now)).toBe(90);
    expect(secondsSince(new Date(now.getTime() + 5000), now)).toBe(0); // future clamps to 0
  });
});

describe("freshnessState", () => {
  it("classifies live / stale / offline against the thresholds", () => {
    expect(freshnessState(ago(60), now)).toBe("live");
    expect(freshnessState(ago(STALE_AFTER_SECONDS + 1), now)).toBe("stale");
    expect(freshnessState(ago(OFFLINE_AFTER_SECONDS + 1), now)).toBe("offline");
  });

  it("is inclusive at the boundary (exactly the threshold is still the lower state)", () => {
    expect(freshnessState(ago(STALE_AFTER_SECONDS), now)).toBe("live");
    expect(freshnessState(ago(OFFLINE_AFTER_SECONDS), now)).toBe("stale");
  });
});

describe("isStale", () => {
  it("is true past the stale threshold", () => {
    expect(isStale(ago(STALE_AFTER_SECONDS - 1), now)).toBe(false);
    expect(isStale(ago(STALE_AFTER_SECONDS + 1), now)).toBe(true);
  });
});
