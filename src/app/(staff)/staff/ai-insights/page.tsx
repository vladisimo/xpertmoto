import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { PageHeader } from "@/components/layout/page-header";
import { PageShell } from "@/components/layout/page-section";
import { AiInsightsClient } from "@/components/insights/ai-insights-client";

const MANAGER_ROLES = new Set(["MANAGER", "ADMIN", "SUPER_ADMIN"]);

export default async function StaffAiInsightsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!MANAGER_ROLES.has(session.user.role)) redirect("/staff/dashboard");

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
          eyebrow="Operations · AI Insights"
          title="AI Insights"
          description="Commercial findings generated from your booking, fleet and customer data — with charts, tables and recommended actions."
        />
        <AiInsightsClient basePath="/staff/ai-insights" />
      </PageShell>
    </div>
  );
}
