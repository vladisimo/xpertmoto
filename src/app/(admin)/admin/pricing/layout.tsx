import { SectionShell } from "@/components/layout/section-shell";

/** Pricing section shell — one route per pricing surface. */
export default function PricingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <SectionShell section="pricing">{children}</SectionShell>;
}
