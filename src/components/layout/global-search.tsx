"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { keepPreviousData } from "@tanstack/react-query";
import {
  CalendarClock,
  Bike,
  User,
  Receipt,
  FileText,
  Loader2,
  HelpCircle,
} from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { searchArticles } from "@/lib/help/manifest.search";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { StatusBadge, type StatusKey } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";

type ShellAccent = "staff" | "admin";

interface GlobalSearchProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accent: ShellAccent;
}

/** Min characters before we hit the server — matches the router's Zod min(3). */
const MIN_QUERY = 3;

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

export function GlobalSearch({ open, onOpenChange, accent }: GlobalSearchProps) {
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const debounced = useDebounced(query.trim(), 250);
  const enabled = debounced.length >= MIN_QUERY;

  // Reset the input each time the palette closes so it opens fresh. Uses the
  // setState-during-render pattern (per the React "You Might Not Need an
  // Effect" docs) to avoid the cascading render the lint rule flags.
  const [lastOpen, setLastOpen] = React.useState(open);
  if (lastOpen !== open) {
    setLastOpen(open);
    if (!open) setQuery("");
  }

  const search = trpc.globalSearch.search.useQuery(
    { query: debounced },
    { enabled, placeholderData: keepPreviousData },
  );

  const iconColor = accent === "admin" ? "text-admin" : "text-staff";
  const helpBase = accent === "admin" ? "/admin/help" : "/staff/help";
  // Help articles are static — searched client-side, no server round-trip.
  const helpHits = enabled ? searchArticles(debounced) : [];
  const data = search.data;
  const hasResults =
    enabled &&
    (helpHits.length > 0 ||
      (data != null &&
        (data.bookings.length > 0 ||
          data.vehicles.length > 0 ||
          data.customers.length > 0 ||
          data.receipts.length > 0 ||
          data.invoices.length > 0)));

  function go(href: string) {
    onOpenChange(false);
    router.push(href);
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      shouldFilter={false}
      title="Search the back office"
      description="Find bookings, vehicles, customers, receipts and tax invoices"
    >
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder="Search bookings, vehicles, customers, receipts, tax invoices…"
      />
      <CommandList>
        {!enabled && (
          <div className="py-8 text-center text-sm text-muted-foreground">
            Type at least {MIN_QUERY} characters to search.
          </div>
        )}

        {enabled && search.isFetching && !hasResults && (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Searching…
          </div>
        )}

        {enabled && !search.isFetching && !hasResults && (
          <CommandEmpty>No matches for “{debounced}”.</CommandEmpty>
        )}

        {hasResults && (
          <>
            {helpHits.length > 0 && (
              <CommandGroup heading="Help & guides">
                {helpHits.map((a) => (
                  <CommandItem
                    key={a.slug}
                    value={`help-${a.slug}`}
                    onSelect={() => go(`${helpBase}/${a.slug}`)}
                  >
                    <HelpCircle className={cn("shrink-0", iconColor)} aria-hidden />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="font-medium">{a.title}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {a.summary}
                      </span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {data?.bookings && data.bookings.length > 0 && (
              <CommandGroup heading="Bookings">
                {data.bookings.map((b) => (
                  <CommandItem
                    key={b.id}
                    value={`booking-${b.id}`}
                    onSelect={() => go(b.href)}
                  >
                    <CalendarClock className={cn("shrink-0", iconColor)} aria-hidden />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{b.reference}</span>
                        <StatusBadge status={b.status as StatusKey} />
                      </div>
                      <span className="truncate text-xs text-muted-foreground">
                        {format(b.pickupDateTime, "d MMM")} –{" "}
                        {format(b.returnDateTime, "d MMM yyyy")} · {b.customerName}
                        {b.vehicleLabel ? ` · ${b.vehicleLabel}` : ""}
                      </span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {data?.vehicles && data.vehicles.length > 0 && (
              <CommandGroup heading="Vehicles">
                {data.vehicles.map((v) => (
                  <CommandItem
                    key={v.id}
                    value={`vehicle-${v.id}`}
                    onSelect={() => go(v.href)}
                  >
                    <Bike className={cn("shrink-0", iconColor)} aria-hidden />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{v.rego}</span>
                        <StatusBadge status={v.status as StatusKey} />
                      </div>
                      <span className="truncate text-xs text-muted-foreground">
                        {v.label} · {v.internalCode}
                      </span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {data?.customers && data.customers.length > 0 && (
              <CommandGroup heading="Customers">
                {data.customers.map((c) => (
                  <CommandItem
                    key={c.id}
                    value={`customer-${c.id}`}
                    onSelect={() => go(c.href)}
                  >
                    <User className={cn("shrink-0", iconColor)} aria-hidden />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="font-medium">{c.name}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {c.email}
                        {c.phone ? ` · ${c.phone}` : ""}
                      </span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {data?.receipts && data.receipts.length > 0 && (
              <CommandGroup heading="Receipts">
                {data.receipts.map((p) => (
                  <CommandItem
                    key={p.id}
                    value={`receipt-${p.id}`}
                    onSelect={() => go(p.href)}
                  >
                    <Receipt className={cn("shrink-0", iconColor)} aria-hidden />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="font-medium">{p.receiptNumber}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        ${p.amount} · Booking {p.bookingReference}
                      </span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {data?.invoices && data.invoices.length > 0 && (
              <CommandGroup heading="Tax invoices">
                {data.invoices.map((inv) => (
                  <CommandItem
                    key={inv.id}
                    value={`invoice-${inv.id}`}
                    onSelect={() => go(inv.href)}
                  >
                    <FileText className={cn("shrink-0", iconColor)} aria-hidden />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{inv.invoiceNumber}</span>
                        <StatusBadge status={inv.status as StatusKey} />
                      </div>
                      <span className="truncate text-xs text-muted-foreground">
                        ${inv.totalAmount} · Booking {inv.bookingReference}
                      </span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
