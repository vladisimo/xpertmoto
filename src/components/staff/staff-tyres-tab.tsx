import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TyreAlerts } from "@/components/staff/tyre-alerts";
import { getTyreAlerts } from "@/server/queries/cached";

export async function StaffTyresTab({ depotId }: { depotId?: string }) {
  const rows = await getTyreAlerts(depotId);
  const lowTread = rows.filter((r) => r.reason === "LOW_TREAD").length;
  const highKm = rows.filter((r) => r.reason === "HIGH_KM_SINCE_REPLACEMENT").length;
  const stale = rows.filter((r) => r.reason === "STALE_INSPECTION").length;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="grid gap-3 md:grid-cols-4">
        <Kpi label="Total alerts" value={rows.length} tone={rows.length > 0 ? "warn" : undefined} />
        <Kpi label="Tread < 2mm" value={lowTread} tone={lowTread > 0 ? "warn" : undefined} />
        <Kpi label="High km since last change" value={highKm} />
        <Kpi label="Inspection overdue" value={stale} />
      </div>

      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Tyre alerts</CardTitle>
          <p className="text-caption text-muted-foreground">
            Vehicles flagged for low tread or excessive kilometres since last replacement.
          </p>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
          <div className="min-h-0 flex-1 overflow-auto">
            <TyreAlerts rows={rows} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
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
