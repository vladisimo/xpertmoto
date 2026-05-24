import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { DM_Sans } from "next/font/google";
import "./globals.css";
import { TRPCProvider } from "@/lib/trpc/provider";
import { SilenceExtensionHydrationWarning } from "@/components/shared/silence-extension-hydration-warning";
import { PostHogProvider } from "@/components/shared/posthog-provider";
import { PostHogIdentify } from "@/components/shared/posthog-identify";
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
  const title = branding.tagline
    ? `${branding.siteName} — ${branding.tagline}`
    : branding.siteName;
  return {
    title,
    description: branding.tagline,
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
        <PostHogProvider browserKey={posthog.browserKey} host={posthog.host} />
        <TRPCProvider>
          {posthog.browserKey ? <PostHogIdentify /> : null}
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
