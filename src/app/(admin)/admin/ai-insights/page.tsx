import { PageHeader } from "@/components/layout/page-header";
import { PageShell } from "@/components/layout/page-section";
import { DesktopRecommendedNotice } from "@/components/layout/desktop-recommended-notice";
import { AiInsightsClient } from "@/components/insights/ai-insights-client";

export default function AdminAiInsightsPage() {
  return (
    <div
      className="h-full"
      style={{
        background:
          "radial-gradient(1200px 400px at 10% -10%, hsl(var(--insights-accent) / 0.12), transparent 60%), radial-gradient(1000px 400px at 100% 0%, hsl(var(--insights-accent-soft) / 0.08), transparent 60%)",
      }}
    >
      <PageShell full>
        <PageHeader
          eyebrow="Administration · AI Insights"
          title="AI Insights"
          description="Organisation-wide commercial findings — customer retention, fleet ROI, revenue trend, acquisition conversion."
        />
        <DesktopRecommendedNotice
          className="md:hidden"
          description="The insights canvas pairs charts with narrative findings — wide screens make it readable. The list of insight cards still renders below."
        />
        <AiInsightsClient basePath="/admin/ai-insights" />
      </PageShell>
    </div>
  );
}
