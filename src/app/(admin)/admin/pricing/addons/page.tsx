import { PricingPageShell } from "@/components/admin/pricing/pricing-page-shell";
import { PricingAddonsTab } from "@/components/admin/pricing/pricing-addons-tab";

export default function PricingAddonsPage() {
  return (
    <PricingPageShell>
      <PricingAddonsTab />
    </PricingPageShell>
  );
}
