import type { MetadataRoute } from "next";
import { env } from "@/lib/env";
import { getSiteUrl } from "@/lib/seo/site-url";

/**
 * Non-public URL prefixes — auth flows, the customer portal, back-office,
 * onboarding, the API, and the per-booking confirmation page. Everything else
 * under `/` (the marketing + fleet + tours surface) is crawlable.
 */
const DISALLOW = [
  "/api/",
  "/admin/",
  "/staff/",
  "/dashboard/",
  "/onboarding/",
  "/portal-select",
  "/totp/",
  "/verify-2fa-step-up",
  "/verify-email",
  "/accept-invite",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/magic-link-sent",
  "/booking/confirmation",
];

/**
 * Whether this deployment should be indexed. Defaults to "production only" so
 * staging/preview hosts are never crawled; `SEO_INDEXABLE` overrides either way.
 */
function indexable(): boolean {
  if (env.SEO_INDEXABLE === "1") return true;
  if (env.SEO_INDEXABLE === "0") return false;
  return env.NODE_ENV === "production";
}

export default function robots(): MetadataRoute.Robots {
  const base = getSiteUrl();
  if (!indexable()) {
    // Block everything on non-production hosts to avoid duplicate-content /
    // staging pages competing with the canonical site.
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: DISALLOW }],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
