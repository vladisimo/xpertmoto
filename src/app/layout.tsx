import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { DM_Sans } from "next/font/google";
import "./globals.css";
import { TRPCProvider } from "@/lib/trpc/provider";
import { SilenceExtensionHydrationWarning } from "@/components/shared/silence-extension-hydration-warning";
import { PostHogProvider } from "@/components/shared/posthog-provider";
import { PostHogIdentify } from "@/components/shared/posthog-identify";
import { AnalyticsConsentBanner } from "@/components/shared/analytics-consent-banner";
import { WebVitalsReporter } from "@/components/shared/web-vitals-reporter";
import { SentryIdentify } from "@/components/shared/sentry-identify";
import { getPostHogPublic } from "@/lib/analytics";
import { SupportWidgetGate } from "@/components/support/support-widget-gate";
import { ImpersonationBannerGate } from "@/components/layout/impersonation-banner-gate";
import { BrandingProvider } from "@/components/shared/branding-provider";
import { MobileDebug } from "@/components/shared/mobile-debug";
import { getBranding } from "@/lib/branding";
import { getSiteUrl } from "@/lib/seo/site-url";
import { env } from "@/lib/env";

const dmSansBody = DM_Sans({
  subsets: ["latin"],
  variable: "--font-rubik",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

const dmSansDisplay = DM_Sans({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
  weight: ["500", "600", "700"],
});

export async function generateMetadata(): Promise<Metadata> {
  const branding = await getBranding();
  const defaultTitle = branding.tagline
    ? `${branding.siteName} — ${branding.tagline}`
    : branding.siteName;
  // SEO: a single, ~150-char value-prop (the old default was ~220 chars and
  // repeated "scooter & motorbike hire" twice). Branding-derived so it stays
  // correct per tenant — no hardcoded trading name.
  const description = `Hire scooters & motorbikes with ${branding.siteName}. Instant online quotes, GST-inclusive pricing and flexible depot pickup right across Australia.`;
  return {
    // metadataBase resolves every page's relative canonical / og:url / og:image
    // (set via buildMetadata) to an absolute URL. Single source: getSiteUrl().
    metadataBase: new URL(getSiteUrl()),
    // M-11: `template` lets each page set just its own short title and have
    // the brand appended automatically (e.g. "Fleet · XPERT Moto"), while the
    // home page keeps the full descriptive default.
    title: {
      default: defaultTitle,
      template: `%s · ${branding.siteName}`,
    },
    description,
    // `/favicon.ico` always resolves now (the route handler at
    // src/app/favicon.ico/route.ts serves the branding asset, falling back to
    // the bundled brand mark), so the link tags are emitted unconditionally.
    icons: {
      icon: branding.faviconUrl ?? "/favicon.ico",
      shortcut: branding.faviconUrl ?? "/favicon.ico",
      apple: branding.logoSquareUrl ?? branding.faviconUrl ?? "/favicon.ico",
    },
    // Search Console verification meta tag (only when configured).
    verification: env.GOOGLE_SITE_VERIFICATION
      ? { google: env.GOOGLE_SITE_VERIFICATION }
      : undefined,
  };
}

/**
 * `viewport-fit=cover` lets `env(safe-area-inset-*)` resolve to non-zero
 * on devices with a notch / system UI overlap — required for the
 * `MobileBottomBar` and any other sticky-bottom UI that uses
 * `pb-[env(safe-area-inset-bottom)]`. `initialScale: 1` keeps the
 * back-office at 1× zoom on first paint.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [posthog, branding] = await Promise.all([
    getPostHogPublic(),
    getBranding(),
  ]);
  return (
    <html
      lang="en-AU"
      className={`${dmSansBody.variable} ${dmSansDisplay.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-screen bg-background font-sans antialiased">
        <SilenceExtensionHydrationWarning />
        <MobileDebug />
        {/* M-8: only inject the PostHog snippet when a browser key is
         *  configured. With an empty key the snippet still loaded array.js +
         *  /array//config.js and 404'd on every page. Mirrors the existing
         *  <PostHogIdentify> gating below.
         *  A key is necessary but not sufficient — each of these three also
         *  waits on analytics consent client-side (analytics-consent.ts), so
         *  nothing loads or captures until the banner is accepted. */}
        {posthog.browserKey ? (
          <PostHogProvider browserKey={posthog.browserKey} host={posthog.host} />
        ) : null}
        {posthog.browserKey ? <WebVitalsReporter /> : null}
        <TRPCProvider>
          {posthog.browserKey ? <PostHogIdentify /> : null}
          <SentryIdentify />
          <BrandingProvider value={branding}>
            <Suspense fallback={null}>
              <ImpersonationBannerGate />
            </Suspense>
            {children}
            <Suspense fallback={null}>
              <SupportWidgetGate />
            </Suspense>
            {/* One banner for the whole app (public site, portal and
             *  back-office share this layout), so nobody is asked twice and
             *  no back-office page gets its own prompt. */}
            {posthog.browserKey ? <AnalyticsConsentBanner /> : null}
          </BrandingProvider>
        </TRPCProvider>
      </body>
    </html>
  );
}
