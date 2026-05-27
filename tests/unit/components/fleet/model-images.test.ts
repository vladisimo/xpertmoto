import { describe, expect, it } from "vitest";
import { dedupeModelImages } from "../../../../src/components/fleet/model-images";

function img(id: string, url: string, checksum: string | null) {
  return { id, url, caption: null, checksum };
}

describe("dedupeModelImages", () => {
  it("collapses the same stock photo uploaded per-unit (distinct URLs, same checksum)", () => {
    const vehicles = [
      { images: [img("a", "/uploads/unit-1/x.png", "sha-1")] },
      { images: [img("b", "/uploads/unit-2/y.png", "sha-1")] },
      { images: [img("c", "/uploads/unit-3/z.png", "sha-1")] },
    ];
    const result = dedupeModelImages(vehicles);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("a"); // first occurrence wins
  });

  it("keeps genuinely distinct images", () => {
    const vehicles = [
      { images: [img("a", "/uploads/unit-1/x.png", "sha-1")] },
      { images: [img("b", "/uploads/unit-2/y.png", "sha-2")] },
    ];
    expect(dedupeModelImages(vehicles)).toHaveLength(2);
  });

  it("falls back to URL dedupe when checksum is null (not yet backfilled)", () => {
    const vehicles = [
      { images: [img("a", "/uploads/unit-1/x.png", null)] },
      { images: [img("b", "/uploads/unit-1/x.png", null)] }, // same URL
      { images: [img("c", "/uploads/unit-2/y.png", null)] }, // different URL, same picture — not collapsed without a checksum
    ];
    const result = dedupeModelImages(vehicles);
    expect(result.map((r) => r.id)).toEqual(["a", "c"]);
  });

  it("does not cross-collapse a null-checksum URL with a checksummed row", () => {
    const vehicles = [
      { images: [img("a", "/uploads/unit-1/x.png", null)] },
      { images: [img("b", "/uploads/unit-2/y.png", "sha-1")] },
    ];
    expect(dedupeModelImages(vehicles)).toHaveLength(2);
  });
});
