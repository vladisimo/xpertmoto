import { Activity, DollarSign, ShieldAlert, TrafficCone } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { StatShell } from "@/components/ui/stat-shell";
import type { IncidentsSummary } from "@/server/services/admin-risk-signals";

export interface AdminRiskStatsData {
  incidents: IncidentsSummary;
  thefts: { incidents: Array<{ id: string }>; stolenVehicles: Array<{ id: string }> };
  infringements: { totalAmount: number; totalCount: number };
  debtors: {
    totalOwed: number;
    debtorCount: number;
    bookingPortion: number;
    invoicePortion: number;
    infringementPortion: number;
    remindedInLast7dCount: number;
  };
}

export function AdminRiskStats({ data }: { data: AdminRiskStatsData }) {
  return (
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      <IncidentsCard data={data.incidents} />
      <TheftsCard data={data.thefts} />
      <InfringementsCard data={data.infringements} />
      <DebtCard data={data.debtors} />
    </div>
  );
}

function IncidentsCard({ data }: { data: IncidentsSummary }) {
  const sev = data.mtd.bySeverity;
  const totalSev = sev.MINOR + sev.MODERATE + sev.MAJOR + sev.TOTAL_LOSS;
  return (
    <StatShell title="Incidents this month" icon={<Activity className="h-4 w-4" aria-hidden />}>
      <div className="font-display text-3xl font-semibold tabular-nums text-foreground">
        {data.mtd.total.toLocaleString("en-AU")}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        {data.mtd.byType.ACCIDENT ?? 0} accidents · {data.mtd.byType.CUSTOMER_DAMAGE ?? 0} damage · {data.mtd.byType.VANDALISM ?? 0} vandalism
      </div>
      {totalSev > 0 && (
        <div className="mt-3 flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full"
            style={{
              width: `${(sev.MINOR / totalSev) * 100}%`,
              backgroundColor: "hsl(var(--muted-foreground) / 0.5)",
            }}
            aria-hidden
          />
          <div
            className="h-full"
            style={{
              width: `${(sev.MODERATE / totalSev) * 100}%`,
              backgroundColor: "hsl(var(--secondary))",
            }}
            aria-hidden
          />
          <div
            className="h-full"
            style={{
              width: `${((sev.MAJOR + sev.TOTAL_LOSS) / totalSev) * 100}%`,
              backgroundColor: "hsl(var(--destructive))",
            }}
            aria-hidden
          />
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span>
          <span className="tabular-nums text-foreground">{sev.MINOR}</span> minor
        </span>
        <span>
          <span className="tabular-nums text-foreground">{sev.MODERATE}</span> moderate
        </span>
        <span>
          <span className="tabular-nums text-foreground">{sev.MAJOR + sev.TOTAL_LOSS}</span> major+
        </span>
      </div>
    </StatShell>
  );
}

function TheftsCard({
  data,
}: {
  data: { incidents: Array<{ id: string }>; stolenVehicles: Array<{ id: string }> };
}) {
  const openTheft = data.incidents.length;
  const stolen = data.stolenVehicles.length;
  return (
    <StatShell title="Open thefts" icon={<ShieldAlert className="h-4 w-4" aria-hidden />}>
      <div
        className={`font-display text-3xl font-semibold tabular-nums ${openTheft > 0 ? "text-destructive" : "text-foreground"}`}
      >
        {openTheft.toLocaleString("en-AU")}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        {stolen} vehicle{stolen === 1 ? "" : "s"} currently marked STOLEN
      </div>
    </StatShell>
  );
}

function InfringementsCard({ data }: { data: { totalAmount: number; totalCount: number } }) {
  return (
    <StatShell
      title="Unpaid infringements"
      icon={<TrafficCone className="h-4 w-4" aria-hidden />}
    >
      <div className="font-display text-3xl font-semibold tabular-nums text-foreground">
        {formatCurrency(data.totalAmount)}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        Across {data.totalCount} outstanding item{data.totalCount === 1 ? "" : "s"}
      </div>
    </StatShell>
  );
}

function DebtCard({
  data,
}: {
  data: AdminRiskStatsData["debtors"];
}) {
  const total = data.totalOwed;
  const rows: Array<{ label: string; value: number; color: string }> = [
    { label: "Bookings", value: data.bookingPortion, color: "hsl(var(--primary))" },
    { label: "Invoices", value: data.invoicePortion, color: "hsl(var(--accent))" },
    { label: "Infringements", value: data.infringementPortion, color: "hsl(var(--secondary))" },
  ];
  return (
    <StatShell title="Customer debt" icon={<DollarSign className="h-4 w-4" aria-hidden />}>
      <div className="font-display text-3xl font-semibold tabular-nums text-foreground">
        {formatCurrency(total)}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        {data.debtorCount} customer{data.debtorCount === 1 ? "" : "s"} · {data.remindedInLast7dCount} reminded this week
      </div>
      {total > 0 && (
        <div className="mt-3 space-y-1.5">
          {rows.map((r) => {
            const share = total > 0 ? Math.round((r.value / total) * 100) : 0;
            return (
              <div key={r.label}>
                <div className="flex items-baseline justify-between text-[11px]">
                  <span className="text-muted-foreground">{r.label}</span>
                  <span className="tabular-nums text-foreground">{formatCurrency(r.value)}</span>
                </div>
                <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${share}%`, backgroundColor: r.color }}
                    aria-hidden
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </StatShell>
  );
}
