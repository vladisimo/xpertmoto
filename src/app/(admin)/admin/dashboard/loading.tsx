import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Content skeleton for the dashboard tab routes. The chrome (PageShell,
 * PageHeader, tab bar) is rendered by the section layout, so this only fills
 * the {children} slot while a tab's server component resolves.
 */
export default function Loading() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
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

      <Card className="flex-1">
        <CardHeader>
          <CardTitle className="h3">Revenue trend</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64 w-full rounded-md bg-muted/50 animate-pulse" />
        </CardContent>
      </Card>
    </div>
  );
}
