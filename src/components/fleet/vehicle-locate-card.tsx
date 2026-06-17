"use client";

import dynamic from "next/dynamic";
import { MapPin, RefreshCw, Gauge, Navigation, Zap, ExternalLink } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { LivePin } from "@/components/maps/fleet-live-map";

// MapLibre is heavy — only load it on the client when this card mounts.
const FleetLiveMap = dynamic(
  () => import("@/components/maps/fleet-live-map").then((m) => m.FleetLiveMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        Loading map…
      </div>
    ),
  },
);

function relativeAge(ts: string | Date): string {
  const t = typeof ts === "string" ? new Date(ts).getTime() : ts.getTime();
  const seconds = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}

/** "Where is this vehicle now" card. Reads the latest stored position from the
 *  live-locations cache on mount (no GPS51 call); the Locate now button forces
 *  an immediate poll and refreshes. Only rendered for tracked vehicles. */
export function VehicleLocateCard({
  vehicleId,
  label,
  className,
}: {
  vehicleId: string;
  label: string;
  className?: string;
}) {
  const utils = trpc.useUtils();
  const live = trpc.fleet.liveLocations.useQuery(undefined, { refetchOnWindowFocus: false });
  const locate = trpc.fleet.locateNow.useMutation({
    onSettled: () => utils.fleet.liveLocations.invalidate(),
  });

  const pos = live.data?.find((r) => r.vehicleId === vehicleId) ?? null;

  // Resolve the coordinate to a street address (server-side Nominatim). Cached
  // for 5 minutes — the position only moves on the 60s poll, and reverse
  // geocoding is rate-limited.
  const address = trpc.fleet.reverseGeocode.useQuery(
    { lat: pos?.latitude ?? 0, lng: pos?.longitude ?? 0 },
    {
      enabled: pos != null,
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
    },
  );

  const pins: LivePin[] = pos
    ? [
        {
          deviceId: pos.deviceId,
          vehicleId,
          label,
          rego: null,
          makeModel: null,
          imageUrl: null,
          lat: pos.latitude,
          lng: pos.longitude,
          moving: pos.moving,
          speedKph: pos.speedKph,
          headingDeg: pos.headingDeg,
          ignitionOn: pos.ignitionOn,
          voltageV: pos.voltageV,
          timestamp: pos.timestamp,
        },
      ]
    : [];

  return (
    <Card className={className ?? "md:col-span-2"}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <MapPin className="h-4 w-4 text-muted-foreground" />
          Live location
        </CardTitle>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => locate.mutate({ vehicleId, force: true })}
          disabled={locate.isPending}
          className="gap-1.5"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${locate.isPending ? "animate-spin" : ""}`} />
          {locate.isPending ? "Locating…" : "Locate now"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {locate.data?.warning && (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {locate.data.warning} — showing last known position.
          </p>
        )}

        {pos ? (
          <>
            <div className="h-56 overflow-hidden rounded-md border">
              <FleetLiveMap pins={pins} />
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
              <Stat
                icon={<Navigation className="h-3.5 w-3.5" />}
                label="Status"
                value={pos.moving ? "Moving" : "Idle"}
                tone={pos.moving ? "ok" : undefined}
              />
              <Stat
                icon={<Gauge className="h-3.5 w-3.5" />}
                label="Speed"
                value={pos.speedKph != null ? `${Math.round(pos.speedKph)} km/h` : "—"}
              />
              <Stat
                icon={<Zap className="h-3.5 w-3.5" />}
                label="Voltage"
                value={pos.voltageV != null ? `${pos.voltageV.toFixed(1)} V` : "—"}
              />
              <Stat
                icon={<MapPin className="h-3.5 w-3.5" />}
                label="Fix age"
                value={relativeAge(pos.timestamp)}
              />
            </dl>
            <div className="space-y-1 text-xs text-muted-foreground">
              <p>
                {address.data?.address
                  ? address.data.address
                  : address.isLoading
                    ? "Resolving address…"
                    : `${pos.latitude.toFixed(5)}, ${pos.longitude.toFixed(5)}`}
                {pos.ignitionOn != null &&
                  ` · Ignition ${pos.ignitionOn ? "on" : "off"}`}
              </p>
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${pos.latitude},${pos.longitude}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                <ExternalLink className="h-3 w-3" />
                Open in Google Maps
              </a>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            {live.isLoading
              ? "Loading last position…"
              : "No position recorded yet for this tracker. Try Locate now, or check the GPS51 poller is running."}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: "ok";
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className={`font-medium ${tone === "ok" ? "text-brand-green" : ""}`}>{value}</span>
    </div>
  );
}
