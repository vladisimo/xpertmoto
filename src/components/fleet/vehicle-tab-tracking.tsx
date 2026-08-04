"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  Route,
  Gauge,
  Clock,
  MapPin,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Satellite,
  List,
  Navigation,
  CalendarDays,
  AlertTriangle,
  Play,
  X,
} from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDateTime } from "@/lib/utils";
import type { TrackSegment, FixMarker } from "@/components/maps/vehicle-track-map";
import {
  TrackReplayControls,
  type ReplayPoint,
} from "@/components/maps/track-replay-controls";

// MapLibre is heavy — only load it on the client when the tab renders.
const VehicleTrackMap = dynamic(
  () => import("@/components/maps/vehicle-track-map").then((m) => m.VehicleTrackMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading map…
      </div>
    ),
  },
);

type TrackPoint = {
  lat: number;
  lng: number;
  speedKph: number | null;
  timestamp: string | Date;
  headingDeg: number | null;
  ignitionOn: boolean | null;
  batteryPct: number | null;
  odometerKm: number | null;
  voltage: number | null;
  moving: boolean | null;
  statusText: string | null;
  bookingId: string | null;
  bookingReference: string | null;
};

type BookingInfo = { id: string; bookingReference: string };

type TimelineItem =
  | {
      kind: "trip";
      index: number;
      start: number;
      from: string | Date;
      to: string | Date;
      distanceKm: number;
      durationMinutes: number;
      maxSpeedKph: number;
    }
  | { kind: "park"; index: number; start: number; from: string | Date; to: string | Date; durationMinutes: number };

type Preset = "today" | "24h" | "7d" | "custom";
/** Filter the visible path by rental: every booking, just one, or untagged fixes. */
type BookingFilter = "all" | "none" | (string & {});
type ModalKind = "fixes" | "trips" | "bookings" | null;

type Aggregate = {
  distanceKm: number;
  durationMinutes: number;
  maxSpeedKph: number;
  pointCount: number;
};

const NO_BOOKING_COLOR = "#94a3b8"; // slate-400
// Distinct, accessible hues for booking-coloured path segments.
const BOOKING_COLORS = [
  "#1B6B4A", // brand green
  "#2563eb", // blue
  "#d97706", // amber
  "#9333ea", // purple
  "#dc2626", // red
  "#0891b2", // cyan
  "#ca8a04", // gold
  "#be185d", // pink
];

// Floating "glass" surface shared by every overlay panel. Semantic tokens only;
// the translucency + blur sit it over the map without hiding it.
const GLASS =
  "rounded-lg border bg-background/85 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/65";

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Great-circle distance between two fixes, in kilometres. */
function haversineKm(a: TrackPoint, b: TrackPoint): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Roll an ordered run of fixes up into the same shape the server summary uses,
 *  so a per-booking / isolated view reads identically to the full window. */
function aggregateOf(points: TrackPoint[]): Aggregate {
  if (points.length === 0) {
    return { distanceKm: 0, durationMinutes: 0, maxSpeedKph: 0, pointCount: 0 };
  }
  let distanceKm = 0;
  let maxSpeedKph = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    if (p.speedKph != null && p.speedKph > maxSpeedKph) maxSpeedKph = p.speedKph;
    if (i > 0) distanceKm += haversineKm(points[i - 1]!, p);
  }
  const t0 = new Date(points[0]!.timestamp).getTime();
  const t1 = new Date(points[points.length - 1]!.timestamp).getTime();
  return {
    distanceKm,
    durationMinutes: Math.max(0, Math.round((t1 - t0) / 60000)),
    maxSpeedKph: Math.round(maxSpeedKph),
    pointCount: points.length,
  };
}

/** Resolve the active date window from the preset / custom inputs. */
function resolveRange(preset: Preset, fromStr: string, toStr: string): { from: Date; to: Date } {
  const now = new Date();
  if (preset === "today") {
    const from = new Date(now);
    from.setHours(0, 0, 0, 0);
    return { from, to: now };
  }
  if (preset === "24h") return { from: new Date(now.getTime() - 24 * 3600 * 1000), to: now };
  if (preset === "7d") return { from: new Date(now.getTime() - 7 * 24 * 3600 * 1000), to: now };
  const from = new Date(`${fromStr}T00:00:00`);
  const to = new Date(`${toStr}T23:59:59`);
  return { from, to };
}

export function VehicleTabTracking({
  vehicleId,
  canFetchAuthoritative,
}: {
  vehicleId: string;
  canFetchAuthoritative: boolean;
}) {
  const now = useMemo(() => new Date(), []);
  const [preset, setPreset] = useState<Preset>("7d");
  const [fromStr, setFromStr] = useState(() => fmtDate(new Date(now.getTime() - 7 * 24 * 3600 * 1000)));
  const [toStr, setToStr] = useState(() => fmtDate(now));
  const [onlyMoving, setOnlyMoving] = useState(false);
  const [minSpeed, setMinSpeed] = useState(0);
  const [showFixes, setShowFixes] = useState(true);
  const [bookingFilter, setBookingFilter] = useState<BookingFilter>("all");
  const [selectedTrip, setSelectedTrip] = useState<number | null>(null);
  const [sortKey, setSortKey] = useState<"timestamp" | "speedKph" | "batteryPct">("timestamp");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [modal, setModal] = useState<ModalKind>(null);
  const [replayOn, setReplayOn] = useState(false);
  const [replayPoint, setReplayPoint] = useState<ReplayPoint | null>(null);

  // The tab is map-first and must not introduce page scroll. Rather than guess a
  // CSS offset for the (variable-height) page header, measure the region's top
  // against the viewport and fill the rest, leaving a small bottom gutter that
  // covers the PageShell's bottom padding so the page never overflows.
  const containerRef = useRef<HTMLDivElement>(null);
  const [regionHeight, setRegionHeight] = useState<number | null>(null);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const BOTTOM_GUTTER = 36;
    const recalc = () => {
      const top = el.getBoundingClientRect().top;
      setRegionHeight(Math.max(360, window.innerHeight - top - BOTTOM_GUTTER));
    };
    recalc();
    window.addEventListener("resize", recalc);
    return () => window.removeEventListener("resize", recalc);
  }, []);

  const range = useMemo(
    () => resolveRange(preset, fromStr, toStr),
    [preset, fromStr, toStr],
  );
  const rangeValid = range.to > range.from;

  const trackInput = useMemo(
    () => ({
      vehicleId,
      from: range.from,
      to: range.to,
      onlyMoving: onlyMoving || undefined,
      minSpeedKph: minSpeed > 0 ? minSpeed : undefined,
    }),
    [vehicleId, range, onlyMoving, minSpeed],
  );

  const utils = trpc.useUtils();
  const stored = trpc.fleet.vehicleTrack.useQuery(trackInput, { enabled: rangeValid });
  const authoritative = trpc.fleet.vehicleTrackAuthoritative.useMutation({
    // The pull is cached into our telemetry server-side, so refresh the stored
    // query to keep its cache in step with what's now persisted.
    onSuccess: () => utils.fleet.vehicleTrack.invalidate(),
  });

  // The on-demand parent-server pull supersedes the stored breadcrumb once it
  // resolves — but only for the parameters it was fetched with. Reset it when
  // the window or filters change so we don't show a stale track.
  const { reset: resetAuth } = authoritative;
  useEffect(() => {
    resetAuth();
  }, [trackInput, resetAuth]);

  // Window / filter changes invalidate any active focus on a trip or booking.
  useEffect(() => {
    setSelectedTrip(null);
    setBookingFilter("all");
  }, [trackInput]);

  const active = authoritative.data ?? stored.data;
  const source = active?.source ?? "stored";
  const isLoading = stored.isLoading;
  const isError = stored.isError;
  const error = stored.error;

  const points = useMemo(() => (active?.points ?? []) as TrackPoint[], [active]);
  const summary = active?.summary ?? null;
  const trips = useMemo(() => active?.trips ?? [], [active]);
  const parkings = useMemo(() => active?.parkings ?? [], [active]);
  const bookings = useMemo(() => (active?.bookings ?? []) as BookingInfo[], [active]);

  // Merge trips and parking dwells into one chronological timeline (mirrors the
  // GPS51 track view: Trip 16M/4.6km → Parking 5H20M → …).
  const timeline = useMemo(() => {
    const items: TimelineItem[] = [];
    for (const t of trips) {
      if (!t.summary) continue;
      items.push({
        kind: "trip",
        index: t.index,
        start: new Date(t.summary.from).getTime(),
        from: t.summary.from,
        to: t.summary.to,
        distanceKm: t.summary.distanceKm,
        durationMinutes: t.summary.durationMinutes,
        maxSpeedKph: t.summary.maxSpeedKph,
      });
    }
    for (const p of parkings) {
      items.push({
        kind: "park",
        index: p.index,
        start: new Date(p.from).getTime(),
        from: p.from,
        to: p.to,
        durationMinutes: p.durationMinutes,
      });
    }
    items.sort((a, b) => a.start - b.start);
    return items;
  }, [trips, parkings]);

  const colorForBooking = useMemo(() => {
    const map = new Map<string, string>();
    bookings.forEach((b, i) => map.set(b.id, BOOKING_COLORS[i % BOOKING_COLORS.length]!));
    return (id: string | null) => (id ? map.get(id) ?? NO_BOOKING_COLOR : NO_BOOKING_COLOR);
  }, [bookings]);

  // Points after the booking filter (but before trip isolation).
  const filteredPoints = useMemo(() => {
    if (bookingFilter === "all") return points;
    if (bookingFilter === "none") return points.filter((p) => p.bookingId == null);
    return points.filter((p) => p.bookingId === bookingFilter);
  }, [points, bookingFilter]);

  // The point set actually drawn: a single isolated trip wins over the booking
  // filter; otherwise the booking-filtered run.
  const visiblePoints = useMemo(() => {
    if (selectedTrip != null) {
      const t = trips.find((x) => x.index === selectedTrip);
      return (t?.points ?? []) as TrackPoint[];
    }
    return filteredPoints;
  }, [selectedTrip, trips, filteredPoints]);

  // Map segments: an isolated trip draws green; otherwise break the path wherever
  // the associated booking changes so each contiguous run is coloured by its rental.
  const segments: TrackSegment[] = useMemo(() => {
    if (selectedTrip != null) {
      const t = trips.find((x) => x.index === selectedTrip);
      if (!t) return [];
      return [
        {
          id: `trip-${t.index}`,
          color: BOOKING_COLORS[t.index % BOOKING_COLORS.length]!,
          points: t.points.map((p) => ({ lat: p.lat, lng: p.lng })),
        },
      ];
    }
    const segs: TrackSegment[] = [];
    let current: TrackPoint[] = [];
    let currentBooking: string | null | undefined = undefined;
    const flush = () => {
      if (current.length === 0) return;
      const bid = current[0]!.bookingId;
      segs.push({
        id: `seg-${segs.length}`,
        color: colorForBooking(bid),
        points: current.map((p) => ({ lat: p.lat, lng: p.lng })),
      });
      current = [];
    };
    for (const p of filteredPoints) {
      if (currentBooking !== undefined && p.bookingId !== currentBooking) flush();
      current.push(p);
      currentBooking = p.bookingId;
    }
    flush();
    return segs;
  }, [selectedTrip, trips, filteredPoints, colorForBooking]);

  const fixMarkers: FixMarker[] | undefined = useMemo(() => {
    if (!showFixes) return undefined;
    return visiblePoints.map((p) => ({
      lat: p.lat,
      lng: p.lng,
      timestamp: p.timestamp,
      speedKph: p.speedKph,
      headingDeg: p.headingDeg,
      ignitionOn: p.ignitionOn,
      batteryPct: p.batteryPct,
      bookingReference: p.bookingReference,
    }));
  }, [showFixes, visiblePoints]);

  // Summary shown in the floating chips: the server roll-up for the whole window,
  // or a derived aggregate when a trip / booking is isolated.
  const displaySummary: Aggregate | null = useMemo(() => {
    if (selectedTrip == null && bookingFilter === "all") {
      return summary
        ? {
            distanceKm: summary.distanceKm,
            durationMinutes: summary.durationMinutes,
            maxSpeedKph: summary.maxSpeedKph,
            pointCount: summary.pointCount,
          }
        : null;
    }
    return aggregateOf(visiblePoints);
  }, [selectedTrip, bookingFilter, summary, visiblePoints]);

  // Per-booking roll-up for the Bookings modal (+ an "untagged" bucket).
  const bookingRows = useMemo(() => {
    const byBooking = new Map<string, TrackPoint[]>();
    const untagged: TrackPoint[] = [];
    for (const p of points) {
      if (p.bookingId == null) untagged.push(p);
      else {
        if (!byBooking.has(p.bookingId)) byBooking.set(p.bookingId, []);
        byBooking.get(p.bookingId)!.push(p);
      }
    }
    const rows = bookings.map((b) => ({
      key: b.id as BookingFilter,
      id: b.id,
      label: b.bookingReference,
      color: colorForBooking(b.id),
      agg: aggregateOf(byBooking.get(b.id) ?? []),
    }));
    if (untagged.length > 0) {
      rows.push({
        key: "none",
        id: "",
        label: "No booking",
        color: NO_BOOKING_COLOR,
        agg: aggregateOf(untagged),
      });
    }
    return rows;
  }, [points, bookings, colorForBooking]);

  const sortedFixes = useMemo(() => {
    const arr = [...visiblePoints];
    arr.sort((a, b) => {
      let av: number;
      let bv: number;
      if (sortKey === "timestamp") {
        av = new Date(a.timestamp).getTime();
        bv = new Date(b.timestamp).getTime();
      } else {
        av = a[sortKey] ?? -1;
        bv = b[sortKey] ?? -1;
      }
      return sortDir === "asc" ? av - bv : bv - av;
    });
    return arr;
  }, [visiblePoints, sortKey, sortDir]);

  const toggleSort = (key: typeof sortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const focusLabel =
    selectedTrip != null
      ? `Trip ${selectedTrip + 1}`
      : bookingFilter === "none"
        ? "Untagged fixes"
        : bookingFilter !== "all"
          ? bookings.find((b) => b.id === bookingFilter)?.bookingReference ?? "Booking"
          : null;

  const clearFocus = () => {
    setSelectedTrip(null);
    setBookingFilter("all");
  };

  const hasData = points.length > 0;

  return (
    <div
      ref={containerRef}
      style={regionHeight ? { height: regionHeight } : undefined}
      className="relative w-full overflow-hidden rounded-lg border min-h-[26rem]"
    >
      {/* Map fills the region */}
      <div className="absolute inset-0">
        <VehicleTrackMap
          segments={segments}
          fixes={fixMarkers}
          replayMarker={replayOn ? replayPoint : null}
        />
      </div>

      {/* Replay controls dock (bottom) — only while replay is on */}
      {replayOn && hasData && (
        <div
          className={`pointer-events-auto absolute inset-x-3 bottom-3 z-10 flex items-center gap-2 p-2 ${GLASS}`}
        >
          <TrackReplayControls points={visiblePoints} onFrame={setReplayPoint} />
        </div>
      )}

      {/* Floating overlays — wrapper is click-through; each panel re-enables events */}
      <div className="pointer-events-none absolute inset-0">
        {/* Top: filter toolbar (kept clear of the top-right zoom control) */}
        <div
          className={`pointer-events-auto absolute left-3 right-16 top-3 flex flex-wrap items-center gap-2 p-2 text-sm ${GLASS}`}
        >
          <span className="hidden items-center gap-1.5 pl-1 text-xs font-medium uppercase tracking-wider text-muted-foreground sm:inline-flex">
            <Navigation className="h-3.5 w-3.5" /> Tracking
          </span>
          <Select value={preset} onValueChange={(v) => setPreset(v as Preset)}>
            <SelectTrigger className="h-9 w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="24h">Last 24 hours</SelectItem>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="custom">Custom range</SelectItem>
            </SelectContent>
          </Select>
          {preset === "custom" && (
            <>
              <Input
                type="date"
                aria-label="From date"
                value={fromStr}
                max={toStr}
                onChange={(e) => setFromStr(e.target.value)}
                className="h-9 w-[150px]"
              />
              <Input
                type="date"
                aria-label="To date"
                value={toStr}
                min={fromStr}
                onChange={(e) => setToStr(e.target.value)}
                className="h-9 w-[150px]"
              />
            </>
          )}
          <Select
            value={bookingFilter === "all" ? "all" : bookingFilter}
            onValueChange={(v) => {
              setSelectedTrip(null);
              setBookingFilter(v as BookingFilter);
            }}
          >
            <SelectTrigger className="h-9 w-[170px]">
              <SelectValue placeholder="All bookings" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All bookings</SelectItem>
              {bookings.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.bookingReference}
                </SelectItem>
              ))}
              <SelectItem value="none">No booking</SelectItem>
            </SelectContent>
          </Select>
          <div className="mx-0.5 h-6 w-px bg-border" aria-hidden />
          <label className="flex items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              checked={onlyMoving}
              onChange={(e) => setOnlyMoving(e.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            Moving only
          </label>
          <label className="flex items-center gap-1.5 text-xs" title="Minimum speed (km/h)">
            Min
            <Input
              type="number"
              min={0}
              value={minSpeed || ""}
              placeholder="0"
              onChange={(e) => setMinSpeed(Math.max(0, Number(e.target.value) || 0))}
              className="h-9 w-16"
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              checked={showFixes}
              onChange={(e) => setShowFixes(e.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            Fix points
          </label>
          <Button
            type="button"
            size="sm"
            variant={replayOn ? "default" : "outline"}
            onClick={() => setReplayOn((v) => !v)}
            disabled={!hasData}
            className="h-8 gap-1.5"
            title="Animate a marker along the route"
          >
            <Play className="h-3.5 w-3.5" />
            Replay
          </Button>
          <div className="mx-0.5 h-6 w-px bg-border" aria-hidden />
          {source === "gps51" ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-primary">
              <Satellite className="h-3.5 w-3.5" /> Actual GPS51 track
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Route className="h-3.5 w-3.5" /> Stored breadcrumb
            </span>
          )}
          {canFetchAuthoritative && source !== "gps51" && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => rangeValid && authoritative.mutate(trackInput)}
              disabled={authoritative.isPending || !rangeValid}
              className="h-8 gap-1.5"
            >
              <Satellite className={`h-3.5 w-3.5 ${authoritative.isPending ? "animate-pulse" : ""}`} />
              {authoritative.isPending ? "Fetching…" : "Fetch actual"}
            </Button>
          )}
        </div>

        {/* Focus pill — visible when a trip or booking is isolated */}
        {focusLabel && (
          <div className="pointer-events-auto absolute left-1/2 top-20 flex -translate-x-1/2 items-center gap-2 rounded-full border bg-background/90 px-3 py-1 text-xs shadow-md backdrop-blur">
            <span className="font-medium">Showing: {focusLabel}</span>
            <button
              type="button"
              onClick={clearFocus}
              className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" /> Clear
            </button>
          </div>
        )}

        {/* Bottom-left: summary chips */}
        {hasData && displaySummary && (
          <div className={`pointer-events-auto absolute bottom-3 left-3 flex items-stretch gap-1 p-1.5 ${GLASS}`}>
            <SummaryChip
              icon={<Route className="h-3.5 w-3.5" />}
              label="Distance"
              value={`${displaySummary.distanceKm.toFixed(1)} km`}
            />
            <SummaryChip
              icon={<Clock className="h-3.5 w-3.5" />}
              label="Duration"
              value={formatDuration(displaySummary.durationMinutes)}
            />
            <SummaryChip
              icon={<Gauge className="h-3.5 w-3.5" />}
              label="Max speed"
              value={`${displaySummary.maxSpeedKph} km/h`}
            />
            <SummaryChip
              icon={<MapPin className="h-3.5 w-3.5" />}
              label="Fixes"
              value={String(displaySummary.pointCount)}
            />
          </div>
        )}

        {/* Bottom-right: detail launchers */}
        {hasData && (
          <div className={`pointer-events-auto absolute bottom-3 right-3 flex flex-col gap-1.5 p-1.5 ${GLASS}`}>
            <LauncherButton
              icon={<List className="h-4 w-4" />}
              label="Fixes"
              count={visiblePoints.length}
              onClick={() => setModal("fixes")}
            />
            <LauncherButton
              icon={<Route className="h-4 w-4" />}
              label="Trips & stops"
              count={timeline.length}
              onClick={() => setModal("trips")}
            />
            <LauncherButton
              icon={<CalendarDays className="h-4 w-4" />}
              label="Bookings"
              count={bookingRows.length}
              onClick={() => setModal("bookings")}
              disabled={bookingRows.length === 0}
            />
          </div>
        )}

        {/* Centered state overlays */}
        {(!rangeValid || isError || authoritative.error || (isLoading && rangeValid) || (!hasData && !isLoading)) && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
            <div className={`pointer-events-auto max-w-md p-5 text-center text-sm ${GLASS}`}>
              {!rangeValid ? (
                <p className="text-destructive">The “to” date must be after the “from” date.</p>
              ) : isError ? (
                <p className="text-destructive">{error?.message ?? "Failed to load tracking data."}</p>
              ) : authoritative.error ? (
                <p className="text-destructive">{authoritative.error.message}</p>
              ) : isLoading ? (
                <p className="text-muted-foreground">Loading tracking…</p>
              ) : (
                <p className="text-muted-foreground">
                  No GPS breadcrumb was recorded for this vehicle in the selected window. Adjust the
                  date range or filters, or confirm the vehicle has a GPS tracker assigned.
                </p>
              )}
            </div>
          </div>
        )}

        {/* Truncation notice */}
        {active?.truncated && hasData && (
          <div className="pointer-events-auto absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-md border bg-background/95 px-3 py-1.5 text-xs font-medium text-foreground shadow-sm backdrop-blur">
            <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground" />
            Showing the first 5,000 fixes — narrow the dates or add a filter to see the rest.
          </div>
        )}

        {/* Fallback reason for an authoritative pull that degraded to stored */}
        {authoritative.data?.reason && (
          <div className="pointer-events-auto absolute right-3 top-20 inline-flex items-center gap-1.5 rounded-md border bg-background/90 px-2.5 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur">
            <AlertTriangle className="h-3.5 w-3.5" />
            Fell back to stored: {authoritative.data.reason}
          </div>
        )}
      </div>

      {/* ───────── Modals ───────── */}

      {/* Fixes */}
      <Dialog open={modal === "fixes"} onOpenChange={(o) => !o && setModal(null)}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>GPS fixes ({visiblePoints.length})</DialogTitle>
            <DialogDescription>
              {focusLabel ? `${focusLabel} · ` : ""}
              {formatDateTime(range.from)} → {formatDateTime(range.to)}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[70vh] overflow-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-primary text-primary-foreground">
                <tr className="text-left">
                  <SortableTh
                    label="Time"
                    active={sortKey === "timestamp"}
                    dir={sortDir}
                    onClick={() => toggleSort("timestamp")}
                  />
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">
                    Location
                  </th>
                  <SortableTh
                    label="Speed"
                    active={sortKey === "speedKph"}
                    dir={sortDir}
                    onClick={() => toggleSort("speedKph")}
                  />
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">
                    Heading
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">
                    Ignition
                  </th>
                  <SortableTh
                    label="Battery"
                    active={sortKey === "batteryPct"}
                    dir={sortDir}
                    onClick={() => toggleSort("batteryPct")}
                  />
                  {source === "gps51" && (
                    <>
                      <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">
                        Odometer
                      </th>
                      <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">
                        Voltage
                      </th>
                      <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">
                        Status
                      </th>
                    </>
                  )}
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">
                    Booking
                  </th>
                </tr>
              </thead>
              <tbody className="bg-card">
                {sortedFixes.map((p, i) => (
                  <tr key={i} className="border-b last:border-0 transition-colors hover:bg-muted/30">
                    <td className="whitespace-nowrap px-4 py-2.5">{formatDateTime(p.timestamp)}</td>
                    <td className="px-4 py-2.5 tabular-nums text-muted-foreground">
                      {p.lat.toFixed(5)}, {p.lng.toFixed(5)}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums">
                      {p.speedKph != null ? `${Math.round(p.speedKph)} km/h` : "—"}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-muted-foreground">
                      {p.headingDeg != null ? `${Math.round(p.headingDeg)}°` : "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      {p.ignitionOn == null ? "—" : p.ignitionOn ? "On" : "Off"}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums">
                      {p.batteryPct != null ? `${Math.round(p.batteryPct)}%` : "—"}
                    </td>
                    {source === "gps51" && (
                      <>
                        <td className="px-4 py-2.5 tabular-nums text-muted-foreground">
                          {p.odometerKm != null ? `${p.odometerKm.toFixed(1)} km` : "—"}
                        </td>
                        <td className="px-4 py-2.5 tabular-nums text-muted-foreground">
                          {p.voltage != null ? `${p.voltage.toFixed(1)} V` : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">{p.statusText ?? "—"}</td>
                      </>
                    )}
                    <td className="px-4 py-2.5">
                      {p.bookingId ? (
                        <Link
                          href={`/staff/bookings/${p.bookingId}`}
                          className="inline-flex items-center gap-1.5 underline decoration-dotted underline-offset-2 hover:decoration-solid"
                        >
                          <span
                            className="inline-block h-2 w-2 rounded-full"
                            style={{ backgroundColor: colorForBooking(p.bookingId) }}
                          />
                          {p.bookingReference}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>

      {/* Trips & stops */}
      <Dialog open={modal === "trips"} onOpenChange={(o) => !o && setModal(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Trips &amp; stops</DialogTitle>
            <DialogDescription>
              {trips.length} {trips.length === 1 ? "trip" : "trips"} · {parkings.length}{" "}
              {parkings.length === 1 ? "stop" : "stops"} — select a trip to isolate it on the map.
            </DialogDescription>
          </DialogHeader>
          {timeline.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No trips or stops in this window.
            </p>
          ) : (
            <ul className="max-h-[70vh] divide-y overflow-auto rounded-md border">
              {timeline.map((item) =>
                item.kind === "trip" ? (
                  <li
                    key={`trip-${item.index}`}
                    onClick={() => {
                      setBookingFilter("all");
                      setSelectedTrip(selectedTrip === item.index ? null : item.index);
                      setModal(null);
                    }}
                    className={`flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/30 ${
                      selectedTrip === item.index ? "bg-muted/50" : ""
                    }`}
                  >
                    <span
                      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: BOOKING_COLORS[item.index % BOOKING_COLORS.length] }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">Trip · {item.distanceKm.toFixed(1)} km</div>
                      <div className="text-xs text-muted-foreground">
                        {formatDateTime(item.from)} → {formatDateTime(item.to)}
                      </div>
                    </div>
                    <div className="shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                      {formatDuration(item.durationMinutes)} · {item.maxSpeedKph} km/h
                    </div>
                  </li>
                ) : (
                  <li key={`park-${item.index}`} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded bg-muted text-[10px] font-bold text-muted-foreground">
                      P
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-muted-foreground">Parked</div>
                      <div className="text-xs text-muted-foreground">
                        {formatDateTime(item.from)} → {formatDateTime(item.to)}
                      </div>
                    </div>
                    <div className="shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                      {formatDuration(item.durationMinutes)}
                    </div>
                  </li>
                ),
              )}
            </ul>
          )}
        </DialogContent>
      </Dialog>

      {/* Bookings */}
      <Dialog open={modal === "bookings"} onOpenChange={(o) => !o && setModal(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Bookings in this window</DialogTitle>
            <DialogDescription>
              Distance and time per rental. Isolate one to colour just its path on the map.
            </DialogDescription>
          </DialogHeader>
          {bookingRows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No bookings overlapped this window.
            </p>
          ) : (
            <div className="max-h-[70vh] overflow-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-primary text-left text-xs uppercase tracking-wide text-primary-foreground">
                  <tr>
                    <th className="px-4 py-3 font-semibold text-primary-foreground/80">Booking</th>
                    <th className="px-4 py-3 font-semibold text-primary-foreground/80">Distance</th>
                    <th className="px-4 py-3 font-semibold text-primary-foreground/80">Duration</th>
                    <th className="px-4 py-3 font-semibold text-primary-foreground/80">Max speed</th>
                    <th className="px-4 py-3 font-semibold text-primary-foreground/80">Fixes</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="bg-card">
                  {bookingRows.map((row) => (
                    <tr key={row.key} className="border-b last:border-0 hover:bg-muted/20">
                      <td className="px-4 py-2.5">
                        <span className="inline-flex items-center gap-2">
                          <span
                            className="inline-block h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: row.color }}
                          />
                          {row.id ? (
                            <Link
                              href={`/staff/bookings/${row.id}`}
                              className="underline decoration-dotted underline-offset-2 hover:decoration-solid"
                            >
                              {row.label}
                            </Link>
                          ) : (
                            <span className="text-muted-foreground">{row.label}</span>
                          )}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 tabular-nums">{row.agg.distanceKm.toFixed(1)} km</td>
                      <td className="px-4 py-2.5 tabular-nums">{formatDuration(row.agg.durationMinutes)}</td>
                      <td className="px-4 py-2.5 tabular-nums">{row.agg.maxSpeedKph} km/h</td>
                      <td className="px-4 py-2.5 tabular-nums">{row.agg.pointCount}</td>
                      <td className="px-4 py-2.5 text-right">
                        <Button
                          type="button"
                          size="sm"
                          variant={bookingFilter === row.key ? "secondary" : "ghost"}
                          onClick={() => {
                            setSelectedTrip(null);
                            setBookingFilter(bookingFilter === row.key ? "all" : row.key);
                            setModal(null);
                          }}
                        >
                          {bookingFilter === row.key ? "Showing" : "Isolate on map"}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SortableTh({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
}) {
  const Icon = !active ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80">
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-1 hover:text-primary-foreground"
      >
        {label}
        <Icon className="h-3 w-3" />
      </button>
    </th>
  );
}

function SummaryChip({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md px-2.5 py-1">
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function LauncherButton({
  icon,
  label,
  count,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
    >
      <span className="text-muted-foreground">{icon}</span>
      <span className="flex-1 font-medium">{label}</span>
      <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground">
        {count}
      </span>
    </button>
  );
}
