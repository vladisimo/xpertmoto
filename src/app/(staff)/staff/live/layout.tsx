import { PageHeader } from "@/components/layout/page-header";
import { PageShell } from "@/components/layout/page-section";
import { SectionShell } from "@/components/layout/section-shell";
import { DesktopRecommendedNotice } from "@/components/layout/desktop-recommended-notice";
import { LiveTabsBar } from "./live-tabs-bar";

/**
 * Live visitors section shell. Each tab is its own route, so only the visited
 * tab mounts — replacing the previous all-tabs `forceMount` (which fired every
 * analytics query at once). Note: analytics filter params (range/compare/…) now
 * reset when switching tabs, since route links don't carry the querystring.
 */
export default function LiveLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SectionShell section="live">
      <PageShell full>
        <PageHeader
          eyebrow="Concierge"
          title="Live visitors"
          description="Real-time visitor console, analytics, and sales-team performance."
        />
        <DesktopRecommendedNotice
          className="md:hidden"
          description="Live analytics is dense and best viewed on a larger screen. Use Live / Alerts on mobile and pull up the rest on a laptop."
        />
        <LiveTabsBar />
        <div className="flex min-h-0 flex-1 flex-col gap-4">{children}</div>
      </PageShell>
    </SectionShell>
  );
}
