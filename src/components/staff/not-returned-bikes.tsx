import Link from "next/link";
import Image from "next/image";
import { AlertTriangle, ImageIcon, PhoneCall } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import type { NotReturnedBooking } from "@/server/services/staff-ops-signals";

const STAGE_LABEL: Record<number, string> = {
  0: "Stage 0 — due",
  1: "Stage 1 — notice sent",
  2: "Stage 2 — second nudge",
  3: "Stage 3 — manager",
  4: "Stage 4 — theft filed",
};

export function NotReturnedBikes({ rows }: { rows: NotReturnedBooking[] }) {
  if (rows.length === 0) {
    return null;
  }

  return (
    // Two columns only while the card spans the full page width (stacked
    // md–lg layout); inside the lg three-column row it stays single-column.
    <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-1">
      {rows.map((r) => (
        <OverdueCard key={r.id} r={r} />
      ))}
    </div>
  );
}

function OverdueCard({ r }: { r: NotReturnedBooking }) {
  const v = r.vehicle;
  const image = v?.images[0];
  const title = v ? `${v.year} ${v.make} ${v.model}` : r.category.name;
  const imageAlt = image?.caption ?? title;
  const stageLabel = STAGE_LABEL[r.overdueStage] ?? `Stage ${r.overdueStage}`;

  return (
    <div className="flex items-center gap-3 rounded-md border border-destructive/30 bg-destructive/[0.03] px-3 py-2.5">
      <Link
        href={`/staff/bookings/${r.id}`}
        aria-label={`Open booking ${r.bookingReference}`}
        className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md bg-muted ring-offset-background transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        {image ? (
          <Image src={image.url} alt={imageAlt} fill sizes="56px" className="object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-muted-foreground">
            <ImageIcon className="h-5 w-5" aria-hidden />
          </span>
        )}
      </Link>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {v && (
            <span className="shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs font-semibold tracking-wider">
              {v.rego}
            </span>
          )}
          <Link
            href={`/staff/bookings/${r.id}`}
            className="truncate font-semibold hover:underline"
          >
            {title}
          </Link>
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {v ? (
            <>
              {v.colour} · {v.regoState} · {v.internalCode}
            </>
          ) : (
            "Vehicle not allocated"
          )}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          <Link
            href={`/staff/customers/${r.customer.id}`}
            className="font-medium text-foreground hover:underline"
          >
            {r.customer.firstName} {r.customer.lastName}
          </Link>{" "}
          ·{" "}
          {r.customer.phone ? (
            <a href={`tel:${r.customer.phone}`} className="text-primary hover:underline">
              {r.customer.phone}
            </a>
          ) : (
            r.customer.email
          )}{" "}
          · {r.bookingReference}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          due {formatDateTime(r.returnDateTime)} ·{" "}
          <span className="font-medium text-destructive">{r.hoursOverdue}h overdue</span>
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-2">
        <StatusBadge status="OVERDUE" label={stageLabel} />
        {r.balanceDue > 0 && (
          <span className="text-xs text-muted-foreground">{formatCurrency(r.balanceDue)} owed</span>
        )}
        <div className="flex items-center gap-2">
          {r.customer.phone && (
            <Button asChild size="sm" variant="ghost">
              <a href={`tel:${r.customer.phone}`} aria-label="Call customer">
                <PhoneCall className="h-4 w-4" aria-hidden />
              </a>
            </Button>
          )}
          <Button asChild size="sm">
            <Link href={`/staff/bookings/${r.id}/check-in`}>
              <AlertTriangle className="mr-1 h-3.5 w-3.5" aria-hidden />
              Check in
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
