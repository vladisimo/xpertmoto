import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { PageHeader } from "@/components/layout/page-header";
import { PageShell } from "@/components/layout/page-section";
import { InsightDetailClient } from "@/components/insights/insight-detail-client";
import {
  INSIGHT_IDS,
  INSIGHT_META,
  PILLAR_META,
  type InsightId,
} from "@/server/services/insights/types";

const MANAGER_ROLES = new Set(["MANAGER", "ADMIN", "SUPER_ADMIN"]);

export default async function StaffAiInsightDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!MANAGER_ROLES.has(session.user.role)) redirect("/staff/dashboard");

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
            { label: "Operations", href: "/staff/dashboard" },
            { label: "AI Insights", href: "/staff/ai-insights" },
            { label: meta.title },
          ]}
        />
        <InsightDetailClient
          insightId={insightId}
          basePath="/staff/ai-insights"
          customerHrefTemplate="/staff/customers/{id}"
          vehicleHrefTemplate="/staff/fleet/{id}"
        />
      </PageShell>
    </div>
  );
}
