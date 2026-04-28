import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";

const MS_IN_DAY = 86_400_000;

export async function StaffFleetTab({ depotId }: { depotId?: string }) {
  const in7 = new Date(Date.now() + 7 * MS_IN_DAY);
  const in14 = new Date(Date.now() + 14 * MS_IN_DAY);
  const in30 = new Date(Date.now() + 30 * MS_IN_DAY);

  const [regoSoon, ctpSoon, insuranceSoon, serviceSoon, vehicles] = await Promise.all([
    prisma.vehicle.count({
      where: {
        isActive: true,
        ...(depotId ? { depotId } : {}),
        regoExpiry: { lt: in7 },
      },
    }),
    prisma.vehicle.count({
      where: {
        isActive: true,
        ...(depotId ? { depotId } : {}),
        ctpExpiry: { lt: in30 },
      },
    }),
    prisma.vehicle.count({
      where: {
        isActive: true,
        ...(depotId ? { depotId } : {}),
        insuranceExpiry: { lt: in30 },
      },
    }),
    prisma.vehicle.count({
      where: {
        isActive: true,
        ...(depotId ? { depotId } : {}),
        nextServiceDueDate: { lt: in14 },
      },
    }),
    prisma.vehicle.findMany({
      where: {
        isActive: true,
        ...(depotId ? { depotId } : {}),
        OR: [
          { regoExpiry: { lt: in30 } },
          { ctpExpiry: { lt: in30 } },
          { insuranceExpiry: { lt: in30 } },
          { nextServiceDueDate: { lt: in14 } },
        ],
      },
      orderBy: { nextServiceDueDate: "asc" },
      take: 40,
    }),
  ]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="grid gap-3 md:grid-cols-4">
        <Kpi label="Rego expiring (7d)" value={regoSoon} tone={regoSoon > 0 ? "warn" : undefined} />
        <Kpi label="CTP expiring (30d)" value={ctpSoon} tone={ctpSoon > 0 ? "warn" : undefined} />
        <Kpi
          label="Insurance expiring (30d)"
          value={insuranceSoon}
          tone={insuranceSoon > 0 ? "warn" : undefined}
        />
        <Kpi
          label="Service due (14d)"
          value={serviceSoon}
          tone={serviceSoon > 0 ? "warn" : undefined}
        />
      </div>

      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Vehicles needing attention</CardTitle>
          <p className="text-caption text-muted-foreground">
            Rego / CTP / insurance expiring within 30 days, or service due within 14 days.
          </p>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto text-sm">
          {vehicles.length === 0 ? (
            <p className="text-muted-foreground">No vehicles needing attention.</p>
          ) : (
            vehicles.map((v) => (
              <Link
                key={v.id}
                href={`/staff/fleet?tab=vehicles`}
                className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2.5 hover:bg-muted/50"
              >
                <span className="font-medium">
                  {v.internalCode} · {v.make} {v.model}
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatAttentionLabel(v, in30, in14)}
                </span>
              </Link>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function formatAttentionLabel(
  v: {
    regoExpiry: Date | null;
    ctpExpiry: Date | null;
    insuranceExpiry: Date | null;
    nextServiceDueDate: Date | null;
  },
  in30: Date,
  in14: Date,
): string {
  const parts: string[] = [];
  if (v.regoExpiry && v.regoExpiry < in30) parts.push(`Rego ${formatDate(v.regoExpiry)}`);
  if (v.ctpExpiry && v.ctpExpiry < in30) parts.push(`CTP ${formatDate(v.ctpExpiry)}`);
  if (v.insuranceExpiry && v.insuranceExpiry < in30)
    parts.push(`Ins ${formatDate(v.insuranceExpiry)}`);
  if (v.nextServiceDueDate && v.nextServiceDueDate < in14)
    parts.push(`Service ${formatDate(v.nextServiceDueDate)}`);
  return parts.join(" · ");
}

function Kpi({ label, value, tone }: { label: string; value: number; tone?: "warn" }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-normal text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div
          className={`font-display text-2xl font-semibold tracking-tight ${
            tone === "warn" ? "text-destructive" : "text-foreground"
          }`}
        >
          {value}
        </div>
      </CardContent>
    </Card>
  );
}
