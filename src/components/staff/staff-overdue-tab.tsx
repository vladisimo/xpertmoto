import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NotReturnedBikes } from "@/components/staff/not-returned-bikes";
import { findNotReturnedBookings } from "@/server/services/staff-ops-signals";

export async function StaffOverdueTab({ depotId }: { depotId?: string }) {
  const rows = await findNotReturnedBookings(depotId);
  const stage1Plus = rows.filter((r) => r.overdueStage >= 1).length;
  const stage3Plus = rows.filter((r) => r.overdueStage >= 3).length;
  const unreturned24hPlus = rows.filter((r) => r.hoursOverdue >= 24).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="grid gap-3 md:grid-cols-4">
        <Kpi label="Not returned" value={rows.length} tone={rows.length > 0 ? "warn" : undefined} />
        <Kpi label="Notice sent" value={stage1Plus} />
        <Kpi label="Manager escalation" value={stage3Plus} tone={stage3Plus > 0 ? "warn" : undefined} />
        <Kpi label="Over 24 hours" value={unreturned24hPlus} tone={unreturned24hPlus > 0 ? "warn" : undefined} />
      </div>

      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Not returned</CardTitle>
          <p className="text-caption text-muted-foreground">
            Bookings past their scheduled return. Stage reflects the automated escalation (notice at +1h,
            second nudge at +12h, manager at +24h, theft filed at +72h).
          </p>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
          <div className="min-h-0 flex-1 overflow-auto">
            <NotReturnedBikes rows={rows} />
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
