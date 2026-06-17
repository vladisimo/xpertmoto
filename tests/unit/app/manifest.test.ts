import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({ getBranding: vi.fn() }));
vi.mock("@/lib/branding", () => ({ getBranding: h.getBranding }));

import manifest from "@/app/manifest";

beforeEach(() => {
  h.getBranding.mockReset();
});

describe("manifest", () => {
  it("derives name, theme colour and square-logo icon from branding", async () => {
    h.getBranding.mockResolvedValue({
      siteName: "XPERT Moto",
      tagline: "Ride Australia's best",
      brandColor: "#1B6B4A",
      logoSquareUrl: "https://cdn.example.com/square.png",
      faviconUrl: null,
    });
    const m = await manifest();
    expect(m).toMatchObject({
      name: "XPERT Moto",
      short_name: "XPERT Moto",
      description: "Ride Australia's best",
      theme_color: "#1B6B4A",
      start_url: "/",
      display: "standalone",
      icons: [{ src: "https://cdn.example.com/square.png", sizes: "any" }],
    });
  });

  it("falls back to favicon, then to no icons", async () => {
    h.getBranding.mockResolvedValue({
      siteName: "X",
      tagline: "t",
      brandColor: "#000000",
      logoSquareUrl: null,
      faviconUrl: "https://cdn.example.com/fav.png",
    });
    expect((await manifest()).icons).toEqual([
      { src: "https://cdn.example.com/fav.png", sizes: "any" },
    ]);

    h.getBranding.mockResolvedValue({
      siteName: "X",
      tagline: "t",
      brandColor: "#000000",
      logoSquareUrl: null,
      faviconUrl: null,
    });
    expect((await manifest()).icons).toEqual([]);
  });

  it("truncates short_name to 12 characters", async () => {
    h.getBranding.mockResolvedValue({
      siteName: "A Very Long Brand Name Indeed",
      tagline: "t",
      brandColor: "#000000",
      logoSquareUrl: null,
      faviconUrl: null,
    });
    expect((await manifest()).short_name?.length).toBeLessThanOrEqual(12);
  });
});
