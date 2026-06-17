import { SectionShell } from "@/components/layout/section-shell";

/**
 * Wraps every /admin/finance route in the Finance section rail (lg+). Each
 * page keeps rendering its own <FinanceTabsBar /> as the horizontal fallback
 * below lg. The Webhook-health tab lives outside this group at /admin/webhooks,
 * which opts into the same rail directly on its page.
 */
export default function FinanceLayout({ children }: { children: React.ReactNode }) {
  return <SectionShell section="finance">{children}</SectionShell>;
}
