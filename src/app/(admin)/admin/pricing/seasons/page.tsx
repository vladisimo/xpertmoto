import { PricingPageShell } from "@/components/admin/pricing/pricing-page-shell";
import { PricingSeasonsTab } from "@/components/admin/pricing/pricing-seasons-tab";

export default function PricingSeasonsPage() {
  return (
    <PricingPageShell>
      <PricingSeasonsTab />
    </PricingPageShell>
  );
}
