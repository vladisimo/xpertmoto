import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { PageSection, PageShell } from "@/components/layout/page-section";

export default function Loading() {
  return (
    <PageShell>
      <PageHeader eyebrow="Operations" title="Staff dashboard" />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {["Today's pickups", "Today's returns", "Active rentals", "Not returned"].map((label) => (
          <Card key={label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-normal text-muted-foreground">{label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-9 w-16 rounded-md bg-muted animate-pulse" />
            </CardContent>
          </Card>
        ))}
      </div>

      <PageSection title="Today's pickups">
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2.5"
            >
              <div className="min-w-0 space-y-2 flex-1">
                <div className="h-4 w-48 rounded bg-muted animate-pulse" />
                <div className="h-3 w-72 rounded bg-muted animate-pulse" />
              </div>
              <div className="h-4 w-16 rounded bg-muted animate-pulse" />
              <div className="h-8 w-24 rounded-md bg-muted animate-pulse" />
            </div>
          ))}
        </div>
      </PageSection>

      <PageSection title="Today's returns">
        <div className="space-y-2">
          {[0, 1].map((i) => (
            <div
              key={i}
              className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2.5"
            >
              <div className="min-w-0 space-y-2 flex-1">
                <div className="h-4 w-48 rounded bg-muted animate-pulse" />
                <div className="h-3 w-72 rounded bg-muted animate-pulse" />
              </div>
              <div className="h-8 w-24 rounded-md bg-muted animate-pulse" />
            </div>
          ))}
        </div>
      </PageSection>
    </PageShell>
  );
}
