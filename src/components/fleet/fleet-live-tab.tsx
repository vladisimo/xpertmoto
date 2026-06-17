"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import type { LivePin } from "@/components/maps/fleet-live-map";

// MapLibre is heavy — load it only on the client when this tab is opened.
const FleetLiveMap = dynamic(
  () => import("@/components/maps/fleet-live-map").then((m) => m.FleetLiveMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading map…
      </div>
    ),
  },
);

function relativeTime(ts: string | Date): string {
  const t = typeof ts === "string" ? new Date(ts).getTime() : ts.getTime();
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

export function FleetLiveTab() {
  const [selected, setSelected] = useState<string | null>(null);
  const live = trpc.fleet.liveLocations.useQuery(undefined, { refetchInterval: 30_000 });
  const utils = trpc.useUtils();
  const sync = trpc.fleet.gps51SyncNow.useMutation({
    onSettled: () => utils.fleet.liveLocations.invalidate(),
  });
  // Full-fidelity history pull (last 24h, every tracked vehicle). Doesn't change
  // live positions, so no liveLocations invalidate — it writes the telemetry history.
  const dailySync = trpc.fleet.gps51DailySyncNow.useMutation();

  const rows = live.data ?? [];
  const pins: LivePin[] = rows.map((r) => ({
    deviceId: r.deviceId,
    vehicleId: r.vehicleId,
    label: r.vehicle?.internalCode ?? r.vehicle?.rego ?? r.deviceId,
    rego: r.vehicle?.rego ?? null,
    makeModel: [r.vehicle?.make, r.vehicle?.model].filter(Boolean).join(" ") || null,
    imageUrl: r.vehicle?.images?.[0]?.url ?? null,
    lat: r.latitude,
    lng: r.longitude,
    moving: r.moving,
    speedKph: r.speedKph,
    headingDeg: r.headingDeg,
    ignitionOn: r.ignitionOn,
    voltageV: r.voltageV,
    timestamp: r.timestamp,
  }));

  return (
    <div className="flex min-h-0 flex-1 gap-4 overflow-hidden p-1">
      <aside className="flex w-72 shrink-0 flex-col overflow-hidden rounded-lg border">
        <div className="space-y-2 border-b p-3">
          <div className="text-sm font-semibold">Tracked vehicles ({pins.length})</div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              onClick={() => sync.mutate()}
              disabled={sync.isPending}
            >
              {sync.isPending ? "Refreshing…" : "Refresh"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              title="Pull the last 24h of full GPS history for every tracked vehicle"
              onClick={() => dailySync.mutate({})}
              disabled={dailySync.isPending}
            >
              {dailySync.isPending ? "Syncing…" : "Full sync"}
            </Button>
          </div>
          {dailySync.data?.mode === "queued" && (
            <p className="text-xs text-muted-foreground">Full sync queued — runs in the background.</p>
          )}
          {dailySync.data?.mode === "inline" && (
            <p className="text-xs text-muted-foreground">
              Full sync done — {dailySync.data.recordsWritten} point
              {dailySync.data.recordsWritten === 1 ? "" : "s"} stored.
            </p>
          )}
          {dailySync.error && <p className="text-xs text-destructive">{dailySync.error.message}</p>}
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {pins.length === 0 && (
            <div className="p-3 text-sm text-muted-foreground">
              {live.isLoading
                ? "Loading…"
                : "No tracked vehicles yet. Assign a GPS tracker ID on a vehicle (Fleet → Vehicles → edit) and make sure the GPS51 poller is configured."}
            </div>
          )}
          {pins.map((p) => {
            const r = rows.find((x) => x.deviceId === p.deviceId)!;
            return (
              <button
                key={p.deviceId}
                onClick={() => setSelected(p.deviceId)}
                className={`flex w-full flex-col gap-0.5 border-b p-3 text-left text-sm hover:bg-muted/50 ${
                  selected === p.deviceId ? "bg-muted" : ""
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{p.label}</span>
                  <span className={`text-xs ${p.moving ? "text-emerald-600" : "text-muted-foreground"}`}>
                    {p.moving ? "Moving" : "Idle"}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {p.speedKph != null ? `${Math.round(p.speedKph)} km/h • ` : ""}
                  {relativeTime(r.timestamp)}
                </div>
              </button>
            );
          })}
        </div>
      </aside>
      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border">
        <FleetLiveMap pins={pins} selectedDeviceId={selected} onSelect={setSelected} detailPopup />
      </div>
    </div>
  );
}
