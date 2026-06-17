import { PricingPageShell } from "@/components/admin/pricing/pricing-page-shell";
import { PricingInsuranceTab } from "@/components/admin/pricing/pricing-insurance-tab";

export default function PricingInsurancePage() {
  return (
    <PricingPageShell>
      <PricingInsuranceTab />
    </PricingPageShell>
  );
}
