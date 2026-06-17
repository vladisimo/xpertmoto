"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import { Route, Gauge, Clock, MapPin, Satellite } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/utils";
import type { TripMapPoint } from "@/components/maps/trip-map";

// MapLibre is heavy — only load it on the client when the Trip tab is opened.
const TripMap = dynamic(() => import("@/components/maps/trip-map").then((m) => m.TripMap), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      Loading map…
    </div>
  ),
});

type TripPoint = { lat: number; lng: number; speedKph: number | null; timestamp: string | Date };
type TripSummary = {
  pointCount: number;
  distanceKm: number;
  maxSpeedKph: number;
  durationMinutes: number;
  from: string | Date;
  to: string | Date;
} | null;

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Per-rental trip panel. Renders the stored telemetry breadcrumb by default;
 *  managers can pull the full-fidelity GPS51 track on demand (rate-limited). */
export function BookingTripPanel({
  bookingId,
  canFetchAuthoritative,
}: {
  bookingId: string;
  canFetchAuthoritative: boolean;
}) {
  const stored = trpc.fleet.bookingTrip.useQuery({ bookingId });
  const authoritative = trpc.fleet.bookingTripAuthoritative.useMutation();

  // The authoritative fetch supersedes the stored breadcrumb once it resolves.
  const auth = authoritative.data;
  const points: TripPoint[] = useMemo(
    () => (auth?.points ?? stored.data?.points ?? []) as TripPoint[],
    [auth, stored.data],
  );
  const summary: TripSummary = (auth?.summary ?? stored.data?.summary ?? null) as TripSummary;
  const source = auth?.source ?? "stored";

  const mapPoints: TripMapPoint[] = useMemo(
    () => points.map((p) => ({ lat: p.lat, lng: p.lng })),
    [points],
  );

  if (stored.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading trip…</p>;
  }

  if (!stored.data?.vehicleId && !auth) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          No vehicle was allocated to this booking, so there is no trip to show.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {source === "gps51" ? (
              <span className="inline-flex items-center gap-1.5 text-brand-green">
                <Satellite className="h-3.5 w-3.5" />
                Authoritative GPS51 track
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <Route className="h-3.5 w-3.5" />
                Stored breadcrumb
              </span>
            )}
          </span>
          {auth?.reason && (
            <span className="text-xs text-amber-700">· fell back: {auth.reason}</span>
          )}
        </div>
        {canFetchAuthoritative && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => authoritative.mutate({ bookingId })}
            disabled={authoritative.isPending}
            className="gap-1.5"
          >
            <Satellite className={`h-3.5 w-3.5 ${authoritative.isPending ? "animate-pulse" : ""}`} />
            {authoritative.isPending ? "Fetching…" : "Fetch authoritative GPS track"}
          </Button>
        )}
      </div>

      {authoritative.error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {authoritative.error.message}
        </p>
      )}

      {points.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No GPS breadcrumb was recorded for this rental window.
            {canFetchAuthoritative && " Try fetching the authoritative track above."}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <SummaryStat
              icon={<Route className="h-3.5 w-3.5" />}
              label="Distance"
              value={summary ? `${summary.distanceKm.toFixed(1)} km` : "—"}
            />
            <SummaryStat
              icon={<Clock className="h-3.5 w-3.5" />}
              label="Duration"
              value={summary ? formatDuration(summary.durationMinutes) : "—"}
            />
            <SummaryStat
              icon={<Gauge className="h-3.5 w-3.5" />}
              label="Max speed"
              value={summary ? `${summary.maxSpeedKph} km/h` : "—"}
            />
            <SummaryStat
              icon={<MapPin className="h-3.5 w-3.5" />}
              label="Fixes"
              value={summary ? String(summary.pointCount) : "—"}
            />
          </div>

          <Card className="overflow-hidden">
            <div className="h-[420px] w-full">
              <TripMap points={mapPoints} />
            </div>
          </Card>

          {summary && (
            <p className="text-xs text-muted-foreground">
              {formatDateTime(summary.from)} → {formatDateTime(summary.to)}
            </p>
          )}
        </>
      )}
    </div>
  );
}

function SummaryStat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}
