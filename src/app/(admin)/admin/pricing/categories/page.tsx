import { PricingPageShell } from "@/components/admin/pricing/pricing-page-shell";
import { CategoriesManager } from "@/components/admin/categories-manager";

export default function PricingCategoriesPage() {
  return (
    <PricingPageShell>
      <CategoriesManager />
    </PricingPageShell>
  );
}
