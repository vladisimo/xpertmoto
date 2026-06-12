import { cache } from "react";
import { cacheLife, cacheTag } from "next/cache";
import { getSettings } from "@/lib/settings";
import { BRAND } from "@/lib/constants";

export interface Branding {
  siteName: string;
  tagline: string;
  legalName: string;
  abn: string;
  /** Hex colour (with leading hash) used for PDF accents + email CTAs. */
  brandColor: string;
  supportEmail: string | null;
  supportPhone: string | null;
  privacyEmail: string | null;
  postalAddress: string | null;
  logoWideUrl: string | null;
  /** Dark-on-transparent variant for use on light surfaces (PDF
   *  invoices, light-mode public marketing). Falls back to the wide
   *  logo when blank, but operators should upload both for the best
   *  result on every surface. */
  logoBlackUrl: string | null;
  logoSquareUrl: string | null;
  faviconUrl: string | null;
  social: {
    facebook: string | null;
    instagram: string | null;
    tiktok: string | null;
    youtube: string | null;
  };
}

const BRANDING_KEYS = [
  "org.tradingName",
  "org.siteTagline",
  "org.legalName",
  "org.abn",
  "org.brandColor",
  "org.supportEmail",
  "org.supportPhone",
  "org.privacyEmail",
  "org.postalAddress",
  "org.logoWideUrl",
  "org.logoBlackUrl",
  "org.logoSquareUrl",
  "org.faviconUrl",
  "org.facebookUrl",
  "org.instagramUrl",
  "org.tiktokUrl",
  "org.youtubeUrl",
] as const;

const blankToNull = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

const asString = (value: unknown, fallback: string): string =>
  typeof value === "string" && value.trim().length ? value : fallback;

async function readBranding(): Promise<Branding> {
  "use cache";
  // cacheLife/cacheTag throw outside a Next "use cache" runtime (Vitest,
  // tsx-run BullMQ workers). The directive above is still a valid no-op in
  // those environments; swallowing here lets the same module serve RSC
  // (where the directive is compiled) and jobs/tests (where it isn't).
  try {
    cacheLife("hours");
    cacheTag("branding");
  } catch {
    // not in a Next cache runtime — fall through to a plain read
  }
  const s = await getSettings(BRANDING_KEYS);
  const squareUrl = blankToNull(s["org.logoSquareUrl"]);
  const supportEmail = blankToNull(s["org.supportEmail"]);
  return {
    siteName: asString(s["org.tradingName"], BRAND.name),
    tagline: asString(s["org.siteTagline"], BRAND.tagline),
    legalName: asString(s["org.legalName"], BRAND.legalName),
    abn: asString(s["org.abn"], BRAND.abn),
    brandColor: asString(s["org.brandColor"], BRAND.primary),
    supportEmail,
    supportPhone: blankToNull(s["org.supportPhone"]),
    privacyEmail: blankToNull(s["org.privacyEmail"]) ?? supportEmail,
    postalAddress: blankToNull(s["org.postalAddress"]),
    logoWideUrl: blankToNull(s["org.logoWideUrl"]),
    logoBlackUrl: blankToNull(s["org.logoBlackUrl"]),
    logoSquareUrl: squareUrl,
    faviconUrl: blankToNull(s["org.faviconUrl"]) ?? squareUrl,
    social: {
      facebook: blankToNull(s["org.facebookUrl"]),
      instagram: blankToNull(s["org.instagramUrl"]),
      tiktok: blankToNull(s["org.tiktokUrl"]),
      youtube: blankToNull(s["org.youtubeUrl"]),
    },
  };
}

/**
 * React cache() on top of the "use cache" data cache: generateMetadata and
 * the RootLayout body (and any nested layout) each call getBranding() in
 * the same request — cache() collapses them to a single read even when the
 * Next data cache isn't warm or the directive is a no-op (jobs, tests,
 * where cache() simply invokes the function).
 */
export const getBranding = cache(readBranding);
