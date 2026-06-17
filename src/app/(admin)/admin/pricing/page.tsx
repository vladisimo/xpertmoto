import { PricingPageShell } from "@/components/admin/pricing/pricing-page-shell";
import { PricingRatesTab } from "@/components/admin/pricing/pricing-rates-tab";

/** Default tab — served at /admin/pricing. */
export default function PricingRatesPage() {
  return (
    <PricingPageShell>
      <PricingRatesTab />
    </PricingPageShell>
  );
}
