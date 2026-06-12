import { describe, it, expect, vi, beforeEach } from "vitest";

const invalidateTags = vi.fn();
vi.mock("@/lib/cache", () => ({
  invalidateTags: (...a: unknown[]) => invalidateTags(...a),
}));

import {
  availabilityTags,
  invalidateAvailability,
} from "@/server/services/availability-cache";

beforeEach(() => {
  invalidateTags.mockReset();
});

describe("availabilityTags", () => {
  it("tags one entry per UTC day in the span plus the coarse all-depots tag", () => {
    const tags = availabilityTags(
      "depot1",
      new Date("2026-06-14T22:00:00Z"),
      new Date("2026-06-16T06:00:00Z"),
    );
    expect(tags).toEqual([
      "availability:all",
      "availability:depot1:2026-06-14",
      "availability:depot1:2026-06-15",
      "availability:depot1:2026-06-16",
    ]);
  });

  it("uses only the coarse tag for all-depot searches", () => {
    const tags = availabilityTags(undefined, new Date(), new Date());
    expect(tags).toEqual(["availability:all"]);
  });

  it("caps day tags for multi-month hires (TTL covers the tail)", () => {
    const tags = availabilityTags(
      "depot1",
      new Date("2026-01-01T00:00:00Z"),
      new Date("2026-12-31T00:00:00Z"),
    );
    // 60 day tags + the coarse tag.
    expect(tags).toHaveLength(61);
  });
});

describe("invalidateAvailability", () => {
  it("invalidates the coarse tag and the touched depot+day tags", async () => {
    await invalidateAvailability(
      "depot1",
      new Date("2026-06-14T00:00:00Z"),
      new Date("2026-06-15T00:00:00Z"),
    );
    expect(invalidateTags).toHaveBeenCalledWith([
      "availability:all",
      "availability:depot1:2026-06-14",
      "availability:depot1:2026-06-15",
    ]);
  });
});
