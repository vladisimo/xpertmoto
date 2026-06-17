import { PricingPageShell } from "@/components/admin/pricing/pricing-page-shell";
import { PricingDiscountsTab } from "@/components/admin/pricing/pricing-discounts-tab";

export default function PricingDiscountsPage() {
  return (
    <PricingPageShell>
      <PricingDiscountsTab />
    </PricingPageShell>
  );
}
