"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { trpc } from "@/lib/trpc/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { HoursRow } from "@/components/admin/hours-editor";
import { MapPin, Building2, Clock, Phone, Mail, Loader2 } from "lucide-react";

const AU_STATES = ["QLD", "NSW", "VIC", "TAS", "SA", "WA", "NT", "ACT"] as const;
const AU_TIMEZONES = [
  "Australia/Brisbane",
  "Australia/Sydney",
  "Australia/Melbourne",
  "Australia/Hobart",
  "Australia/Adelaide",
  "Australia/Perth",
  "Australia/Darwin",
  "Australia/Lord_Howe",
] as const;

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DEBOUNCE_MS = 800;

type DepotData = {
  id: string;
  name: string;
  addressLine1: string;
  addressLine2: string | null;
  suburb: string;
  state: string;
  postcode: string;
  latitude: number | null;
  longitude: number | null;
  phone: string | null;
  email: string | null;
  timezone: string;
  maxCapacity: number;
  isActive: boolean;
  operatingHours: HoursRow[];
  _count: { vehicles: number };
};

export function DepotEditSheet({ depot }: { depot: DepotData }) {
  const util = trpc.useUtils();
  const update = trpc.admin.updateDepot.useMutation({
    onSuccess: () => util.admin.listDepots.invalidate(),
  });
  const updateHours = trpc.admin.updateDepotHours.useMutation({
    onSuccess: () => util.admin.listDepots.invalidate(),
  });

  const saving = update.isPending || updateHours.isPending;

  const [form, setForm] = useState(() => formFromDepot(depot));
  const [hours, setHours] = useState<HoursRow[]>(() => hoursFromDepot(depot));

  // Reset form when a different depot is selected. We intentionally trigger
  // only on depot.id — re-initialising on every `depot` object reference
  // change would clobber the user's in-flight edits each time the list query
  // refetches.
  useEffect(() => {
    setForm(formFromDepot(depot));
    setHours(hoursFromDepot(depot));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depot.id]);

  // --- Auto-save depot fields (debounced) ---
  const depotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialRender = useRef(true);

  const saveDepot = useCallback(
    (f: typeof form) => {
      update.mutate({
        id: depot.id,
        name: f.name,
        addressLine1: f.addressLine1,
        addressLine2: f.addressLine2 || null,
        suburb: f.suburb,
        state: f.state,
        postcode: f.postcode,
        phone: f.phone || undefined,
        email: f.email || undefined,
        timezone: f.timezone,
        maxCapacity: parseInt(f.maxCapacity, 10) || 50,
      });
    },
    [depot.id, update],
  );

  useEffect(() => {
    // Skip the initial render (form just populated from depot)
    if (initialRender.current) {
      initialRender.current = false;
      return;
    }
    if (depotTimerRef.current) clearTimeout(depotTimerRef.current);
    depotTimerRef.current = setTimeout(() => saveDepot(form), DEBOUNCE_MS);
    return () => {
      if (depotTimerRef.current) clearTimeout(depotTimerRef.current);
    };
    // Debounce fires only on `form` edits. Including `saveDepot` would
    // reschedule every time the mutation object's identity changed, which
    // happens on each render and would defeat the debounce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form]);

  // --- Auto-save hours (debounced) ---
  const hoursTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoursInitial = useRef(true);

  useEffect(() => {
    if (hoursInitial.current) {
      hoursInitial.current = false;
      return;
    }
    if (hoursTimerRef.current) clearTimeout(hoursTimerRef.current);
    hoursTimerRef.current = setTimeout(() => {
      updateHours.mutate({ depotId: depot.id, hours });
    }, DEBOUNCE_MS);
    return () => {
      if (hoursTimerRef.current) clearTimeout(hoursTimerRef.current);
    };
    // Debounce fires only on `hours` edits. `depot.id` and `updateHours`
    // are read at timeout-fire time, not at schedule time — including them
    // would reschedule every render and defeat the debounce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hours]);

  const set = (key: keyof typeof form, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const patchHour = (i: number, p: Partial<HoursRow>) =>
    setHours((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...p } : r)));

  function handleToggleActive() {
    update.mutate({ id: depot.id, isActive: !depot.isActive });
  }

  return (
    <div className="flex flex-col h-full">
      <SheetHeader className="pb-4 border-b">
        <div className="flex items-center gap-3">
          <SheetTitle className="text-xl">{depot.name}</SheetTitle>
          <StatusBadge
            status={depot.isActive ? "AVAILABLE" : "CLOSED"}
            label={depot.isActive ? "Active" : "Inactive"}
          />
          {saving && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
        <p className="text-sm text-muted-foreground">
          {depot._count.vehicles} vehicle{depot._count.vehicles !== 1 ? "s" : ""}
        </p>
      </SheetHeader>

      <div className="flex-1 overflow-y-auto py-5 space-y-6">
        {/* General */}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Building2 className="h-4 w-4" /> General
          </h3>
          <div>
            <Label>Name</Label>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label className="flex items-center gap-1"><Phone className="h-3 w-3" /> Phone</Label>
              <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} />
            </div>
            <div>
              <Label className="flex items-center gap-1"><Mail className="h-3 w-3" /> Email</Label>
              <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
            </div>
          </div>
        </section>

        {/* Address */}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <MapPin className="h-4 w-4" /> Address
          </h3>
          <div>
            <Label>Address line 1</Label>
            <Input value={form.addressLine1} onChange={(e) => set("addressLine1", e.target.value)} />
          </div>
          <div>
            <Label>Address line 2</Label>
            <Input value={form.addressLine2} onChange={(e) => set("addressLine2", e.target.value)} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <Label>Suburb</Label>
              <Input value={form.suburb} onChange={(e) => set("suburb", e.target.value)} />
            </div>
            <div>
              <Label>State</Label>
              <select
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={form.state}
                onChange={(e) => set("state", e.target.value)}
              >
                {AU_STATES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <Label>Postcode</Label>
              <Input value={form.postcode} onChange={(e) => set("postcode", e.target.value)} />
            </div>
          </div>
        </section>

        {/* Operations */}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Clock className="h-4 w-4" /> Operations
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label>Timezone</Label>
              <select
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={form.timezone}
                onChange={(e) => set("timezone", e.target.value)}
              >
                {AU_TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz.replace("Australia/", "")}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Max capacity</Label>
              <Input
                type="number"
                value={form.maxCapacity}
                onChange={(e) => set("maxCapacity", e.target.value)}
              />
            </div>
          </div>
        </section>

        {/* Operating Hours */}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Operating hours</h3>
          <div className="grid grid-cols-[60px_1fr_1fr_80px] gap-2 items-center text-sm">
            {hours.map((r, i) => (
              <div key={r.dayOfWeek} className="contents">
                <div className="text-muted-foreground">{DAYS[r.dayOfWeek]}</div>
                <Input
                  type="time"
                  value={r.openTime}
                  onChange={(e) => patchHour(i, { openTime: e.target.value })}
                  disabled={r.isClosed}
                  className="h-8"
                />
                <Input
                  type="time"
                  value={r.closeTime}
                  onChange={(e) => patchHour(i, { closeTime: e.target.value })}
                  disabled={r.isClosed}
                  className="h-8"
                />
                <label className="flex gap-1 text-xs items-center">
                  <input
                    type="checkbox"
                    checked={r.isClosed}
                    onChange={(e) => patchHour(i, { isClosed: e.target.checked })}
                  />
                  Closed
                </label>
              </div>
            ))}
          </div>
        </section>

        {/* Status */}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Status</h3>
          <Button variant="outline" size="sm" onClick={handleToggleActive}>
            {depot.isActive ? "Deactivate depot" : "Activate depot"}
          </Button>
        </section>
      </div>

      {update.error && (
        <p className="text-sm text-red-600 border-t pt-3">{update.error.message}</p>
      )}
    </div>
  );
}

function formFromDepot(depot: DepotData) {
  return {
    name: depot.name,
    addressLine1: depot.addressLine1,
    addressLine2: depot.addressLine2 ?? "",
    suburb: depot.suburb,
    state: depot.state,
    postcode: depot.postcode,
    phone: depot.phone ?? "",
    email: depot.email ?? "",
    timezone: depot.timezone,
    maxCapacity: depot.maxCapacity.toString(),
  };
}

function hoursFromDepot(depot: DepotData) {
  return Array.from({ length: 7 }, (_, i) => {
    const h = depot.operatingHours.find((x) => x.dayOfWeek === i);
    return h
      ? { dayOfWeek: i, openTime: h.openTime, closeTime: h.closeTime, isClosed: h.isClosed }
      : { dayOfWeek: i, openTime: "08:00", closeTime: "18:00", isClosed: false };
  });
}
