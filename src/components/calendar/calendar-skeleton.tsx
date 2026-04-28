import { PageHeader } from "@/components/layout/page-header";

export function CalendarSkeleton() {
  return (
    <div className="mx-auto flex h-full w-full max-w-screen-2xl flex-col overflow-hidden p-6 lg:p-8">
      <PageHeader
        className="shrink-0 pb-4"
        eyebrow="Operations"
        title="Bookings"
      />

      <div className="flex-1 min-h-0 rounded-lg border bg-card overflow-hidden relative">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="flex items-center gap-2">
            <div className="h-8 w-16 rounded-md bg-muted animate-pulse" />
            <div className="h-8 w-16 rounded-md bg-muted animate-pulse" />
            <div className="h-8 w-20 rounded-md bg-muted animate-pulse" />
          </div>
          <div className="h-6 w-40 rounded bg-muted animate-pulse" />
          <div className="flex items-center gap-2">
            <div className="h-8 w-24 rounded-md bg-muted animate-pulse" />
            <div className="h-[34px] w-[180px] rounded-md bg-muted animate-pulse" />
            <div className="h-[34px] w-[180px] rounded-md bg-muted animate-pulse" />
          </div>
        </div>

        <div className="grid grid-cols-7 border-b bg-muted/30">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="px-3 py-2 text-xs text-muted-foreground">
              <div className="h-3 w-12 rounded bg-muted animate-pulse" />
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 grid-rows-5 h-[calc(100%-8rem)]">
          {Array.from({ length: 35 }).map((_, i) => (
            <div key={i} className="border-r border-b p-2 space-y-1">
              <div className="h-4 w-6 rounded bg-muted animate-pulse" />
              {i % 3 === 0 ? (
                <div className="h-4 w-full rounded bg-muted animate-pulse" />
              ) : null}
              {i % 5 === 0 ? (
                <div className="h-4 w-3/4 rounded bg-muted animate-pulse" />
              ) : null}
            </div>
          ))}
        </div>
      </div>

      <div className="shrink-0 pt-3">
        <div className="h-5 w-64 rounded bg-muted animate-pulse" />
      </div>
    </div>
  );
}
