"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { StatusBadge, type StatusKey } from "@/components/ui/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, RefreshCw } from "lucide-react";
import { LoadingBlock, Spinner } from "@/components/ui/spinner";
import { cn, formatCurrency, formatDate, formatDateTime } from "@/lib/utils";

const TOLLS_SUB_TABS = [
  { value: "transactions", label: "Transactions" },
  { value: "unmatched", label: "Unmatched" },
  { value: "history", label: "Sync History" },
] as const;

type TollsSubTab = (typeof TOLLS_SUB_TABS)[number]["value"];

const STATUS_OPTIONS = [
  "RECEIVED",
  "NOMINATED",
  "CUSTOMER_CHARGED",
  "PAID",
  "DISPUTED",
  "WRITTEN_OFF",
] as const;

type StatusFilter = (typeof STATUS_OPTIONS)[number];

function parseTollNotes(notes: string | null): {
  location: string | null;
} {
  if (!notes) return { location: null };
  // Linkt infringement notes read "Toll: <tollpoint>. Source: <...>".
  const locMatch = notes.match(/^Toll:\s*(.+?)\.\s*Source:/);
  return {
    location: locMatch?.[1] ?? null,
  };
}

export function FleetTollsTab() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const accountId = searchParams.get("account") ?? "all";
  const subTab = (searchParams.get("tollsTab") ?? "transactions") as TollsSubTab;

  const setParam = (key: string, value: string | null) => {
    const url = new URL(window.location.href);
    if (value === null) url.searchParams.delete(key);
    else url.searchParams.set(key, value);
    router.replace(url.pathname + url.search, { scroll: false });
  };

  const { data: accounts } = trpc.linkt.listAccounts.useQuery();
  const selectedAccount =
    accountId === "all" ? null : accounts?.find((a) => a.id === accountId) ?? null;

  const { data: unmatchedCount } = trpc.linkt.unmatchedCount.useQuery({
    accountId: accountId === "all" ? undefined : accountId,
  });

  return (
    <div className="space-y-4">
      <AccountSelector
        accounts={accounts ?? []}
        activeId={accountId}
        onSelect={(id) => setParam("account", id === "all" ? null : id)}
      />

      {/*
        The panels live inside <Tabs> so each TabsTrigger's aria-controls
        resolves to a real tabpanel. Radix only renders the selected panel's
        children, so the inactive tabs' queries still don't fire.
      */}
      <Tabs value={subTab} onValueChange={(v) => setParam("tollsTab", v)}>
        <TabsList className="w-full justify-start">
          {TOLLS_SUB_TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value} className="gap-2">
              {t.label}
              {t.value === "unmatched" && unmatchedCount && unmatchedCount > 0 ? (
                <Badge className="h-5 px-1.5 text-[10px]">
                  {unmatchedCount}
                </Badge>
              ) : null}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="transactions">
          <TransactionsTab accountId={accountId === "all" ? undefined : accountId} />
        </TabsContent>
        <TabsContent value="unmatched">
          <UnmatchedTab accountId={accountId === "all" ? undefined : accountId} />
        </TabsContent>
        <TabsContent value="history">
          <HistoryTab accounts={accounts ?? []} scopedAccount={selectedAccount} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function AccountSelector({
  accounts,
  activeId,
  onSelect,
}: {
  accounts: Array<{
    id: string;
    name: string;
    lastSyncAt: Date | null;
    lastSyncStatus: string | null;
    lastSyncError: string | null;
  }>;
  activeId: string;
  onSelect: (id: string) => void;
}) {
  const util = trpc.useUtils();
  const sync = trpc.linkt.runSyncNow.useMutation({
    onSuccess: () => {
      util.linkt.listAccounts.invalidate();
      util.linkt.listSyncs.invalidate();
      util.linkt.listTransactions.invalidate();
    },
  });
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  if (accounts.length === 0) {
    return (
      <div className="text-sm text-muted-foreground border rounded-lg p-4 bg-muted/30">
        No toll integrations connected.{" "}
        <Link href="/admin/integrations" className="underline hover:no-underline">
          Add one in Admin → Integrations
        </Link>
        .
      </div>
    );
  }

  const active = accounts.find((a) => a.id === activeId) ?? null;

  async function runSync(id: string) {
    setSyncMsg(null);
    try {
      const res = await sync.mutateAsync({ id });
      setSyncMsg(`Sync ${res.syncId.slice(0, 8)} → ${res.status}`);
    } catch (e) {
      setSyncMsg(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2 items-center">
        <button
          onClick={() => onSelect("all")}
          className={cn(
            "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
            activeId === "all"
              ? "bg-foreground text-background border-foreground"
              : "bg-background hover:bg-muted",
          )}
        >
          All accounts
        </button>
        {accounts.map((a) => (
          <button
            key={a.id}
            onClick={() => onSelect(a.id)}
            className={cn(
              "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors flex items-center gap-1.5",
              activeId === a.id
                ? "bg-foreground text-background border-foreground"
                : "bg-background hover:bg-muted",
            )}
          >
            {a.name}
            {a.lastSyncStatus && (
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  a.lastSyncStatus === "SUCCESS" && "bg-emerald-500",
                  a.lastSyncStatus === "PARTIAL" && "bg-amber-500",
                  a.lastSyncStatus === "FAILED" && "bg-red-500",
                  a.lastSyncStatus === "RUNNING" && "bg-sky-500",
                )}
              />
            )}
          </button>
        ))}

        {active && (
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            disabled={sync.isPending}
            onClick={() => runSync(active.id)}
          >
            <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", sync.isPending && "animate-spin")} />
            {sync.isPending ? "Syncing…" : `Sync ${active.name}`}
          </Button>
        )}
      </div>

      {active && (
        <div className="text-xs text-muted-foreground">
          {active.lastSyncAt
            ? `Last synced ${formatDateTime(active.lastSyncAt)} → ${active.lastSyncStatus}`
            : "Never synced"}
          {active.lastSyncError && (
            <span className="text-red-600"> · {active.lastSyncError}</span>
          )}
        </div>
      )}

      {syncMsg && <div className="text-xs">{syncMsg}</div>}
    </div>
  );
}

function TransactionsTab({ accountId }: { accountId?: string }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter | null>(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);

  const { data, fetchNextPage, hasNextPage, isFetching, isLoading } =
    trpc.linkt.listTransactions.useInfiniteQuery(
      {
        accountId,
        status: status ?? undefined,
        dateFrom: dateFrom ? new Date(dateFrom) : undefined,
        dateTo: dateTo ? new Date(dateTo + "T23:59:59") : undefined,
        search: debouncedSearch || undefined,
        limit: 50,
      },
      { getNextPageParam: (last) => last.nextCursor ?? undefined },
    );

  const items = data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <Input
          placeholder="Search rego, ref, booking, notes…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-72"
        />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              {status ? `Status: ${status}` : "Status: any"}
              <ChevronDown className="h-3.5 w-3.5 ml-1.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={() => setStatus(null)}>Any</DropdownMenuItem>
            {STATUS_OPTIONS.map((s) => (
              <DropdownMenuItem key={s} onClick={() => setStatus(s)}>
                {s}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">From</span>
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="h-9 w-36"
          />
          <span className="text-muted-foreground">To</span>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="h-9 w-36"
          />
        </div>

        {(status || dateFrom || dateTo || debouncedSearch) && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setStatus(null);
              setDateFrom("");
              setDateTo("");
              setSearch("");
            }}
          >
            Clear
          </Button>
        )}

        <div className="ml-auto text-xs text-muted-foreground">
          {isLoading ? "Loading…" : `${items.length}${hasNextPage ? "+" : ""} result${items.length === 1 ? "" : "s"}`}
        </div>
      </div>

      {isLoading ? (
        <LoadingBlock padded="md" />
      ) : items.length === 0 ? (
        <div className="py-8 text-center text-muted-foreground text-sm">No toll transactions match.</div>
      ) : (
        <div className="rounded-md border overflow-hidden bg-card">
          <div className="max-h-[28rem] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-primary text-primary-foreground">
              <tr className="border-b border-primary/40 text-left">
                <th className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">Date / Time</th>
                <th className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">Vehicle</th>
                <th className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">Customer</th>
                <th className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">Booking</th>
                <th className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">Location</th>
                <th className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">Status</th>
                <th className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80 text-right">Toll</th>
              </tr>
            </thead>
            <tbody className="bg-card">
              {items.map((tx) => {
                const customer = tx.booking?.customer;
                const trip = parseTollNotes(tx.notes);
                return (
                  <tr key={tx.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      {formatDateTime(tx.offenceDate)}
                    </td>
                    <td className="px-4 py-2.5">
                      {tx.vehicle.internalCode}{" "}
                      <span className="text-xs text-muted-foreground">{tx.vehicle.rego}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      {customer ? (
                        <Link
                          href={`/staff/customers/${customer.id}`}
                          className="hover:underline"
                        >
                          {customer.firstName} {customer.lastName}
                        </Link>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {tx.booking?.bookingReference ?? (
                        <span className="text-xs text-muted-foreground">unmatched</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {trip.location ? (
                        <div>{trip.location}</div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={tx.status as StatusKey} />
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium">
                      {formatCurrency(tx.amount.toString())}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {hasNextPage && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchNextPage()}
            disabled={isFetching}
          >
            {isFetching ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}
    </div>
  );
}

function HistoryTab({
  accounts,
  scopedAccount,
}: {
  accounts: Array<{ id: string; name: string }>;
  scopedAccount: { id: string; name: string } | null;
}) {
  const visible = scopedAccount ? [scopedAccount] : accounts;

  if (visible.length === 0) {
    return (
      <div className="py-8 text-center text-muted-foreground text-sm">
        No toll integrations connected.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {visible.map((a) => (
        <AccountSyncHistory key={a.id} accountId={a.id} accountName={a.name} />
      ))}
    </div>
  );
}

function AccountSyncHistory({ accountId, accountName }: { accountId: string; accountName: string }) {
  const { data: syncs, isLoading } = trpc.linkt.listSyncs.useQuery({ accountId, limit: 25 });

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="font-semibold">{accountName}</div>
        {isLoading ? (
          <div className="flex py-1"><Spinner size="sm" /></div>
        ) : !syncs || syncs.length === 0 ? (
          <div className="text-xs text-muted-foreground">No syncs yet.</div>
        ) : (
          <div className="rounded-md border overflow-hidden bg-card">
            <table className="w-full text-xs">
              <thead className="bg-primary text-primary-foreground">
                <tr className="border-b border-primary/40 text-left">
                  <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">Started</th>
                  <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">Status</th>
                  <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">Period</th>
                  <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80 text-right">Fetched</th>
                  <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80 text-right">New</th>
                  <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80 text-right">Dup</th>
                  <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80 text-right">Unmatched</th>
                  <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">Error</th>
                </tr>
              </thead>
              <tbody className="bg-card">
                {syncs.map((s) => (
                  <tr key={s.id} className="border-b last:border-0">
                    <td className="px-3 py-2">{formatDateTime(s.startedAt)}</td>
                    <td className="px-3 py-2">
                      <StatusBadge status={s.status as StatusKey} />
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {formatDate(s.periodFrom)} → {formatDate(s.periodTo)}
                    </td>
                    <td className="px-3 py-2 text-right">{s.rowsFetched}</td>
                    <td className="px-3 py-2 text-right">{s.rowsCreated}</td>
                    <td className="px-3 py-2 text-right">{s.rowsDuplicate}</td>
                    <td className="px-3 py-2 text-right">{s.rowsUnmatched}</td>
                    <td className="px-3 py-2 text-red-600">{s.error ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

type UnmatchedRow = {
  id: string;
  accountId: string;
  externalHash: string;
  eventAt: Date;
  plate: string;
  tollpoint: string;
  rawDetails: string | null;
  amountCents: number;
  resolvedAt: Date | null;
  resolvedAction: string | null;
  account: { id: string; name: string };
};

function UnmatchedTab({ accountId }: { accountId?: string }) {
  const [search, setSearch] = useState("");
  const [includeResolved, setIncludeResolved] = useState(false);
  const [resolving, setResolving] = useState<UnmatchedRow | null>(null);
  const debouncedSearch = useDebouncedValue(search, 300);

  const util = trpc.useUtils();
  const { data, fetchNextPage, hasNextPage, isFetching, isLoading } =
    trpc.linkt.listUnmatched.useInfiniteQuery(
      {
        accountId,
        includeResolved,
        search: debouncedSearch || undefined,
        limit: 50,
      },
      { getNextPageParam: (last) => last.nextCursor ?? undefined },
    );

  const dismiss = trpc.linkt.dismissUnmatched.useMutation({
    onSuccess: () => {
      util.linkt.listUnmatched.invalidate();
      util.linkt.unmatchedCount.invalidate();
    },
  });

  const items = (data?.pages.flatMap((p) => p.items) ?? []) as UnmatchedRow[];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <Input
          placeholder="Search plate, location…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-72"
        />

        <Button
          size="sm"
          variant={includeResolved ? "secondary" : "outline"}
          onClick={() => setIncludeResolved((v) => !v)}
        >
          {includeResolved ? "Hide resolved" : "Show resolved"}
        </Button>

        <div className="ml-auto text-xs text-muted-foreground">
          {isLoading ? "Loading…" : `${items.length}${hasNextPage ? "+" : ""} result${items.length === 1 ? "" : "s"}`}
        </div>
      </div>

      {isLoading ? (
        <LoadingBlock padded="md" />
      ) : items.length === 0 ? (
        <div className="py-8 text-center text-muted-foreground text-sm">
          {includeResolved ? "No unmatched rows." : "No unresolved tolls — everything is linked."}
        </div>
      ) : (
        <div className="rounded-md border overflow-hidden bg-card">
          <div className="max-h-[32rem] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-primary text-primary-foreground">
                <tr className="border-b border-primary/40 text-left">
                  <th className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">Date / Time</th>
                  <th className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">Plate</th>
                  <th className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">Location</th>
                  <th className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">Account</th>
                  <th className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">Status</th>
                  <th className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80 text-right">Toll</th>
                  <th className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-card">
                {items.map((row) => {
                  const resolved = !!row.resolvedAt;
                  return (
                    <tr key={row.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        {formatDateTime(row.eventAt)}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs">{row.plate}</td>
                      <td className="px-4 py-2.5">
                        <div>{row.tollpoint || "—"}</div>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">{row.account.name}</td>
                      <td className="px-4 py-2.5">
                        {resolved ? (
                          row.resolvedAction === "DISMISSED" ? (
                            <Badge variant="outline">
                              {row.resolvedAction.replace(/_/g, " ").toLowerCase()}
                            </Badge>
                          ) : (
                            <StatusBadge
                              status="RESOLVED"
                              label={row.resolvedAction?.replace(/_/g, " ").toLowerCase() ?? "resolved"}
                            />
                          )
                        ) : (
                          <StatusBadge status="UNMATCHED" label="unmatched" />
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right font-medium">
                        {formatCurrency((row.amountCents / 100).toFixed(2))}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {resolved ? (
                          <span className="text-xs text-muted-foreground">
                            {row.resolvedAt ? formatDate(row.resolvedAt) : ""}
                          </span>
                        ) : (
                          <div className="flex justify-end gap-1.5">
                            <Button size="sm" onClick={() => setResolving(row)}>
                              Resolve
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={dismiss.isPending}
                              onClick={() => {
                                if (confirm("Dismiss this toll — it's not ours / not chargeable?")) {
                                  dismiss.mutate({ id: row.id });
                                }
                              }}
                            >
                              Dismiss
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {hasNextPage && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchNextPage()}
            disabled={isFetching}
          >
            {isFetching ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}

      <ResolveUnmatchedSheet
        row={resolving}
        onClose={(resolved) => {
          setResolving(null);
          if (resolved) {
            util.linkt.listUnmatched.invalidate();
            util.linkt.unmatchedCount.invalidate();
            util.linkt.listTransactions.invalidate();
          }
        }}
      />
    </div>
  );
}

function ResolveUnmatchedSheet({
  row,
  onClose,
}: {
  row: UnmatchedRow | null;
  onClose: (resolved: boolean) => void;
}) {
  // Remounting on row change (via `key={row.id}` where this is rendered) is
  // what keeps form state fresh between different rows.
  return (
    <Sheet open={!!row} onOpenChange={(open) => (open ? null : onClose(false))}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Resolve unmatched toll</SheetTitle>
        </SheetHeader>
        {row && <ResolveUnmatchedSheetBody row={row} onClose={onClose} />}
      </SheetContent>
    </Sheet>
  );
}

function ResolveUnmatchedSheetBody({
  row,
  onClose,
}: {
  row: UnmatchedRow;
  onClose: (resolved: boolean) => void;
}) {
  const [vehicleId, setVehicleId] = useState<string>("");
  const [linkMode, setLinkMode] = useState<"booking" | "customer" | "none">("booking");
  const [bookingId, setBookingId] = useState<string>("");
  const [customerId, setCustomerId] = useState<string>("");
  const [customerSearch, setCustomerSearch] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const { data: vehicles } = trpc.vehicle.list.useQuery({ take: 200 });

  const { data: suggestion } = trpc.linkt.suggestBookingsForUnmatched.useQuery(
    { id: row.id, vehicleId },
    { enabled: !!vehicleId && linkMode === "booking" },
  );

  const debouncedCustomerSearch = useDebouncedValue(customerSearch, 300);
  const { data: customerResults } = trpc.staffCustomer.list.useQuery(
    {
      search: debouncedCustomerSearch || undefined,
      status: "ALL",
      page: 1,
      pageSize: 10,
      sortBy: "name",
      sortDir: "asc",
    },
    { enabled: linkMode === "customer" && debouncedCustomerSearch.length >= 2 },
  );

  const resolve = trpc.linkt.resolveUnmatched.useMutation();

  const selectedVehicle = useMemo(
    () => vehicles?.items.find((v) => v.id === vehicleId) ?? null,
    [vehicles, vehicleId],
  );

  async function onSubmit() {
    if (!row) return;
    setError(null);
    if (!vehicleId) {
      setError("Please pick a vehicle.");
      return;
    }
    if (linkMode === "booking" && !bookingId) {
      setError("Please pick a booking, or switch to 'Link to customer' / 'No customer'.");
      return;
    }
    if (linkMode === "customer" && !customerId) {
      setError("Please pick a customer.");
      return;
    }
    try {
      await resolve.mutateAsync({
        id: row.id,
        vehicleId,
        bookingId: linkMode === "booking" ? bookingId : undefined,
        customerId: linkMode === "customer" ? customerId : undefined,
        notes: notes || undefined,
      });
      onClose(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="mt-6 space-y-5">
      <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1">
        <div className="flex justify-between">
          <span className="text-muted-foreground">When</span>
          <span>{formatDateTime(row.eventAt)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Plate</span>
          <span className="font-mono text-xs">{row.plate}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Location</span>
          <span className="text-right">{row.tollpoint || "—"}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Amount</span>
          <span className="font-medium">{formatCurrency((row.amountCents / 100).toFixed(2))}</span>
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Vehicle</label>
        <Select value={vehicleId} onValueChange={setVehicleId}>
          <SelectTrigger>
            <SelectValue placeholder="Pick the vehicle this toll belongs to" />
          </SelectTrigger>
          <SelectContent>
            {vehicles?.items.map((v) => (
              <SelectItem key={v.id} value={v.id}>
                {v.internalCode} · {v.rego}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedVehicle && selectedVehicle.rego.toUpperCase() !== row.plate.toUpperCase() && (
          <p className="text-xs text-muted-foreground">
            Heads up: selected rego <span className="font-mono">{selectedVehicle.rego}</span>{" "}
            doesn&apos;t match the toll&apos;s <span className="font-mono">{row.plate}</span>
            {" "}— the toll account may be using the tag number rather than a rego.
          </p>
        )}
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Link to</label>
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              { v: "booking", label: "A booking" },
              { v: "customer", label: "A customer (no booking)" },
              { v: "none", label: "No customer" },
            ] as const
          ).map((opt) => (
            <button
              key={opt.v}
              type="button"
              onClick={() => setLinkMode(opt.v)}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                linkMode === opt.v
                  ? "bg-foreground text-background border-foreground"
                  : "bg-background hover:bg-muted",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {linkMode === "booking" && (
        <div className="space-y-2">
          <label className="text-sm font-medium">Booking</label>
          {!vehicleId ? (
            <p className="text-xs text-muted-foreground">Pick a vehicle to see suggestions.</p>
          ) : !suggestion ? (
            <p className="text-xs text-muted-foreground">Loading suggestions…</p>
          ) : suggestion.bookings.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No bookings found for this vehicle around{" "}
              {formatDate(row.eventAt)}. Switch to &quot;A customer&quot; or &quot;No customer&quot;.
            </p>
          ) : (
            <div className="space-y-1.5">
              {suggestion.window === "fuzzy" && (
                <p className="text-xs text-amber-600">
                  No exact-window match. These bookings are within ±3 days.
                </p>
              )}
              {suggestion.bookings.map((b) => {
                const active = bookingId === b.id;
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setBookingId(b.id)}
                    className={cn(
                      "w-full text-left rounded-md border p-2.5 text-sm transition-colors",
                      active
                        ? "border-primary bg-primary/5"
                        : "hover:bg-muted/50",
                    )}
                  >
                    <div className="font-medium">{b.bookingReference}</div>
                    <div className="text-xs text-muted-foreground">
                      {b.customer.firstName} {b.customer.lastName} · {b.customer.email}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatDate(b.pickupDateTime)} → {formatDate(b.returnDateTime)}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {linkMode === "customer" && (
        <div className="space-y-2">
          <label className="text-sm font-medium">Customer</label>
          <Input
            placeholder="Search by name or email"
            value={customerSearch}
            onChange={(e) => setCustomerSearch(e.target.value)}
          />
          {debouncedCustomerSearch.length < 2 ? (
            <p className="text-xs text-muted-foreground">Type at least 2 characters.</p>
          ) : !customerResults ? (
            <p className="text-xs text-muted-foreground">Searching…</p>
          ) : customerResults.items.length === 0 ? (
            <p className="text-xs text-muted-foreground">No matching customers.</p>
          ) : (
            <div className="space-y-1.5 max-h-60 overflow-y-auto">
              {customerResults.items.map((c) => {
                const active = customerId === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setCustomerId(c.id)}
                    className={cn(
                      "w-full text-left rounded-md border p-2 text-sm transition-colors",
                      active
                        ? "border-primary bg-primary/5"
                        : "hover:bg-muted/50",
                    )}
                  >
                    <div className="font-medium">
                      {c.firstName} {c.lastName}
                    </div>
                    <div className="text-xs text-muted-foreground">{c.email}</div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {linkMode === "none" && (
        <p className="text-xs text-muted-foreground rounded-md border bg-muted/30 p-2.5">
          The toll will be recorded against the vehicle only (status: RECEIVED). You can
          nominate a customer later from the Transactions tab.
        </p>
      )}

      <div className="space-y-2">
        <label className="text-sm font-medium">Notes (optional)</label>
        <Input
          placeholder="e.g. tag swap on 2026-04-10"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2.5 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="flex gap-2 justify-end pt-2">
        <Button variant="secondary" onClick={() => onClose(false)} disabled={resolve.isPending}>
          Cancel
        </Button>
        <Button onClick={onSubmit} disabled={resolve.isPending}>
          {resolve.isPending ? "Resolving…" : "Resolve toll"}
        </Button>
      </div>
    </div>
  );
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}
