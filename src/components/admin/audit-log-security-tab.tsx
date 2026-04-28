"use client";

import { trpc } from "@/lib/trpc/client";
import { AuditLogSecurityStats } from "./audit-log-security-stats";
import { AuditLogTableView } from "./audit-log-table-view";

/**
 * Security tab: rate-limit trips, lockouts, failed auth, denied requests.
 * Top-half shows security-specific stats + top offending IPs. Bottom-half
 * is a filterable table pre-scoped to status IN (FAILURE, DENIED) so only
 * rejections land here — successful traffic is one click away in the
 * Activity or All events tabs.
 */
export function AuditLogSecurityTab() {
  const statsQuery = trpc.admin.auditSecurityStats.useQuery(
    { range: "24h" },
    { staleTime: 30_000 },
  );
  const data = statsQuery.data;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-hidden">
      <div className="shrink-0 space-y-4">
        <AuditLogSecurityStats data={data} loading={statsQuery.isLoading} />
        <div className="grid gap-4 md:grid-cols-2">
          <TopList
            title="Top offending IPs"
            description="By failed or denied events (last 24h)"
            rows={data?.topIps.map((r) => ({ label: r.ip, count: r.count })) ?? []}
            loading={statsQuery.isLoading}
            monospace
          />
          <TopList
            title="Top tripped endpoints"
            description="Actions with the most rejections (last 24h)"
            rows={data?.topActions.map((r) => ({ label: r.action, count: r.count })) ?? []}
            loading={statsQuery.isLoading}
            monospace
          />
        </div>
      </div>

      <AuditLogTableView
        baseFilters={{ statusIn: ["FAILURE", "DENIED"] }}
        showFilters={{ category: true, status: false, action: true, entity: false, date: true }}
        description="All rejected auth and API calls in scope. Click a row for request details including IP and user agent."
      />
    </div>
  );
}

function TopList({
  title,
  description,
  rows,
  loading,
  monospace,
}: {
  title: string;
  description: string;
  rows: { label: string; count: number }[];
  loading?: boolean;
  monospace?: boolean;
}) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="h3">{title}</h3>
        <span className="text-xs text-muted-foreground">{description}</span>
      </div>
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-4 w-full animate-pulse rounded bg-muted" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">Nothing to show.</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.slice(0, 5).map((r) => (
            <li key={r.label} className="space-y-0.5">
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className={`min-w-0 truncate ${monospace ? "font-mono" : ""}`}>
                  {r.label}
                </span>
                <span className="tabular-nums text-foreground">{r.count}</span>
              </div>
              <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-destructive/70"
                  style={{ width: `${(r.count / max) * 100}%` }}
                  aria-hidden
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
