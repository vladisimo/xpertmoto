import type { MetadataRoute } from "next";
import { getBranding } from "@/lib/branding";

/**
 * Web app manifest, driven entirely by branding so each tenant gets its own
 * name/colour/icon. Icons reference the operator-uploaded square logo (or
 * favicon) at `sizes: "any"` — we can't assert a fixed pixel size for an
 * arbitrary uploaded asset, and "any" is valid for all raster/vector sources.
 */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const b = await getBranding();
  const iconSrc = b.logoSquareUrl ?? b.faviconUrl;
  return {
    name: b.siteName,
    short_name: b.siteName.slice(0, 12),
    description: b.tagline,
    start_url: "/",
    display: "standalone",
    theme_color: b.brandColor,
    background_color: "#FAFAF9",
    icons: iconSrc ? [{ src: iconSrc, sizes: "any" }] : [],
  };
}
