import { PageHeader } from "@/components/layout/page-header";
import { PageShell } from "@/components/layout/page-section";
import { SectionShell } from "@/components/layout/section-shell";
import { SettingsTabsBar } from "@/components/admin/settings-tabs-bar";

/** System settings section shell — one route per settings group. */
export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SectionShell section="settings">
      <PageShell>
        <PageHeader
          eyebrow="Administration"
          title="System settings"
          description="Configure business rules across the platform. Changes save automatically."
        />
        <SettingsTabsBar />
        {children}
      </PageShell>
    </SectionShell>
  );
}
