import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CalendarMistakesView } from "@/components/staff/calendar-mistakes";
import { getCalendarMistakes } from "@/server/queries/cached";

export async function StaffMistakesTab({ depotId }: { depotId?: string }) {
  const mistakes = await getCalendarMistakes(depotId);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="grid gap-3 md:grid-cols-4">
        <Kpi
          label="Unallocated"
          value={mistakes.unallocated.length}
          tone={mistakes.unallocated.length > 0 ? "warn" : undefined}
        />
        <Kpi
          label="Maintenance conflicts"
          value={mistakes.maintenanceConflicts.length}
          tone={mistakes.maintenanceConflicts.length > 0 ? "warn" : undefined}
        />
        <Kpi
          label="Status mismatches"
          value={mistakes.statusMismatches.length}
          tone={mistakes.statusMismatches.length > 0 ? "warn" : undefined}
        />
        <Kpi
          label="Docs expiring mid-booking"
          value={mistakes.docsExpiringWithBooking.length}
          tone={mistakes.docsExpiringWithBooking.length > 0 ? "warn" : undefined}
        />
      </div>

      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Calendar mistakes</CardTitle>
          <p className="text-caption text-muted-foreground">
            Booking ↔ vehicle ↔ maintenance inconsistencies the automatic conflict check doesn&apos;t catch.
          </p>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col overflow-auto">
          <CalendarMistakesView data={mistakes} />
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
