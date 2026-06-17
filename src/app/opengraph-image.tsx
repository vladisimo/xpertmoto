import { ImageResponse } from "next/og";
import { getBranding } from "@/lib/branding";

// Branded 1200×630 Open Graph card, generated from tenant branding so social
// shares carry the site name + tagline. Applies to every public page that
// doesn't declare a more specific opengraph-image. X/Twitter falls back to
// this og:image when no twitter:image is present.
export const alt = "Scooter and motorbike hire";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  const b = await getBranding();
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: b.brandColor,
          color: "#ffffff",
          fontFamily: "sans-serif",
          padding: "80px",
        }}
      >
        <div style={{ display: "flex", fontSize: 88, fontWeight: 700, letterSpacing: -1 }}>
          {b.siteName}
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 38,
            marginTop: 28,
            opacity: 0.92,
            maxWidth: 960,
            textAlign: "center",
          }}
        >
          {b.tagline}
        </div>
      </div>
    ),
    { ...size },
  );
}
