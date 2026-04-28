import { Card, CardContent, CardHeader } from "@/components/ui/card";

export default function Loading() {
  return (
    <div className="container py-12">
      <div className="h-12 w-48 rounded bg-muted animate-pulse" />
      <div className="mt-2 h-5 w-80 rounded bg-muted animate-pulse" />

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 mt-10">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i} className="overflow-hidden">
            <div className="relative aspect-video bg-muted animate-pulse" />
            <CardHeader className="space-y-2">
              <div className="h-6 w-40 rounded bg-muted animate-pulse" />
              <div className="h-4 w-56 rounded bg-muted animate-pulse" />
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="h-4 w-full rounded bg-muted animate-pulse" />
              <div className="h-4 w-5/6 rounded bg-muted animate-pulse" />
              <div className="mt-3 h-9 w-32 rounded-md bg-muted animate-pulse" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
