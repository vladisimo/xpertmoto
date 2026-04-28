import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/page-header";
import { PageShell } from "@/components/layout/page-section";

export default function Loading() {
  return (
    <PageShell full>
      <PageHeader
        eyebrow="Administration"
        title="Admin dashboard"
        description="Organisation-wide overview."
      />

      <div className="border-b flex items-center gap-1 px-1">
        {["Overview", "Risk", "Debt", "Support"].map((t) => (
          <div key={t} className="h-10 px-4 flex items-center">
            <div className="h-4 w-14 rounded bg-muted animate-pulse" />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {["Today's revenue", "MTD revenue", "Active rentals", "New customers"].map((label) => (
          <Card key={label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-normal text-muted-foreground">{label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-9 w-24 rounded-md bg-muted animate-pulse" />
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="h3">Revenue trend</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64 w-full rounded-md bg-muted/50 animate-pulse" />
        </CardContent>
      </Card>
    </PageShell>
  );
}
