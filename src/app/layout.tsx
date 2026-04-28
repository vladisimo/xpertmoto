import type { Metadata } from "next";
import { Suspense } from "react";
import { DM_Sans } from "next/font/google";
import "./globals.css";
import { TRPCProvider } from "@/lib/trpc/provider";
import { SilenceExtensionHydrationWarning } from "@/components/shared/silence-extension-hydration-warning";
import { PostHogProvider } from "@/components/shared/posthog-provider";
import { getPostHogPublic } from "@/lib/analytics";
import { SupportWidgetGate } from "@/components/support/support-widget-gate";
import { ImpersonationBannerGate } from "@/components/layout/impersonation-banner-gate";
import { BrandingProvider } from "@/components/shared/branding-provider";
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
        <PostHogProvider browserKey={posthog.browserKey} host={posthog.host} />
        <TRPCProvider>
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
