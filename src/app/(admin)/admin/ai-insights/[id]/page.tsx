import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { PageShell } from "@/components/layout/page-section";
import { InsightDetailClient } from "@/components/insights/insight-detail-client";
import {
  INSIGHT_IDS,
  INSIGHT_META,
  PILLAR_META,
  type InsightId,
} from "@/server/services/insights/types";

export default async function AdminAiInsightDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!INSIGHT_IDS.includes(id as InsightId)) notFound();
  const insightId = id as InsightId;
  const meta = INSIGHT_META[insightId];
  const pillar = PILLAR_META[meta.pillar];

  return (
    <div
      className="min-h-full"
      style={{
        background:
          "radial-gradient(1200px 400px at 10% -10%, hsl(var(--insights-accent) / 0.12), transparent 60%), radial-gradient(1000px 400px at 100% 0%, hsl(var(--insights-accent-soft) / 0.08), transparent 60%)",
      }}
    >
      <PageShell>
        <PageHeader
          eyebrow={`${pillar.label} · AI Insights`}
          title={meta.title}
          breadcrumbs={[
            { label: "Administration", href: "/admin/dashboard" },
            { label: "AI Insights", href: "/admin/ai-insights" },
            { label: meta.title },
          ]}
        />
        <InsightDetailClient
          insightId={insightId}
          basePath="/admin/ai-insights"
          customerHrefTemplate="/staff/customers/{id}"
        />
      </PageShell>
    </div>
  );
}
