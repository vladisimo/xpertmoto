import { PageShell } from "@/components/layout/page-section";

export default function Loading() {
  return (
    <PageShell>
      <div aria-busy="true" className="space-y-4">
        <div className="h-7 w-56 animate-pulse rounded-md bg-muted" />
        <div className="h-4 w-80 animate-pulse rounded bg-muted" />
        <div className="mt-4 h-72 animate-pulse rounded-lg bg-muted/60" />
      </div>
    </PageShell>
  );
}
