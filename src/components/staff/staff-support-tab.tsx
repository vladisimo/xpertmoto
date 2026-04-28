import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PendingSupportCard } from "@/components/support/pending-support-card";

export function StaffSupportTab() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto">
      <Card className="flex min-h-0 flex-col">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Pending support at this depot</CardTitle>
          <p className="text-caption text-muted-foreground">
            Tickets awaiting a reply — triage here before they escalate.
          </p>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col">
          <PendingSupportCard href="/staff/support" />
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button asChild variant="secondary" size="sm">
          <Link href="/staff/support">Support inbox →</Link>
        </Button>
        <Button asChild variant="secondary" size="sm">
          <Link href="/staff/communications">Communications →</Link>
        </Button>
      </div>
    </div>
  );
}
