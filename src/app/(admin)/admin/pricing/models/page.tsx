import { PricingPageShell } from "@/components/admin/pricing/pricing-page-shell";
import { PricingModelsTab } from "@/components/admin/pricing/pricing-models-tab";

/** Models uses the full-height shell — its table scrolls internally. */
export default function PricingModelsPage() {
  return (
    <PricingPageShell full>
      <PricingModelsTab />
    </PricingPageShell>
  );
}
