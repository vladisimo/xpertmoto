"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { format } from "date-fns";
import type { DateRange } from "react-day-picker";
import { CalendarDays, MapPin, Pencil, ChevronRight, X } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { Button, buttonVariants } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getHoursRowForDate } from "@/lib/booking-time-slots";
import { formatCurrency, cn } from "@/lib/utils";

type Phase = "dates" | "depot" | "results";

function toLocalDatetimeInputValue(d: Date) {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Materialise the selected range into ISO datetime strings. Pickup defaults to
// 10:00 local on the start date; return to 10:00 local on the end date. If the
// user picked a single day, bump return +1 day so the wizard's 4-hour minimum
// validation still passes.
function rangeToISO(range: DateRange | undefined) {
  if (!range?.from) return { pickup: "", ret: "" };
  const from = new Date(range.from);
  from.setHours(10, 0, 0, 0);
  const toSource = range.to ?? range.from;
  const to = new Date(toSource);
  to.setHours(10, 0, 0, 0);
  if (to.getTime() <= from.getTime()) {
    to.setDate(to.getDate() + 1);
  }
  return { pickup: toLocalDatetimeInputValue(from), ret: toLocalDatetimeInputValue(to) };
}

const INITIAL_RESULTS = 10;
const FETCH_LIMIT = 500;

// Simple Icons slugs for motorcycle brands. Keys are lower-cased make names
// as stored in the DB. A slug of null means no logo available — chip renders
// text-only. Source: https://simpleicons.org
const MAKE_ICON_SLUG: Record<string, string | null> = {
  bmw: "bmw",
  cfmoto: null,
  ducati: "ducati",
  honda: "honda",
  "harley davidson": "harleydavidson",
  "harley-davidson": "harleydavidson",
  kawasaki: "kawasaki",
  ktm: "ktm",
  "royal enfield": "royalenfield",
  suzuki: "suzuki",
  triumph: "triumphmotorcycles",
  yamaha: "yamahamotorcorporation",
};

function makeIconSrc(make: string): string | null {
  const slug = MAKE_ICON_SLUG[make.toLowerCase()];
  return slug ? `https://cdn.simpleicons.org/${slug}` : null;
}

function dateToYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Walks `start` forward by whole days until `isClosedDay` returns false,
// capped at one year so a 100%-closed depot config can't loop forever.
function advanceToOpenDay(start: Date, isClosedDay: (d: Date) => boolean): Date {
  const out = new Date(start);
  for (let i = 0; i < 365; i++) {
    if (!isClosedDay(out)) return out;
    out.setDate(out.getDate() + 1);
  }
  return out;
}

// Case-insensitive dedupe. Preserves the first-seen casing for each make so
// display stays stable if seed data is ever corrected.
function dedupeMakes(vehicles: Array<{ make: string }>): string[] {
  const firstSeen = new Map<string, string>();
  for (const v of vehicles) {
    const key = v.make.toLowerCase();
    if (!firstSeen.has(key)) firstSeen.set(key, v.make);
  }
  return Array.from(firstSeen.values()).sort((a, b) => a.localeCompare(b));
}

export interface HeroAvailabilityWidgetProps {
  onDismiss?: () => void;
}

export function HeroAvailabilityWidget({ onDismiss }: HeroAvailabilityWidgetProps = {}) {
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const [phase, setPhase] = useState<Phase>("dates");
  const [range, setRange] = useState<DateRange | undefined>(() => {
    const from = new Date(today);
    from.setDate(from.getDate() + 1);
    const to = new Date(from);
    to.setDate(to.getDate() + 3);
    return { from, to };
  });
  const [depotId, setDepotId] = useState<string>("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [makeFilter, setMakeFilter] = useState<string>("");
  const [modelFilter, setModelFilter] = useState<string>("");
  const [showAll, setShowAll] = useState(false);

  const { pickup, ret } = rangeToISO(range);
  const datesConfirmed = phase !== "dates" && !!pickup && !!ret;

  const { data: depots } = trpc.depot.list.useQuery();
  const { data: categories } = trpc.vehicle.listCategories.useQuery();
  const { data: popular } = trpc.booking.popularPicks.useQuery({ days: 90 });

  // Auto-skip depot selection when the org only has one active depot.
  useEffect(() => {
    if (phase !== "depot" || !depots) return;
    if (depots.length <= 1) {
      setDepotId(depots[0]?.id ?? "");
      setPhase("results");
    }
  }, [phase, depots]);

  // Calendar day-state predicates, mirroring the booking wizard
  // (`BookingDateRangePicker`). The widget runs *before* a depot is
  // chosen, so a day only counts as closed when every active depot is
  // shut on it — if at least one depot is open, the user might still
  // pick that depot in the next phase. While depots are still loading
  // (no rows yet) we treat all future days as open so the calendar
  // doesn't lock until the query resolves.
  const isClosedDay = useMemo(() => {
    return (date: Date): boolean => {
      if (!depots || depots.length === 0) return false;
      const ymd = dateToYmd(date);
      return depots.every((d) => {
        const row = getHoursRowForDate(ymd, d.operatingHours);
        return row?.isClosed === true;
      });
    };
  }, [depots]);
  const isPastDay = (date: Date): boolean => date.getTime() < today.getTime();
  const isOpenDay = (date: Date): boolean =>
    !isPastDay(date) && !isClosedDay(date);

  // The initial range (today+1 → today+4) is computed before the
  // depots query resolves, so the pre-selected start/end can land on a
  // closed day. Once depots load, walk both endpoints forward to the
  // next open day so the user doesn't see a range pinned to disabled
  // cells. Bounded loop in case of misconfigured 100%-closed depots.
  useEffect(() => {
    if (!depots || depots.length === 0) return;
    setRange((prev) => {
      if (!prev?.from && !prev?.to) return prev;
      const adjusted = {
        from: prev.from ? advanceToOpenDay(prev.from, isClosedDay) : undefined,
        to: prev.to ? advanceToOpenDay(prev.to, isClosedDay) : undefined,
      };
      if (
        adjusted.from && adjusted.to &&
        adjusted.to.getTime() < adjusted.from.getTime()
      ) {
        const next = new Date(adjusted.from);
        next.setDate(next.getDate() + 1);
        adjusted.to = advanceToOpenDay(next, isClosedDay);
      }
      if (
        adjusted.from?.getTime() === prev.from?.getTime() &&
        adjusted.to?.getTime() === prev.to?.getTime()
      ) {
        return prev;
      }
      return adjusted;
    });
  }, [depots, isClosedDay]);

  // Fetch all available bikes for dates+depot (no size filter) so the Size
  // dropdown can show only categories that actually have ≥1 bike available.
  // Size + Make + Model filters are then applied client-side below.
  const query = trpc.booking.listAvailableVehicles.useQuery(
    {
      pickupDateTime: new Date(pickup),
      returnDateTime: new Date(ret),
      depotId: depotId || undefined,
      limit: FETCH_LIMIT,
    },
    { enabled: !!pickup && !!ret },
  );

  const vehicles = query.data ?? [];

  // Derive dropdown options from the full available-bike list.
  const availableCategoryIds = useMemo(
    () => new Set(vehicles.map((v) => v.categoryId)),
    [vehicles],
  );
  const filteredBySize = useMemo(
    () => (categoryId ? vehicles.filter((v) => v.categoryId === categoryId) : vehicles),
    [vehicles, categoryId],
  );
  const makes = useMemo(() => dedupeMakes(filteredBySize), [filteredBySize]);

  const filteredByMake = useMemo(
    () =>
      makeFilter
        ? filteredBySize.filter((v) => v.make.toLowerCase() === makeFilter.toLowerCase())
        : filteredBySize,
    [filteredBySize, makeFilter],
  );

  const models = useMemo(() => {
    if (!makeFilter) return [];
    const set = new Set<string>();
    for (const v of filteredByMake) set.add(v.model);
    return Array.from(set).sort();
  }, [filteredByMake, makeFilter]);

  const filtered = useMemo(
    () => (modelFilter ? filteredByMake.filter((v) => v.model === modelFilter) : filteredByMake),
    [filteredByMake, modelFilter],
  );

  const visible = showAll ? filtered : filtered.slice(0, INITIAL_RESULTS);

  // Insights shown while the user is still picking dates.
  const rentalDays = useMemo(() => {
    if (!range?.from || !range?.to) return 0;
    const ms = range.to.getTime() - range.from.getTime();
    return Math.max(1, Math.round(ms / 86_400_000));
  }, [range]);

  const minDailyRate = useMemo(() => {
    if (vehicles.length === 0) return 0;
    return Math.min(...vehicles.map((v) => Number(v.category.baseDailyRate)));
  }, [vehicles]);

  const depotsWithStock = useMemo(
    () => new Set(vehicles.map((v) => v.depotId)).size,
    [vehicles],
  );

  const categoriesWithStock = useMemo(
    () => new Set(vehicles.map((v) => v.categoryId)).size,
    [vehicles],
  );

  const anyFilterActive = !!categoryId || !!makeFilter || !!modelFilter;
  const clearFilters = () => {
    setCategoryId("");
    setMakeFilter("");
    setModelFilter("");
    setShowAll(false);
  };

  const bookingHref = (v: (typeof vehicles)[number]) => {
    const params = new URLSearchParams({
      vehicleId: v.id,
      depotId: v.depotId,
      categoryId: v.categoryId,
      pickup,
      return: ret,
    });
    return `/booking?${params.toString()}`;
  };

  const depotName = depotId ? depots?.find((d) => d.id === depotId)?.name : "Any depot";

  return (
    <div className="flex max-h-[min(calc(100vh-6rem),640px)] flex-col overflow-hidden rounded-md border border-border bg-card text-foreground shadow-lg">
      <div className="flex-shrink-0 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="caption uppercase tracking-[0.12em] text-muted-foreground">
              Quick availability
            </div>
            <h3 className="h3 mt-1">Find your ride</h3>
          </div>
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Close"
              className="-mr-1 -mt-1 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Summary chips for completed phases */}
        {datesConfirmed && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <SummaryChip
              icon={<CalendarDays className="h-3.5 w-3.5" />}
              label={
                range?.from && range?.to
                  ? `${format(range.from, "MMM d")} – ${format(range.to, "MMM d")}`
                  : range?.from
                    ? format(range.from, "MMM d")
                    : ""
              }
              onClick={() => setPhase("dates")}
            />
            {phase === "results" && (
              <span className="caption">
                {query.isFetching
                  ? "Checking…"
                  : filtered.length === 0
                    ? "No scooters match"
                    : `${filtered.length} scooter${filtered.length === 1 ? "" : "s"} available`}
              </span>
            )}
            {phase === "results" && (depots?.length ?? 0) > 1 && (
              <SummaryChip
                icon={<MapPin className="h-3.5 w-3.5" />}
                label={depotName ?? "Any depot"}
                onClick={() => setPhase("depot")}
              />
            )}
          </div>
        )}

        {phase === "dates" && (
          <div className="mt-4 space-y-3">
            {/*
             * Legend matches the booking wizard's `BookingDateRangePicker`
             * (src/components/booking/date-range-picker.tsx). Tones are
             * locked to fixed Tailwind palette values rather than
             * `text-primary` / `text-secondary` because brand overrides
             * (e.g. XPERT Moto's primary = black) would otherwise turn
             * "available" into solid black and "closed" into a low-
             * contrast yellow. Same waiver as the wizard.
             */}
            <div className="flex flex-row flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[10px]">
              <span className="inline-flex shrink-0 items-center gap-1.5">
                <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-destructive" />
                <span className="whitespace-nowrap text-muted-foreground">Not available</span>
              </span>
              <span className="inline-flex shrink-0 items-center gap-1.5">
                <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-orange-500" />
                <span className="whitespace-nowrap text-muted-foreground">Closed (mid-hire only)</span>
              </span>
              <span className="inline-flex shrink-0 items-center gap-1.5">
                <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-emerald-600" />
                <span className="whitespace-nowrap text-muted-foreground">Available</span>
              </span>
            </div>
            <div className="-mx-2 flex justify-center overflow-x-auto">
              <Calendar
                mode="range"
                numberOfMonths={2}
                selected={range}
                onSelect={setRange}
                // Past dates and depot-closed days (incl. holiday rows)
                // are non-selectable as start/end. Closed mid-range is
                // still allowed — the wizard's stricter pickup/return
                // depot check then validates the endpoints. Mirrors
                // `BookingDateRangePicker` in src/components/booking/.
                disabled={[{ before: today }, isClosedDay]}
                showOutsideDays={false}
                className="p-1"
                modifiers={{
                  pastDay: isPastDay,
                  closed: isClosedDay,
                  openDay: isOpenDay,
                }}
                modifiersClassNames={{
                  pastDay:
                    "[&:not(.rdp-selected)>button]:!text-destructive [&:not(.rdp-selected)>button]:line-through [&:not(.rdp-selected)>button]:opacity-100",
                  closed:
                    "[&:not(.rdp-selected)>button]:!text-orange-500 [&:not(.rdp-selected)>button]:opacity-100",
                  openDay: "[&:not(.rdp-selected)>button]:!text-emerald-600",
                }}
                classNames={{
                  months: "flex flex-row gap-1",
                  weekday:
                    "text-muted-foreground rounded-md w-7 font-normal text-[0.7rem]",
                  day_button: cn(
                    buttonVariants({ variant: "ghost" }),
                    "h-7 w-7 p-0 text-xs font-normal",
                  ),
                }}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <p className="caption">
                {range?.from && range?.to
                  ? `${format(range.from, "EEE d MMM")} – ${format(range.to, "EEE d MMM")}`
                  : range?.from
                    ? `Start: ${format(range.from, "EEE d MMM")} — pick a return date`
                    : "Pick your pickup and return dates."}
              </p>
              <Button
                size="sm"
                disabled={!range?.from}
                onClick={() => {
                  if ((depots?.length ?? 0) > 1) setPhase("depot");
                  else {
                    const only = depots?.[0];
                    if (only) setDepotId(only.id);
                    setPhase("results");
                  }
                }}
              >
                Continue <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            {range?.from && range?.to && (
              <div className="rounded-md border border-emerald-600/25 bg-emerald-500/10 p-3">
                <div className="grid grid-cols-4 gap-2 text-center">
                  <InsightStat
                    value={query.isFetching ? "—" : vehicles.length}
                    label="Available"
                  />
                  <InsightStat
                    value={query.isFetching || vehicles.length === 0 ? "—" : formatCurrency(minDailyRate)}
                    label="From/day"
                  />
                  <InsightStat
                    value={rentalDays}
                    label={rentalDays === 1 ? "Day" : "Days"}
                  />
                  <InsightStat
                    value={query.isFetching ? "—" : depotsWithStock}
                    label={depotsWithStock === 1 ? "Depot" : "Depots"}
                  />
                </div>
                <p className="mt-2 text-center text-xs text-muted-foreground">
                  {query.isFetching ? (
                    "Searching…"
                  ) : vehicles.length === 0 ? (
                    <span className="font-medium text-foreground">
                      No vehicles available for these dates
                    </span>
                  ) : (
                    <>
                      Across {categoriesWithStock}{" "}
                      {categoriesWithStock === 1 ? "category" : "categories"} · est.
                      from{" "}
                      <span className="font-medium text-foreground">
                        {formatCurrency(minDailyRate * rentalDays)}
                      </span>{" "}
                      total
                    </>
                  )}
                </p>
                <p className="mt-2 border-t border-border/40 pt-2 text-center text-xs text-muted-foreground">
                  {!query.isFetching && vehicles.length > 0 && popular && popular.length > 0 ? (
                    <>
                      <span className="uppercase tracking-wide">Most hired</span>{" "}
                      ·{" "}
                      <span className="text-foreground">
                        {popular
                          .slice(0, 3)
                          .map((p) => `${p.make} ${p.model}`)
                          .join(", ")}
                      </span>
                    </>
                  ) : (
                    <span aria-hidden>&nbsp;</span>
                  )}
                </p>
              </div>
            )}
          </div>
        )}

        {phase === "depot" && (
          <div className="mt-4 space-y-2">
            <div className="caption uppercase tracking-[0.12em] text-muted-foreground">
              Pickup depot
            </div>
            <div className="grid gap-2">
              <DepotOption
                selected={!depotId}
                onClick={() => {
                  setDepotId("");
                  setPhase("results");
                }}
              >
                Any depot
              </DepotOption>
              {depots?.map((d) => (
                <DepotOption
                  key={d.id}
                  selected={depotId === d.id}
                  onClick={() => {
                    setDepotId(d.id);
                    setPhase("results");
                  }}
                >
                  {d.name}
                </DepotOption>
              ))}
            </div>
          </div>
        )}

        {phase === "results" && (
          <div className="mt-4 space-y-3">
            {/* Size + Make dropdowns side-by-side */}
            <div className="grid grid-cols-2 gap-2">
              {(() => {
                const visibleCategories =
                  categories?.filter((c) => availableCategoryIds.has(c.id)) ?? [];
                if (visibleCategories.length === 0) return null;
                return (
                  <div className="space-y-1.5">
                    <Label className="caption">Size</Label>
                    <Select
                      value={categoryId || "any"}
                      onValueChange={(v) => setCategoryId(v === "any" ? "" : v)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Any size" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="any">Any size</SelectItem>
                        {visibleCategories.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                );
              })()}

              {makes.length > 1 && (
                <div className="space-y-1.5">
                  <Label className="caption">Make</Label>
                  <Select
                    value={makeFilter || "any"}
                    onValueChange={(v) => {
                      setMakeFilter(v === "any" ? "" : v);
                      setModelFilter("");
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="All makes" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="any">All makes</SelectItem>
                      {makes.map((m) => {
                        const iconSrc = makeIconSrc(m);
                        return (
                          <SelectItem key={m} value={m}>
                            <span className="inline-flex items-center gap-2">
                              {iconSrc ? (
                                <MakeIcon src={iconSrc} alt="" />
                              ) : (
                                <span aria-hidden className="h-3.5 w-3.5 shrink-0" />
                              )}
                              {m}
                            </span>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            {/* Model filter (client-side, only after a make chosen) */}
            {makeFilter && models.length > 1 && (
              <div className="space-y-1.5">
                <Label className="caption">Model</Label>
                <Select
                  value={modelFilter || "any"}
                  onValueChange={(v) => setModelFilter(v === "any" ? "" : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All models" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">All models</SelectItem>
                    {models.map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {anyFilterActive && (
              <div>
                <button
                  type="button"
                  onClick={clearFilters}
                  className="caption underline underline-offset-2 hover:text-foreground"
                >
                  Clear filters
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {phase === "results" && !query.isFetching && filtered.length > 0 && (
        <div className="min-h-0 flex-1 overflow-y-auto border-t border-border p-4 [mask-image:linear-gradient(to_bottom,transparent_0,black_1.5rem,black_calc(100%-2.5rem),transparent_100%)]">
          <div className="grid grid-cols-1 gap-2.5">
            {visible.map((v) => (
              <Link
                key={v.id}
                href={bookingHref(v)}
                className="flex items-center gap-3 rounded-md border border-border bg-card p-3 transition-colors hover:border-foreground hover:bg-muted"
              >
                <div className="relative h-16 w-20 flex-shrink-0 overflow-hidden rounded-sm bg-muted">
                  {v.images[0]?.url ? (
                    <Image
                      src={v.images[0].url}
                      alt={`${v.make} ${v.model}`}
                      fill
                      sizes="80px"
                      className="object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-muted-foreground">—</div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">
                    {v.make} {v.model}{" "}
                    <span className="font-normal text-muted-foreground">{v.year}</span>
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {v.category.name} · {v.depot.name} · {v.colour}
                  </div>
                </div>
                <div className="flex-shrink-0 text-right">
                  <div className="caption">from</div>
                  <div className="font-semibold">
                    {formatCurrency(Number(v.category.baseDailyRate))}
                    <span className="text-xs font-normal text-muted-foreground">/day</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
          {!showAll && filtered.length > INITIAL_RESULTS && (
            <div className="mt-3 flex justify-center">
              <Button variant="secondary" size="sm" onClick={() => setShowAll(true)}>
                Show {filtered.length - INITIAL_RESULTS} more
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SummaryChip({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/60 px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
    >
      {icon}
      <span>{label}</span>
      <Pencil className="h-3 w-3 text-muted-foreground" />
    </button>
  );
}

function DepotOption({
  children,
  selected,
  onClick,
}: {
  children: React.ReactNode;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center justify-between rounded-md border px-3 py-2 text-sm transition-colors",
        selected
          ? "border-primary bg-primary/5 text-foreground"
          : "border-border hover:border-foreground hover:bg-muted",
      )}
    >
      <span className="flex items-center gap-2">
        <MapPin className="h-4 w-4 text-muted-foreground" />
        {children}
      </span>
      <span
        className={cn(
          "h-4 w-4 rounded-full border",
          selected ? "border-primary bg-primary" : "border-border",
        )}
      />
    </button>
  );
}

function InsightStat({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="flex flex-col items-center">
      <div className="text-base font-semibold text-foreground leading-none">{value}</div>
      <div className="mt-1 text-[0.65rem] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

// Brand logo rendered via Simple Icons CDN. Plain <img> so no next.config
// remotePatterns change is needed; hides itself if the slug 404s.
function MakeIcon({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      width={14}
      height={14}
      className="h-3.5 w-3.5 object-contain"
      onError={() => setFailed(true)}
    />
  );
}
