"use client";

import * as React from "react";
import { trpc } from "@/lib/trpc/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { StatusBadge } from "@/components/ui/status-badge";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function SessionDetailSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const query = trpc.liveAnalytics.sessionDetail.useQuery(
    { id: id ?? "" },
    { enabled: !!id, refetchOnWindowFocus: false },
  );
  const data = query.data;

  return (
    <Sheet open={!!id} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="flex h-full w-full max-w-2xl flex-col overflow-hidden p-0 sm:max-w-2xl">
        <SheetHeader className="border-b px-6 py-4">
          <SheetTitle>Visitor session</SheetTitle>
          <SheetDescription>
            Page-view timeline and chat transcript for this session.
          </SheetDescription>
        </SheetHeader>

        {!data ? (
          <div className="flex flex-1 items-center justify-center text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : (
          <div className="flex-1 space-y-5 overflow-y-auto p-6">
            <section className="grid grid-cols-2 gap-3 text-sm">
              <Meta label="Visitor">
                {data.user
                  ? [data.user.firstName, data.user.lastName].filter(Boolean).join(" ") || data.user.email
                  : "Guest"}
              </Meta>
              <Meta label="Outcome">
                {data.outcome ? (
                  <StatusBadge status={data.outcome === "BOUNCED" ? "VISITOR_BOUNCED" : data.outcome} />
                ) : (
                  <span className="text-muted-foreground">Pending</span>
                )}
              </Meta>
              <Meta label="Country">
                {[data.country, data.region, data.city].filter(Boolean).join(" · ") || "Unknown"}
              </Meta>
              <Meta label="Device">{data.deviceType ?? "—"}</Meta>
              <Meta label="Referrer">{data.referrer ?? "direct"}</Meta>
              <Meta label="UTM source">{data.utmSource ?? "—"}</Meta>
              <Meta label="Duration">
                {data.durationSeconds != null ? formatDuration(data.durationSeconds) : "live"}
              </Meta>
              <Meta label="Pages viewed">{data.totalPageViews}</Meta>
              <Meta label="Highest step">
                {data.wizardHighestStep ? `Step ${data.wizardHighestStep}` : "—"}
              </Meta>
              <Meta label="Converted booking">
                {data.convertedBooking ? (
                  <span className="font-mono text-primary">{data.convertedBooking.bookingReference}</span>
                ) : (
                  "—"
                )}
              </Meta>
            </section>

            {data.cart && (
              <section className="rounded-md border border-dashed bg-muted/30 p-4">
                <div className="mb-2 flex items-baseline justify-between">
                  <h3 className="h3 text-sm">
                    {data.outcome === "ABANDONED_WIZARD" ? "Abandoned with" : "Cart at last heartbeat"}
                  </h3>
                  {data.cart.quotedTotalCents != null && (
                    <span className="font-display text-lg font-semibold tabular-nums text-primary">
                      ${(data.cart.quotedTotalCents / 100).toLocaleString("en-AU", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </span>
                  )}
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  {data.cart.depotLabel && (
                    <>
                      <dt className="text-muted-foreground">Pickup depot</dt>
                      <dd className="text-foreground">{data.cart.depotLabel}</dd>
                    </>
                  )}
                  {data.cart.categoryLabel && (
                    <>
                      <dt className="text-muted-foreground">Category</dt>
                      <dd className="text-foreground">{data.cart.categoryLabel}</dd>
                    </>
                  )}
                  {data.cart.vehicleLabel && (
                    <>
                      <dt className="text-muted-foreground">Vehicle</dt>
                      <dd className="text-foreground">{data.cart.vehicleLabel}</dd>
                    </>
                  )}
                  {data.cart.discountCode && (
                    <>
                      <dt className="text-muted-foreground">Discount code</dt>
                      <dd className="font-mono text-foreground">{data.cart.discountCode}</dd>
                    </>
                  )}
                </dl>
              </section>
            )}

            <section>
              <h3 className="h3 mb-2 text-sm">Activity timeline</h3>
              {data.pageViews.length === 0 && data.events.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No page views or events recorded.
                </p>
              ) : (
                <TimelineView
                  pageViews={data.pageViews.map((p) => ({
                    id: p.id,
                    path: p.path,
                    enteredAt: new Date(p.enteredAt),
                    durationMs: p.durationMs,
                  }))}
                  events={data.events.map((e) => ({
                    id: e.id,
                    kind: e.kind,
                    path: e.path,
                    target: e.target,
                    value: e.value,
                    numericValue: e.numericValue,
                    occurredAt: new Date(e.occurredAt),
                  }))}
                />
              )}
            </section>

            <section>
              <h3 className="h3 mb-2 text-sm">Chat transcript</h3>
              {!data.conversation ? (
                <p className="text-sm text-muted-foreground">No chat conversation on this session.</p>
              ) : data.conversation.messages.length === 0 ? (
                <p className="text-sm text-muted-foreground">Conversation has no messages.</p>
              ) : (
                <ul className="space-y-2">
                  {data.conversation.messages.map((m) => (
                    <li
                      key={m.id}
                      className={cn(
                        "flex",
                        m.senderRole === "STAFF" ? "justify-end" : "justify-start",
                      )}
                    >
                      <div
                        className={cn(
                          "max-w-[85%] rounded-md px-3 py-2 text-sm whitespace-pre-wrap",
                          m.senderRole === "STAFF"
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-foreground",
                        )}
                      >
                        <p className="mb-0.5 text-[10px] uppercase tracking-wider opacity-70">
                          {m.senderRole.toLowerCase()} · {formatDateTime(m.createdAt)}
                        </p>
                        <p>{m.body}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

interface TimelinePageView {
  id: string;
  path: string;
  enteredAt: Date;
  durationMs: number | null;
}

interface TimelineEvent {
  id: string;
  kind: string;
  path: string;
  target: string | null;
  value: string | null;
  numericValue: number | null;
  occurredAt: Date;
}

function TimelineView({
  pageViews,
  events,
}: {
  pageViews: TimelinePageView[];
  events: TimelineEvent[];
}) {
  // Interleave page views and events on a single time-ordered axis so
  // staff can see the moment-by-moment visitor journey.
  const items: Array<
    | { kind: "page"; id: string; at: Date; data: TimelinePageView }
    | { kind: "event"; id: string; at: Date; data: TimelineEvent }
  > = [
    ...pageViews.map(
      (p) => ({ kind: "page" as const, id: `pv-${p.id}`, at: p.enteredAt, data: p }),
    ),
    ...events.map(
      (e) => ({ kind: "event" as const, id: `ev-${e.id}`, at: e.occurredAt, data: e }),
    ),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());

  return (
    <ol className="space-y-2 border-l pl-4">
      {items.map((it) => (
        <li key={it.id} className="relative">
          <span
            className={cn(
              "absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full",
              it.kind === "page" ? "bg-primary" : "bg-accent",
            )}
          />
          <div className="flex items-baseline justify-between gap-2">
            {it.kind === "page" ? (
              <>
                <span className="font-mono text-xs text-foreground">{it.data.path}</span>
                <span className="text-xs text-muted-foreground">
                  {formatDateTime(it.at)}
                  {it.data.durationMs != null && ` · ${Math.round(it.data.durationMs / 1000)}s`}
                </span>
              </>
            ) : (
              <>
                <div className="min-w-0">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-accent-foreground">
                    {it.data.kind.replace(/_/g, " ").toLowerCase()}
                  </span>
                  {it.data.target && (
                    <span className="ml-2 font-mono text-[11px] text-foreground">
                      {it.data.target}
                    </span>
                  )}
                  {it.data.value && (
                    <span className="ml-2 text-xs text-muted-foreground">"{it.data.value}"</span>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">{formatDateTime(it.at)}</span>
              </>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

function formatDateTime(d: Date | string): string {
  return new Date(d).toLocaleString("en-AU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
