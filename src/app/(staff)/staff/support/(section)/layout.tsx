import { PageHeader } from "@/components/layout/page-header";
import { PageShell } from "@/components/layout/page-section";
import { SectionShell } from "@/components/layout/section-shell";
import { SupportTabsBar } from "@/components/staff/support-tabs-bar";

/**
 * Support section shell — wraps the Tickets/Insights tab routes. The ticket
 * detail page at /staff/support/[id] lives outside this `(section)` group, so
 * it keeps its own chrome instead of the section bar.
 */
export default function SupportSectionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SectionShell section="support">
      <PageShell>
        <PageHeader
          eyebrow="Operations"
          title="Support inbox"
          description="Tickets raised by customers via the chat widget or structured forms."
        />
        <SupportTabsBar />
        <div className="mt-6 space-y-6">{children}</div>
      </PageShell>
    </SectionShell>
  );
}
