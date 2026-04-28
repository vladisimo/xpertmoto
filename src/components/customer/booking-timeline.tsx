import { cn, formatCurrency, formatDateTime } from "@/lib/utils";

type StatusKey = string;

type StatusLogEntry = {
  previousStatus: StatusKey | null;
  newStatus: StatusKey;
  reason: string | null;
  timestamp: Date;
};

type PaymentEntry = {
  type: string;
  amount: unknown;
  status: string;
  receiptUrl: string | null;
  receiptPdfUrl: string | null;
  createdAt: Date;
};

type DepotSnapshot = { name: string };

type BookingForTimeline = {
  createdAt: Date;
  pickupDateTime: Date;
  returnDateTime: Date;
  actualPickupDateTime: Date | null;
  actualReturnDateTime: Date | null;
  pickupDepot: DepotSnapshot;
  returnDepot: DepotSnapshot;
  statusLog: StatusLogEntry[];
  payments: PaymentEntry[];
};

type Tone = "primary" | "muted" | "warning" | "success";

type Event = {
  at: Date;
  future: boolean;
  tone: Tone;
  title: string;
  meta?: string;
  link?: { href: string; label: string };
};

const STATUS_LABEL: Record<string, string> = {
  QUOTE: "Quote drafted",
  PENDING_PAYMENT: "Awaiting payment",
  CONFIRMED: "Confirmed",
  CHECKED_OUT: "Checked out",
  ACTIVE: "On hire",
  OVERDUE: "Marked overdue",
  RETURNED: "Returned",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  NO_SHOW: "No show",
  DISPUTED: "Payment disputed",
};

const STATUS_TONE: Record<string, Tone> = {
  CANCELLED: "warning",
  NO_SHOW: "warning",
  DISPUTED: "warning",
  OVERDUE: "warning",
  COMPLETED: "success",
  RETURNED: "success",
  CONFIRMED: "success",
};

const PAYMENT_LABEL: Record<string, string> = {
  BOOKING_PAYMENT: "Booking payment",
  BOND_HOLD: "Bond authorised",
  BOND_CAPTURE: "Bond captured",
  BOND_RELEASE: "Bond released",
  REFUND: "Refund issued",
  EXTENSION: "Extension charged",
  DAMAGE_CHARGE: "Damage charged",
  LATE_FEE: "Late fee",
  FUEL_CHARGE: "Fuel charge",
  CLEANING_FEE: "Cleaning fee",
};

const VISIBLE_PAYMENT_TYPES = new Set(Object.keys(PAYMENT_LABEL));

function statusLabel(status: string | null): string {
  if (!status) return "—";
  return STATUS_LABEL[status] ?? status.replace(/_/g, " ").toLowerCase();
}

function paymentLink(p: PaymentEntry): Event["link"] | undefined {
  const href = p.receiptPdfUrl ?? p.receiptUrl;
  return href ? { href, label: "Receipt" } : undefined;
}

function buildEvents(b: BookingForTimeline, now: Date): Event[] {
  const events: Event[] = [];

  events.push({
    at: b.createdAt,
    future: false,
    tone: "muted",
    title: "Booking created",
  });

  for (const log of b.statusLog) {
    events.push({
      at: log.timestamp,
      future: false,
      tone: STATUS_TONE[log.newStatus] ?? "primary",
      title: statusLabel(log.newStatus),
      meta:
        log.reason ??
        (log.previousStatus
          ? `From ${statusLabel(log.previousStatus).toLowerCase()}`
          : undefined),
    });
  }

  for (const p of b.payments) {
    if (p.status !== "SUCCEEDED") continue;
    if (!VISIBLE_PAYMENT_TYPES.has(p.type)) continue;
    const amount = Number(p.amount);
    events.push({
      at: p.createdAt,
      future: false,
      tone: p.type === "REFUND" ? "warning" : "primary",
      title: PAYMENT_LABEL[p.type] ?? p.type,
      meta: amount > 0 ? formatCurrency(amount) : undefined,
      link: paymentLink(p),
    });
  }

  if (b.actualPickupDateTime) {
    events.push({
      at: b.actualPickupDateTime,
      future: false,
      tone: "success",
      title: "Picked up",
      meta: b.pickupDepot.name,
    });
  } else {
    events.push({
      at: b.pickupDateTime,
      future: b.pickupDateTime.getTime() > now.getTime(),
      tone: "muted",
      title: "Scheduled pickup",
      meta: b.pickupDepot.name,
    });
  }

  if (b.actualReturnDateTime) {
    events.push({
      at: b.actualReturnDateTime,
      future: false,
      tone: "success",
      title: "Returned",
      meta: b.returnDepot.name,
    });
  } else {
    events.push({
      at: b.returnDateTime,
      future: b.returnDateTime.getTime() > now.getTime(),
      tone: "muted",
      title: "Scheduled return",
      meta: b.returnDepot.name,
    });
  }

  return events.sort((a, b) => a.at.getTime() - b.at.getTime());
}

const DOT_TONE: Record<Tone, string> = {
  primary: "bg-primary border-primary",
  muted: "bg-background border-border",
  warning: "bg-destructive border-destructive",
  success: "bg-primary border-primary",
};

export function BookingTimeline({ booking }: { booking: BookingForTimeline }) {
  const events = buildEvents(booking, new Date());

  return (
    <ol className="relative">
      {events.map((e, i) => {
        const last = i === events.length - 1;
        const filled = !e.future;
        return (
          <li key={i} className="flex gap-3 pb-4 last:pb-0">
            <div className="relative flex flex-col items-center">
              <span
                aria-hidden
                className={cn(
                  "mt-1.5 h-3 w-3 shrink-0 rounded-full border-2",
                  filled
                    ? DOT_TONE[e.tone]
                    : "bg-background border-border opacity-60",
                )}
              />
              {!last && (
                <span
                  aria-hidden
                  className="mt-1 w-px flex-1 bg-border"
                />
              )}
            </div>
            <div className="min-w-0 flex-1 pb-2">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {formatDateTime(e.at)}
              </p>
              <p
                className={cn(
                  "text-sm font-medium",
                  e.future && "text-muted-foreground",
                )}
              >
                {e.title}
              </p>
              {(e.meta || e.link) && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {e.meta}
                  {e.meta && e.link && " · "}
                  {e.link && (
                    <a
                      href={e.link.href}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary underline-offset-2 hover:underline"
                    >
                      {e.link.label}
                    </a>
                  )}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
