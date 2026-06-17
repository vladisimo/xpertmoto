import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatCurrency, formatDate } from "@/lib/utils";
import { AdminRiskStats } from "@/components/admin/admin-risk-stats";
import { AccidentsTrend } from "@/components/admin/accidents-trend";
import {
  getDebtorsSummary,
  getIncidentsSummary,
  getTheftsOpen,
  getUnpaidInfringementsSummary,
} from "@/server/queries/cached";

export async function AdminRiskTab() {
  const [incidents, thefts, infringements, debtorsStats] = await Promise.all([
    getIncidentsSummary(),
    getTheftsOpen(),
    getUnpaidInfringementsSummary(),
    getDebtorsSummary(),
  ]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto">
      <AdminRiskStats
        data={{ incidents, thefts, infringements, debtors: debtorsStats }}
      />

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-5">
        <Card className="flex min-h-0 flex-col lg:col-span-3">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Accidents — last 12 months</CardTitle>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col">
            <AccidentsTrend data={incidents.trend12m} />
          </CardContent>
        </Card>

        <Card className="flex min-h-0 flex-col lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden />
              Open thefts
            </CardTitle>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto text-sm">
            {thefts.incidents.length === 0 && thefts.stolenVehicles.length === 0 ? (
              <p className="text-muted-foreground">No open theft incidents.</p>
            ) : (
              <>
                {thefts.incidents.map((i) => (
                  <Link
                    key={i.id}
                    href={`/staff/fleet/incidents`}
                    className="flex items-start justify-between gap-2 rounded-md border border-border bg-background px-3 py-2 hover:bg-muted/50"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">
                        {i.incidentNumber} · {i.vehicleCode}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {i.vehicleRego}
                        {i.customerName ? ` · ${i.customerName}` : ""} · {formatDate(i.dateTime)}
                      </div>
                    </div>
                    <div className="shrink-0 text-right text-xs">
                      <StatusBadge
                        status={i.status as "REPORTED" | "UNDER_INVESTIGATION" | "ASSESSED" | "INSURANCE_CLAIM"}
                      />
                      {i.estimatedCost > 0 && (
                        <div className="mt-0.5 text-muted-foreground">
                          {formatCurrency(i.estimatedCost)}
                        </div>
                      )}
                    </div>
                  </Link>
                ))}
                {thefts.stolenVehicles.map((v) => (
                  <Link
                    key={v.id}
                    href={`/staff/fleet/vehicles`}
                    className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2 hover:bg-muted/50"
                  >
                    <div className="min-w-0 truncate">
                      <span className="font-medium">{v.internalCode}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {v.rego} · {v.make} {v.model}
                      </span>
                    </div>
                    <StatusBadge status="STOLEN" />
                  </Link>
                ))}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
