"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCurrency } from "@/lib/utils";
import { validateBookingTimes } from "@/lib/validators/booking-times";
import { DateTimePicker } from "@/components/booking/date-time-picker";
import { splitLocalDateTime } from "@/lib/booking-time-slots";

type CustomerDraft = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  licenceNumber: string;
  licenceState: string;
};

const EMPTY_CUSTOMER: CustomerDraft = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  licenceNumber: "",
  licenceState: "QLD",
};

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function defaultRange(): { pickup: string; ret: string } {
  const pickup = new Date();
  pickup.setSeconds(0, 0);
  // Snap to the next 30-minute slot so the default lines up with the
  // DateTimePicker's time options (otherwise the time select starts empty).
  const slotMs = 30 * 60 * 1000;
  pickup.setTime(Math.ceil(pickup.getTime() / slotMs) * slotMs);
  const ret = new Date(pickup);
  ret.setDate(ret.getDate() + 1);
  return { pickup: toLocalInput(pickup), ret: toLocalInput(ret) };
}

export function WalkInBookingSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { data: depots } = trpc.depot.list.useQuery();
  const { data: categories } = trpc.vehicle.listCategories.useQuery();
  const quickCreate = trpc.staffCustomer.quickCreate.useMutation();
  const createWalkIn = trpc.staffBooking.createWalkIn.useMutation();

  const [depotId, setDepotId] = useState("");
  const initialRange = useMemo(() => defaultRange(), []);
  const [pickupAt, setPickupAt] = useState(initialRange.pickup);
  const [returnAt, setReturnAt] = useState(initialRange.ret);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [method, setMethod] = useState<"CARD" | "CASH">("CARD");
  const [err, setErr] = useState<string | null>(null);

  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [search, setSearch] = useState("");
  const [existingCustomerId, setExistingCustomerId] = useState<string | null>(null);
  const [customer, setCustomer] = useState<CustomerDraft>(EMPTY_CUSTOMER);

  const searchEnabled = mode === "existing" && search.trim().length >= 2;
  const { data: customerResults, isFetching: searching } = trpc.staffCustomer.search.useQuery(
    { query: search.trim(), take: 10 },
    { enabled: searchEnabled },
  );

  // Auto-pick the sole depot once it loads. setState-during-render
  // pattern (see React docs, "You Might Not Need an Effect") so the
  // selection is in place before the next render rather than a tick
  // later via useEffect.
  const [depotsKnown, setDepotsKnown] = useState(false);
  if (!depotsKnown && depots) {
    setDepotsKnown(true);
    const only = depots.length === 1 ? depots[0] : undefined;
    if (!depotId && only) {
      setDepotId(only.id);
    }
  }

  const pickupDateTime = useMemo(() => new Date(pickupAt), [pickupAt]);
  const returnDateTime = useMemo(() => new Date(returnAt), [returnAt]);
  const validRange =
    !Number.isNaN(pickupDateTime.getTime()) &&
    !Number.isNaN(returnDateTime.getTime()) &&
    returnDateTime.getTime() > pickupDateTime.getTime();

  const selectedDepot = depots?.find((d) => d.id === depotId);
  const hoursIssue = useMemo(() => {
    if (!selectedDepot || !validRange) return null;
    const check = validateBookingTimes({
      pickupDateTime,
      returnDateTime,
      pickupDepot: {
        name: selectedDepot.name,
        timezone: selectedDepot.timezone,
        operatingHours: selectedDepot.operatingHours,
      },
      returnDepot: {
        name: selectedDepot.name,
        timezone: selectedDepot.timezone,
        operatingHours: selectedDepot.operatingHours,
      },
    });
    return check.ok ? null : check;
  }, [selectedDepot, validRange, pickupDateTime, returnDateTime]);
  const days = useMemo(() => {
    if (!validRange) return 0;
    const ms = returnDateTime.getTime() - pickupDateTime.getTime();
    return Math.max(1, Math.ceil(ms / (1000 * 60 * 60 * 24)));
  }, [pickupDateTime, returnDateTime, validRange]);

  const availabilityEnabled = Boolean(depotId) && open && validRange;
  const { data: availableVehicles, isFetching: loadingVehicles } = trpc.booking.listAvailableVehicles.useQuery(
    {
      pickupDateTime,
      returnDateTime,
      depotId: depotId || undefined,
      categoryId: categoryFilter || undefined,
      limit: 48,
    },
    { enabled: availabilityEnabled },
  );

  // Clear the selected vehicle whenever the available-vehicles list
  // changes (e.g. depot or date moved) and the previous pick is no
  // longer in the list. Compare-state pattern keeps the cascade fenced
  // to the actual list-change event.
  const [lastAvailableVehicles, setLastAvailableVehicles] = useState(
    availableVehicles,
  );
  if (lastAvailableVehicles !== availableVehicles) {
    setLastAvailableVehicles(availableVehicles);
    if (
      vehicleId &&
      availableVehicles &&
      !availableVehicles.some((v) => v.id === vehicleId)
    ) {
      setVehicleId("");
    }
  }

  const selectedVehicle = availableVehicles?.find((v) => v.id === vehicleId);
  const selectedCategory = selectedVehicle?.category ?? categories?.find((c) => c.id === categoryFilter);
  const total = selectedCategory ? Number(selectedCategory.baseDailyRate) * days : 0;
  const gst = total / 11;
  const bond = selectedCategory ? Number(selectedCategory.bondAmount) : 0;

  function pickExistingCustomer(id: string, label: string) {
    setExistingCustomerId(id);
    setSearch(label);
  }

  function resetForm() {
    const fresh = defaultRange();
    setPickupAt(fresh.pickup);
    setReturnAt(fresh.ret);
    setCategoryFilter("");
    setVehicleId("");
    setMethod("CARD");
    setErr(null);
    setMode("existing");
    setSearch("");
    setExistingCustomerId(null);
    setCustomer(EMPTY_CUSTOMER);
  }

  const customerReady =
    mode === "existing"
      ? Boolean(existingCustomerId)
      : Boolean(customer.firstName && customer.lastName && customer.email);
  const ready = customerReady && depotId && vehicleId && validRange && !hoursIssue;

  async function submit() {
    setErr(null);
    try {
      const customerId =
        mode === "existing" && existingCustomerId
          ? existingCustomerId
          : (await quickCreate.mutateAsync(customer)).id;
      if (!selectedVehicle) throw new Error("Select a vehicle");
      const booking = await createWalkIn.mutateAsync({
        customerId,
        categoryId: selectedVehicle.categoryId,
        vehicleId: selectedVehicle.id,
        pickupDepotId: depotId,
        returnDepotId: depotId,
        pickupDateTime,
        returnDateTime,
        subtotal: total,
        totalAmount: total,
        gstAmount: gst,
        bondAmount: bond,
        method,
      });
      onOpenChange(false);
      router.push(`/staff/bookings/${booking.id}/check-out`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to create walk-in");
    }
  }

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) resetForm(); onOpenChange(v); }}>
      <SheetContent side="right" className="w-full sm:max-w-[720px] flex flex-col p-0">
        <SheetHeader className="px-6 pt-6 pb-4 border-b shrink-0">
          <SheetTitle className="text-xl">Walk-in / POS</SheetTitle>
          <p className="text-sm text-muted-foreground">Fast booking for customers at the counter.</p>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Customer</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={mode === "existing" ? "default" : "outline"}
                  size="sm"
                  onClick={() => {
                    setMode("existing");
                    setCustomer(EMPTY_CUSTOMER);
                  }}
                >
                  Existing customer
                </Button>
                <Button
                  type="button"
                  variant={mode === "new" ? "default" : "outline"}
                  size="sm"
                  onClick={() => {
                    setMode("new");
                    setExistingCustomerId(null);
                    setSearch("");
                  }}
                >
                  New customer
                </Button>
              </div>

              {mode === "existing" ? (
                <div className="space-y-2">
                  <Label>Search by name, email, or phone</Label>
                  <Input
                    placeholder="Start typing…"
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setExistingCustomerId(null);
                    }}
                  />
                  {searchEnabled && !existingCustomerId && (
                    <div className="rounded border divide-y max-h-60 overflow-auto text-sm">
                      {searching && <div className="px-3 py-2 text-muted-foreground">Searching…</div>}
                      {!searching && customerResults?.items.length === 0 && (
                        <div className="px-3 py-2 text-muted-foreground">
                          No matches. Switch to &ldquo;New customer&rdquo; to create one.
                        </div>
                      )}
                      {customerResults?.items.map((c) => {
                        const label = `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || c.email;
                        return (
                          <button
                            key={c.id}
                            type="button"
                            className="w-full text-left px-3 py-2 hover:bg-muted"
                            onClick={() => pickExistingCustomer(c.id, `${label} — ${c.email}`)}
                          >
                            <div className="font-medium">{label}</div>
                            <div className="text-xs text-muted-foreground">
                              {c.email}
                              {c.phone ? ` • ${c.phone}` : ""}
                              {c._count?.bookings ? ` • ${c._count.bookings} bookings` : ""}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {existingCustomerId && (
                    <div className="text-xs text-muted-foreground">
                      Selected customer.{" "}
                      <button
                        type="button"
                        className="underline"
                        onClick={() => {
                          setExistingCustomerId(null);
                          setSearch("");
                        }}
                      >
                        Change
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="grid md:grid-cols-2 gap-3">
                  <div>
                    <Label>First name</Label>
                    <Input value={customer.firstName} onChange={(e) => setCustomer({ ...customer, firstName: e.target.value })} />
                  </div>
                  <div>
                    <Label>Last name</Label>
                    <Input value={customer.lastName} onChange={(e) => setCustomer({ ...customer, lastName: e.target.value })} />
                  </div>
                  <div>
                    <Label>Email</Label>
                    <Input type="email" value={customer.email} onChange={(e) => setCustomer({ ...customer, email: e.target.value })} />
                  </div>
                  <div>
                    <Label>Phone</Label>
                    <Input value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} />
                  </div>
                  <div>
                    <Label>Licence #</Label>
                    <Input value={customer.licenceNumber} onChange={(e) => setCustomer({ ...customer, licenceNumber: e.target.value })} />
                  </div>
                  <div>
                    <Label>Licence state</Label>
                    <select
                      className="h-10 w-full rounded border bg-background px-3 text-sm"
                      value={customer.licenceState}
                      onChange={(e) => setCustomer({ ...customer, licenceState: e.target.value })}
                    >
                      {["QLD", "NSW", "VIC", "TAS", "SA", "WA", "NT", "ACT"].map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Booking</CardTitle>
            </CardHeader>
            <CardContent className="grid md:grid-cols-2 gap-3">
              <div>
                <Label>Depot</Label>
                {depots?.length === 1 && depots[0] ? (
                  <Input value={depots[0].name} disabled />
                ) : (
                  <select
                    className="h-10 w-full rounded border bg-background px-3 text-sm"
                    value={depotId}
                    onChange={(e) => {
                      setDepotId(e.target.value);
                      setVehicleId("");
                    }}
                  >
                    <option value="">—</option>
                    {depots?.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div />
              <div>
                <Label>Pickup date &amp; time</Label>
                <DateTimePicker
                  value={pickupAt}
                  onChange={(v) => {
                    setPickupAt(v);
                    setVehicleId("");
                  }}
                  depot={selectedDepot ?? null}
                />
              </div>
              <div>
                <Label>Return date &amp; time</Label>
                <DateTimePicker
                  value={returnAt}
                  onChange={(v) => {
                    setReturnAt(v);
                    setVehicleId("");
                  }}
                  depot={selectedDepot ?? null}
                  minDate={splitLocalDateTime(pickupAt).date}
                />
              </div>
              {!validRange && (
                <div className="md:col-span-2 text-xs text-destructive">
                  Return must be after pickup.
                </div>
              )}
              {validRange && hoursIssue && (
                <div className="md:col-span-2 text-xs text-destructive">
                  {hoursIssue.message}
                </div>
              )}
              <div>
                <Label>Category filter (optional)</Label>
                <select
                  className="h-10 w-full rounded border bg-background px-3 text-sm"
                  value={categoryFilter}
                  onChange={(e) => {
                    setCategoryFilter(e.target.value);
                    setVehicleId("");
                  }}
                >
                  <option value="">All categories</option>
                  {categories?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Payment method</Label>
                <select
                  className="h-10 w-full rounded border bg-background px-3 text-sm"
                  value={method}
                  onChange={(e) => setMethod(e.target.value as "CARD" | "CASH")}
                >
                  <option value="CARD">Card</option>
                  <option value="CASH">Cash</option>
                </select>
              </div>
              <div className="md:col-span-2">
                <Label>Vehicle</Label>
                {!depotId ? (
                  <div className="text-sm text-muted-foreground">Select a depot to see available vehicles.</div>
                ) : !validRange ? (
                  <div className="text-sm text-muted-foreground">Set a valid pickup and return time to search availability.</div>
                ) : loadingVehicles ? (
                  <div className="text-sm text-muted-foreground">Checking availability…</div>
                ) : availableVehicles && availableVehicles.length > 0 ? (
                  <div className="rounded border divide-y max-h-72 overflow-auto text-sm">
                    {availableVehicles.map((v) => {
                      const active = v.id === vehicleId;
                      return (
                        <button
                          key={v.id}
                          type="button"
                          onClick={() => setVehicleId(v.id)}
                          className={`w-full text-left px-3 py-2 hover:bg-muted flex justify-between items-center ${active ? "bg-muted" : ""}`}
                        >
                          <span>
                            <span className="font-medium">
                              {v.internalCode} — {v.make} {v.model}
                            </span>
                            <span className="ml-2 text-xs text-muted-foreground">
                              {v.category.name} • {v.rego} • {v.currentOdometerKm.toLocaleString()} km
                            </span>
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {formatCurrency(Number(v.category.baseDailyRate))}/day
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">No vehicles available for this depot and period.</div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Total</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-1">
              <div className="flex justify-between">
                <span>Total (GST incl.)</span>
                <strong>{formatCurrency(total)}</strong>
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Bond to hold</span>
                <span>{formatCurrency(bond)}</span>
              </div>
            </CardContent>
          </Card>

          {err && <div className="text-destructive text-sm">{err}</div>}
        </div>

        <div className="px-6 py-4 border-t shrink-0 flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!ready || quickCreate.isPending || createWalkIn.isPending} onClick={submit}>
            {quickCreate.isPending || createWalkIn.isPending ? "Processing…" : "Create booking & proceed to check-out"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
