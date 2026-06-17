import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { DM_Sans } from "next/font/google";
import "./globals.css";
import { TRPCProvider } from "@/lib/trpc/provider";
import { SilenceExtensionHydrationWarning } from "@/components/shared/silence-extension-hydration-warning";
import { PostHogProvider } from "@/components/shared/posthog-provider";
import { PostHogIdentify } from "@/components/shared/posthog-identify";
import { SentryIdentify } from "@/components/shared/sentry-identify";
import { getPostHogPublic } from "@/lib/analytics";
import { SupportWidgetGate } from "@/components/support/support-widget-gate";
import { ImpersonationBannerGate } from "@/components/layout/impersonation-banner-gate";
import { BrandingProvider } from "@/components/shared/branding-provider";
import { MobileDebug } from "@/components/shared/mobile-debug";
import { getBranding } from "@/lib/branding";

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
  // M-11: a longer, descriptive default (the bare tagline was ~43 chars).
  // Derived from branding so it stays correct per tenant — no hardcoded names.
  const description = branding.tagline
    ? `${branding.tagline}. Book scooter & motorbike hire with ${branding.siteName} — instant online quotes, transparent GST-inclusive pricing, and flexible pickup across our depots.`
    : `Book scooter & motorbike hire with ${branding.siteName} — instant online quotes, transparent pricing, and flexible pickup.`;
  return {
    // M-11: `template` lets each page set just its own short title and have
    // the brand appended automatically (e.g. "Fleet · XPERT Moto"), while the
    // home page keeps the full descriptive default.
    title: {
      default: defaultTitle,
      template: `%s · ${branding.siteName}`,
    },
    description,
    icons: branding.faviconUrl ? { icon: branding.faviconUrl } : undefined,
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
         *  <PostHogIdentify> gating below. */}
        {posthog.browserKey ? (
          <PostHogProvider browserKey={posthog.browserKey} host={posthog.host} />
        ) : null}
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
          </BrandingProvider>
        </TRPCProvider>
      </body>
    </html>
  );
}
