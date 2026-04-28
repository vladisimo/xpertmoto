"use client";

import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import { StatusBadge } from "@/components/ui/status-badge";
import { Spinner } from "@/components/ui/spinner";
import { formatDistanceToNow } from "date-fns";

/**
 * Compact "pending support work" card for the staff + admin dashboards.
 * Shows urgent/high counts plus the five oldest open tickets so staff
 * can see backlog at a glance without clicking through to the inbox.
 */
export function PendingSupportCard({ href = "/staff/support" }: { href?: string }) {
  const { data, isLoading } = trpc.support.dashboardPending.useQuery(undefined, {
    refetchInterval: 60_000,
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Tile label="Total" value={data?.total ?? "—"} />
        <Tile
          label="Urgent"
          value={data?.urgent ?? "—"}
          emphasis={data?.urgent ? "danger" : undefined}
        />
        <Tile label="High" value={data?.high ?? "—"} />
      </div>

      <div className="space-y-2">
        {isLoading && (
          <div className="flex justify-center py-2"><Spinner size="sm" /></div>
        )}
        {data?.oldest.length === 0 && (
          <p className="text-xs text-muted-foreground">No pending tickets — nice work.</p>
        )}
        {(data?.oldest ?? []).map((t) => (
          <Link
            key={t.id}
            href={`${href}/${t.id}`}
            className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm hover:bg-muted"
          >
            <div className="min-w-0 flex-1 truncate">
              <p className="truncate text-sm font-medium">{t.summary}</p>
              <p className="truncate text-xs text-muted-foreground">
                {t.customer
                  ? `${t.customer.firstName} ${t.customer.lastName}`
                  : (t.conversation.guestName ?? "Guest")}
                {t.depot ? ` · ${t.depot.name}` : ""} · opened{" "}
                {formatDistanceToNow(t.createdAt, { addSuffix: true })}
              </p>
            </div>
            <StatusBadge status={t.priority} />
          </Link>
        ))}
      </div>

      <div className="text-right">
        <Link
          href={href}
          className="text-xs text-primary underline-offset-2 hover:underline"
        >
          Open inbox →
        </Link>
      </div>
    </div>
  );
}

function Tile({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: number | string;
  emphasis?: "danger";
}) {
  return (
    <div
      className={
        emphasis === "danger"
          ? "rounded-md border border-destructive/40 bg-destructive/10 p-3"
          : "rounded-md border bg-muted/40 p-3"
      }
    >
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}
