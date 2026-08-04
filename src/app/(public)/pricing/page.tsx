import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { buildMetadata } from "@/lib/seo/metadata";
import { DividedTitle } from "@/components/marketing/divided-title";
import { formatCurrency } from "@/lib/utils";

// Per-page title (composed via the root template) + canonical/OG via buildMetadata.
export function generateMetadata(): Promise<Metadata> {
  return buildMetadata({
    title: "Pricing & insurance",
    description:
      "Transparent, GST-inclusive scooter & motorbike hire rates — daily and weekly pricing, insurance tiers and excess, add-ons and the refundable bond explained.",
    path: "/pricing",
  });
}

export default async function PricingPage() {
  const [categories, addons, insurance] = await Promise.all([
    prisma.vehicleCategory.findMany({ where: { isActive: true }, orderBy: { displayOrder: "asc" } }),
    prisma.addon.findMany({ where: { isActive: true } }),
    prisma.insuranceOption.findMany({ where: { isActive: true } }),
  ]);

  return (
    <div className="container space-y-16 py-12">
      <div className="space-y-2">
        <p className="caption uppercase tracking-[0.14em]">Pricing</p>
        <h1 className="h-display">Simple, honest rates</h1>
        <p className="max-w-2xl text-muted-foreground">
          All prices include GST. No hidden fees. Unlimited kilometres and insurance included.
        </p>
      </div>

      <section className="space-y-6">
        <DividedTitle>Vehicle rates</DividedTitle>
        <div className="overflow-hidden rounded-md border border-border bg-card">
          <table className="w-full">
            <thead className="bg-foreground text-background">
              <tr className="text-left">
                <th className="p-3 text-xs font-semibold uppercase tracking-[0.08em]">Category</th>
                <th className="p-3 text-xs font-semibold uppercase tracking-[0.08em]">Daily</th>
                <th className="p-3 text-xs font-semibold uppercase tracking-[0.08em]">Weekly</th>
                <th className="p-3 text-xs font-semibold uppercase tracking-[0.08em]">Monthly</th>
                <th className="p-3 text-xs font-semibold uppercase tracking-[0.08em]">Bond</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((c) => (
                <tr key={c.id} className="border-t border-border">
                  <td className="p-3 font-medium">{c.name}</td>
                  <td className="p-3 tabular-nums">{formatCurrency(Number(c.baseDailyRate))}</td>
                  <td className="p-3 tabular-nums">{formatCurrency(Number(c.baseWeeklyRate))}</td>
                  <td className="p-3 tabular-nums">{formatCurrency(Number(c.baseMonthlyRate))}</td>
                  <td className="p-3 tabular-nums">{formatCurrency(Number(c.bondAmount))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-6">
        <DividedTitle>Add-ons</DividedTitle>
        <div className="grid gap-3 md:grid-cols-2">
          {addons.map((a) => (
            <div
              key={a.id}
              className="flex items-center justify-between rounded-md border border-border bg-card p-3"
            >
              <span className="font-medium">{a.name}</span>
              <span className="font-semibold tabular-nums">
                {a.isPerDay
                  ? `${formatCurrency(Number(a.dailyRate ?? 0))}/day`
                  : formatCurrency(Number(a.flatRate ?? 0))}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-6">
        <DividedTitle>Insurance</DividedTitle>
        <div className="grid gap-4 md:grid-cols-3">
          {insurance.map((i) => (
            <div key={i.id} className="flex flex-col rounded-md border border-border bg-card p-6 text-card-foreground">
              <div className="h3">{i.name}</div>
              {i.description && <p className="mt-1 text-sm text-muted-foreground">{i.description}</p>}
              <div className="mt-4 text-3xl font-semibold tabular-nums text-foreground">
                {Number(i.dailyRate) === 0 ? "Included" : `${formatCurrency(Number(i.dailyRate))}/day`}
              </div>
              <div className="caption mt-1">
                Excess: {formatCurrency(Number(i.excessAmount))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
