import { Prisma } from "@prisma/client";
import { connection } from "next/server";
import { prisma } from "@/lib/prisma";
import { FleetStats, type FleetStatsData } from "./fleet-stats";
import { FleetBreakdownRow, type FleetBreakdownData } from "./fleet-breakdown-row";
import { FleetAttentionTable } from "./fleet-attention-table";
import { getActiveCategories, getDepotList } from "@/server/queries/cached";

type AttentionCounts = {
  rego_soon: bigint;
  ctp_soon: bigint;
  ins_soon: bigint;
  service_soon: bigint;
  any_attention: bigint;
};

export async function FleetOverviewTab() {
  await connection();
  const now = new Date();
  const in30 = new Date(now.getTime() + 30 * 86400000);
  const in14 = new Date(now.getTime() + 14 * 86400000);

  const [
    byStatus,
    byDepot,
    byCategory,
    byCondition,
    bookValueSum,
    attention,
    depots,
    categories,
  ] = await Promise.all([
    prisma.vehicle.groupBy({ by: ["status"], where: { isActive: true }, _count: true }),
    prisma.vehicle.groupBy({ by: ["depotId"], where: { isActive: true }, _count: true }),
    prisma.vehicle.groupBy({ by: ["categoryId"], where: { isActive: true }, _count: true }),
    prisma.vehicle.groupBy({ by: ["condition"], where: { isActive: true }, _count: true }),
    prisma.vehicle.aggregate({ where: { isActive: true }, _sum: { currentBookValue: true } }),
    prisma.$queryRaw<AttentionCounts[]>(Prisma.sql`
      SELECT
        COUNT(*) FILTER (WHERE "regoExpiry" < ${in30}) AS rego_soon,
        COUNT(*) FILTER (WHERE "ctpExpiry" < ${in30}) AS ctp_soon,
        COUNT(*) FILTER (WHERE "insuranceExpiry" < ${in30}) AS ins_soon,
        COUNT(*) FILTER (WHERE "nextServiceDueDate" < ${in14}) AS service_soon,
        COUNT(*) FILTER (
          WHERE "regoExpiry" < ${in30}
             OR "ctpExpiry" < ${in30}
             OR "insuranceExpiry" < ${in30}
             OR "nextServiceDueDate" < ${in14}
        ) AS any_attention
      FROM "Vehicle"
      WHERE "isActive" = true
    `),
    getDepotList(),
    getActiveCategories(),
  ]);

  const total = byStatus.reduce((acc, s) => acc + s._count, 0);
  const attentionRow = attention[0] ?? {
    rego_soon: 0n,
    ctp_soon: 0n,
    ins_soon: 0n,
    service_soon: 0n,
    any_attention: 0n,
  };
  const attentionCount = Number(attentionRow.any_attention);
  const counts: [number, number, number, number] = [
    Number(attentionRow.rego_soon),
    Number(attentionRow.ctp_soon),
    Number(attentionRow.ins_soon),
    Number(attentionRow.service_soon),
  ];

  const available = byStatus.find((s) => s.status === "AVAILABLE")?._count ?? 0;
  const rented = byStatus.find((s) => s.status === "RENTED")?._count ?? 0;
  const maintenance = byStatus.find((s) => s.status === "IN_MAINTENANCE")?._count ?? 0;
  const other = Math.max(0, total - available - rented - maintenance);

  const stats: FleetStatsData = {
    total,
    available,
    rented,
    maintenance,
    other,
    bookValue: Number(bookValueSum._sum.currentBookValue ?? 0),
    attention: {
      regoExpiring: counts[0],
      ctpExpiring: counts[1],
      insuranceExpiring: counts[2],
      serviceDue: counts[3],
    },
  };

  const countOf = (status: string) => byStatus.find((s) => s.status === status)?._count ?? 0;
  const CONDITION_ORDER = ["EXCELLENT", "GOOD", "FAIR", "POOR"] as const;
  const breakdown: FleetBreakdownData = {
    composition: {
      total,
      available: countOf("AVAILABLE"),
      rented: countOf("RENTED"),
      maintenance: countOf("IN_MAINTENANCE"),
      accidentRepairs: countOf("ACCIDENT_REPAIRS"),
      other:
        total -
        countOf("AVAILABLE") -
        countOf("RENTED") -
        countOf("IN_MAINTENANCE") -
        countOf("ACCIDENT_REPAIRS"),
    },
    byDepot: byDepot
      .map((d) => ({
        id: d.depotId,
        name: depots.find((x) => x.id === d.depotId)?.name ?? "—",
        value: d._count,
      }))
      .sort((a, b) => b.value - a.value),
    byCategory: byCategory
      .map((c) => ({
        id: c.categoryId,
        name: categories.find((x) => x.id === c.categoryId)?.name ?? "—",
        value: c._count,
      }))
      .sort((a, b) => b.value - a.value),
    byCondition: CONDITION_ORDER.map((key) => ({
      id: key,
      name: key.charAt(0) + key.slice(1).toLowerCase(),
      value: byCondition.find((c) => c.condition === key)?._count ?? 0,
    })).filter((c) => c.value > 0),
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <div className="shrink-0 space-y-4">
        <FleetStats data={stats} />
        <FleetBreakdownRow data={breakdown} />
      </div>

      {attentionCount > 0 && (
        <div className="flex min-h-0 flex-1 flex-col">
          <FleetAttentionTable />
        </div>
      )}
    </div>
  );
}
