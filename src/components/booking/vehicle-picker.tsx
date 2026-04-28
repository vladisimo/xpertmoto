"use client";

import * as React from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import { useBookingWizard } from "@/stores/booking-wizard";
import { Spinner } from "@/components/ui/spinner";
import {
  VehicleFilterBar,
  DEFAULT_FILTERS,
  type VehicleFilters,
} from "./vehicle-filter-bar";
import { VehicleCard, NoPreferenceCard, type VehicleCardVehicle } from "./vehicle-card";
import { PreviouslyRentedRow } from "./previously-rented-row";
import { useWizardShellLayout } from "@/components/booking/wizard-shell-layout-context";

export function VehiclePicker() {
  const w = useBookingWizard();
  const { data: session } = useSession();
  const layout = useWizardShellLayout();

  const [filters, setFilters] = React.useState<VehicleFilters>(DEFAULT_FILTERS);

  const queryEnabled = !!(
    w.categoryId &&
    w.pickupDepotId &&
    w.pickupDateTime &&
    w.returnDateTime
  );

  const { data: vehicles, isLoading, isError } = trpc.booking.listAvailableVehicles.useQuery(
    {
      categoryId: w.categoryId ?? undefined,
      depotId: w.pickupDepotId ?? undefined,
      pickupDateTime: new Date(w.pickupDateTime ?? new Date()),
      returnDateTime: new Date(w.returnDateTime ?? new Date()),
      limit: 500,
    },
    { enabled: queryEnabled },
  );

  const list = React.useMemo<VehicleCardVehicle[]>(() => {
    if (!vehicles) return [];
    return vehicles.map((v) => ({
      id: v.id,
      make: v.make,
      model: v.model,
      year: v.year,
      colour: v.colour,
      condition: v.condition as VehicleCardVehicle["condition"],
      currentOdometerKm: v.currentOdometerKm,
      internalCode: v.internalCode,
      category: { name: v.category.name, engineCapacity: v.category.engineCapacity },
      depot: { name: v.depot.name },
      images: v.images,
    }));
  }, [vehicles]);

  // Derived: is the user's earlier pick absent from the current result set?
  const preferredIsStale =
    !!vehicles &&
    !!w.preferredVehicleId &&
    list.length > 0 &&
    !list.some((v) => v.id === w.preferredVehicleId);

  // When the picker detects the preferred id is not in the available set
  // (e.g. user changed depot), clear it from the store and surface a
  // one-off notice. Use the "adjust state on prop change" pattern — compare
  // to a locally-tracked snapshot inside render to fire once per unique id.
  const [lastClearedId, setLastClearedId] = React.useState<string | null>(null);
  const [justCleared, setJustCleared] = React.useState<string | null>(null);
  if (preferredIsStale && lastClearedId !== w.preferredVehicleId) {
    const staleId = w.preferredVehicleId;
    setLastClearedId(staleId);
    setJustCleared(staleId);
    w.set("preferredVehicleId", null);
  }

  const makeOptions = React.useMemo(
    () => Array.from(new Set(list.map((v) => v.make))).sort(),
    [list],
  );
  const modelOptions = React.useMemo(() => {
    const pool =
      filters.make === "all" ? list : list.filter((v) => v.make === filters.make);
    return Array.from(new Set(pool.map((v) => v.model))).sort();
  }, [list, filters.make]);
  const colourOptions = React.useMemo(
    () => Array.from(new Set(list.map((v) => v.colour))).sort(),
    [list],
  );

  const filtered = React.useMemo(() => {
    const base = list.filter((v) => {
      if (filters.make !== "all" && v.make !== filters.make) return false;
      if (filters.model !== "all" && v.model !== filters.model) return false;
      if (filters.colour !== "all" && v.colour !== filters.colour) return false;
      return true;
    });
    const sorted = [...base];
    switch (filters.sort) {
      case "year-desc":
        sorted.sort((a, b) => b.year - a.year || a.currentOdometerKm - b.currentOdometerKm);
        break;
      case "make-asc":
        sorted.sort((a, b) => `${a.make} ${a.model}`.localeCompare(`${b.make} ${b.model}`));
        break;
      default:
        sorted.sort((a, b) => a.currentOdometerKm - b.currentOdometerKm);
    }
    return sorted;
  }, [list, filters]);

  const selectedVehicle = w.preferredVehicleId
    ? list.find((v) => v.id === w.preferredVehicleId) ?? null
    : null;

  const filterExcludesSelection =
    selectedVehicle !== null && !filtered.some((v) => v.id === selectedVehicle.id);

  const toggle = (id: string) => {
    w.set("preferredVehicleId", w.preferredVehicleId === id ? null : id);
    // Picking a specific vehicle clears any active "No preference" flag —
    // they're mutually exclusive states.
    if (w.noPreference) w.set("noPreference", false);
    setJustCleared(null);
  };
  const toggleNoPreference = () => {
    const next = !w.noPreference;
    w.set("noPreference", next);
    // Ticking clears any specific-vehicle pick so the two states stay
    // mutually exclusive. Unticking just hides the flag and re-shows the
    // picker; we don't restore a previous selection.
    if (next) w.set("preferredVehicleId", null);
    setJustCleared(null);
  };

  // Scroll back to the top of step 2's content when the customer changes
  // a filter — they should see the freshly-filtered list from the start
  // rather than be left mid-grid where their previous selection lived.
  // The `scroll-mt-*` class on the anchor keeps the no-preference card
  // visible just below the sticky wizard chrome.
  const scrollAnchorRef = React.useRef<HTMLDivElement>(null);
  const handleFiltersChange = React.useCallback((next: VehicleFilters) => {
    setFilters(next);
    requestAnimationFrame(() => {
      scrollAnchorRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }, []);

  // One-shot scroll to focus a pre-selected vehicle when the customer
  // lands here from the homepage widget (or any deep link carrying a
  // `preferredVehicleId`). Without this the card highlights but stays
  // below the fold on dense grids, so the user can't tell their pick
  // survived the hand-off. Uses `block: "center"` so the card lands in
  // the middle of the viewport regardless of grid position. Guarded by
  // a ref so toggling other cards or changing filters later doesn't
  // yank the page back.
  const initialScrollDone = React.useRef(false);
  const selectedCardScrollRef = React.useCallback((el: HTMLDivElement | null) => {
    if (!el || initialScrollDone.current) return;
    initialScrollDone.current = true;
    requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, []);

  if (!queryEnabled) {
    return (
      <div className="rounded-md border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
        Choose a pickup depot, dates, and category first.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
        We couldn&apos;t load available vehicles. Please try again.
      </div>
    );
  }

  if (list.length === 0) {
    return (
      <div className="rounded-md border border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
        No vehicles available for these dates at this depot. Try another depot or different dates.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div
        ref={scrollAnchorRef}
        aria-hidden
        className="scroll-mt-32 md:scroll-mt-20"
      />
      {justCleared && !w.noPreference && (
        <div className="rounded-md border border-secondary bg-secondary/10 px-3 py-2 text-sm text-foreground">
          Your earlier pick isn&apos;t available here — we&apos;ve cleared it so you can choose again.
        </div>
      )}

      <NoPreferenceCard selected={w.noPreference} onSelect={toggleNoPreference} />

      {/* Hide the picker entirely when "No preference" is ticked — clicking
          the card again unticks it and the picker reappears. */}
      {!w.noPreference && (
        <>
          <PreviouslyRentedRow
            categoryId={w.categoryId!}
            selectedVehicleId={w.preferredVehicleId}
            onSelect={toggle}
          />

          {!session && layout === "desktop" && (
            <p className="text-sm text-muted-foreground">
              <Link className="underline" href={`/login?returnTo=/booking`}>Log in</Link> to quickly rebook a vehicle you&apos;ve had before.
            </p>
          )}

          {/* Sticky filter rail — stays visible while the customer scrolls
           *  through the vehicle grid. `top-28` on mobile clears the public
           *  header (h-14) plus the wizard's mobile sticky header (~56px);
           *  `top-14` on tablet+ clears just the public header. The negative
           *  horizontal margin + matching padding extend the bg-background
           *  fill to the page edges so vehicle cards scrolling underneath
           *  don't bleed through. */}
          <div className="sticky top-28 z-20 -mx-3 bg-background px-3 pb-3 pt-2 md:top-14 md:mx-0 md:px-0">
            <VehicleFilterBar
              filters={filters}
              onChange={handleFiltersChange}
              makeOptions={makeOptions}
              modelOptions={modelOptions}
              colourOptions={colourOptions}
              resultCount={filtered.length + (filterExcludesSelection ? 1 : 0)}
              onClear={() => handleFiltersChange(DEFAULT_FILTERS)}
            />
          </div>

          {filterExcludesSelection && selectedVehicle && (
            <section className="space-y-2">
              <div className="caption uppercase tracking-[0.08em]">Your selection</div>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                <div ref={selectedCardScrollRef}>
                  <VehicleCard
                    vehicle={selectedVehicle}
                    selected
                    onSelect={() => toggle(selectedVehicle.id)}
                  />
                </div>
              </div>
            </section>
          )}

          {filtered.length === 0 && !filterExcludesSelection ? (
            <div className="rounded-md bg-muted/30 p-6 text-center text-sm text-muted-foreground">
              No vehicles match these filters.
            </div>
          ) : (
            <div className="md:max-h-[60vh] md:overflow-y-auto md:rounded-md md:border md:border-border md:bg-muted/20 md:p-3">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                {filtered.map((v) => {
                  const isSelected = w.preferredVehicleId === v.id;
                  return (
                    <div
                      key={v.id}
                      ref={isSelected ? selectedCardScrollRef : undefined}
                    >
                      <VehicleCard
                        vehicle={v}
                        selected={isSelected}
                        onSelect={() => toggle(v.id)}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
