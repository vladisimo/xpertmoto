import type { PrismaClient } from "@prisma/client";
import type {
  InsightsGeneratorContext,
  TopCustomersAtRiskPayload,
} from "../types";

const AT_RISK_DAYS = 90;
const TOP_N = 20;

export async function generateTopCustomersAtRisk(
  prisma: PrismaClient,
  ctx: InsightsGeneratorContext,
): Promise<TopCustomersAtRiskPayload> {
  const profiles = await prisma.customerProfile.findMany({
    where: {
      totalSpend: { gt: 0 },
      user: { role: "CUSTOMER" },
    },
    orderBy: { totalSpend: "desc" },
    take: TOP_N,
    include: {
      user: {
        select: { id: true, email: true, firstName: true, lastName: true },
      },
    },
  });

  const rows: TopCustomersAtRiskPayload["rows"] = profiles.map((p) => {
    const last = p.lastBookingAt;
    const days = last
      ? Math.floor((ctx.now.getTime() - last.getTime()) / 86_400_000)
      : null;
    const atRisk = days !== null && days >= AT_RISK_DAYS;
    return {
      customerId: p.userId,
      name:
        [p.user.firstName, p.user.lastName].filter(Boolean).join(" ").trim() ||
        (p.user.email ?? "Unknown"),
      email: p.user.email ?? null,
      totalSpend: Number(p.totalSpend),
      totalBookings: p.totalBookings,
      lastBookingAt: last ? last.toISOString() : null,
      daysSinceLastBooking: days,
      riskRating: p.riskRating,
      atRisk,
    };
  });

  const atRiskCount = rows.filter((r) => r.atRisk).length;
  const atRiskSpend = rows.filter((r) => r.atRisk).reduce((a, r) => a + r.totalSpend, 0);

  return {
    id: "top-customers-at-risk",
    rows,
    atRiskCount,
    atRiskSpend: Number(atRiskSpend.toFixed(2)),
    headlineMetric: {
      label: `At-risk customers (>${AT_RISK_DAYS} days inactive)`,
      value: String(atRiskCount),
      trendLabel:
        atRiskCount > 0
          ? `$${atRiskSpend.toLocaleString("en-AU", { maximumFractionDigits: 0 })} of lifetime value`
          : undefined,
    },
  };
}
