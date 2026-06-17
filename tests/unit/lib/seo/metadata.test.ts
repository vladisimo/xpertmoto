import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({ getBranding: vi.fn() }));
vi.mock("@/lib/branding", () => ({ getBranding: h.getBranding }));

import { buildMetadata } from "@/lib/seo/metadata";

beforeEach(() => {
  h.getBranding.mockReset().mockResolvedValue({ siteName: "XPERT Moto" });
});

describe("buildMetadata", () => {
  it("sets canonical, en_AU OG locale, siteName and summary_large_image card", async () => {
    const m = await buildMetadata({ title: "Fleet", description: "d", path: "/fleet" });
    expect(m).toMatchObject({
      title: "Fleet",
      description: "d",
      alternates: { canonical: "/fleet" },
      openGraph: {
        url: "/fleet",
        siteName: "XPERT Moto",
        locale: "en_AU",
        type: "website",
      },
      twitter: { card: "summary_large_image" },
    });
    expect(m.robots).toBeUndefined();
  });

  it("emits noindex, follow when requested", async () => {
    const m = await buildMetadata({
      title: "x",
      description: "d",
      path: "/x",
      noindex: true,
    });
    expect(m.robots).toEqual({ index: false, follow: true });
  });

  it("defaults to the branded /opengraph-image on both OG and Twitter", async () => {
    const m = await buildMetadata({ title: "x", description: "d", path: "/x" });
    expect(m).toMatchObject({
      openGraph: { images: [{ url: "/opengraph-image" }] },
      twitter: { images: ["/opengraph-image"] },
    });
  });

  it("sets images on both OG and Twitter when ogImage is provided", async () => {
    const m = await buildMetadata({
      title: "x",
      description: "d",
      path: "/x",
      ogImage: "/card.png",
    });
    expect(m).toMatchObject({
      openGraph: { images: [{ url: "/card.png" }] },
      twitter: { images: ["/card.png"] },
    });
  });

  it("passes keywords through and honours article ogType", async () => {
    const m = await buildMetadata({
      title: "x",
      description: "d",
      path: "/x",
      keywords: ["a", "b"],
      ogType: "article",
    });
    expect(m.keywords).toEqual(["a", "b"]);
    expect(m).toMatchObject({ openGraph: { type: "article" } });
  });
});
