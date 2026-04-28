import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge, type StatusKey } from "@/components/ui/status-badge";

const LANES = ["OPEN", "ASSIGNED", "IN_PROGRESS", "AWAITING_PARTS", "COMPLETED"] as const;

export async function FleetMaintenanceTab() {
  const orders = await prisma.maintenanceWorkOrder.findMany({
    include: { vehicle: true, assignedTo: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Click a card to update status, costs, and logs.
      </p>

      <div
        className="flex flex-col gap-4 md:grid md:overflow-x-auto"
        style={{ gridTemplateColumns: `repeat(${LANES.length}, minmax(220px, 1fr))` }}
      >
        {LANES.map((lane) => {
          const laneOrders = orders.filter((o) => o.status === lane);
          return (
            <div key={lane} className="space-y-2 rounded-lg border bg-muted/20 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="eyebrow text-foreground">{lane.replace("_", " ")}</span>
                <span className="text-xs tabular-nums text-muted-foreground md:hidden">
                  {laneOrders.length}
                </span>
              </div>
              {laneOrders.length === 0 ? (
                <p className="text-xs text-muted-foreground md:hidden">No work orders.</p>
              ) : null}
              {laneOrders.map((o) => (
                <Link key={o.id} href={`/staff/maintenance/${o.id}`}>
                  <Card className="transition hover:border-primary">
                    <CardContent className="space-y-1 p-3 text-xs">
                      <div className="font-medium">{o.workOrderNumber}</div>
                      <div className="text-muted-foreground">
                        {o.vehicle.internalCode} · {o.type.replace("_", " ")}
                      </div>
                      <div className="text-muted-foreground">{o.title}</div>
                      <div className="flex justify-between">
                        <StatusBadge status={o.priority as StatusKey} />
                        {o.assignedTo && <span>{o.assignedTo.firstName}</span>}
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
