"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  Map,
  Marker,
  Popup,
  NavigationControl,
  type MapRef,
  type MapEvent,
} from "react-map-gl/maplibre";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MAP_STYLE_URL } from "@/lib/maps/style";
import {
  useMapStyleStatus,
  MapUnavailable,
} from "@/components/maps/map-style-status";

export type LivePin = {
  deviceId: string;
  vehicleId: string | null;
  label: string;
  rego: string | null;
  makeModel: string | null;
  /** Primary vehicle photo for the detail card thumbnail; null when none on file. */
  imageUrl: string | null;
  lat: number;
  lng: number;
  moving: boolean | null;
  speedKph: number | null;
  headingDeg: number | null;
  ignitionOn: boolean | null;
  /** Supply voltage in volts (from GPS51 status text). Bike trackers report this
   *  rather than a battery percentage. */
  voltageV: number | null;
  timestamp: string | Date;
};

function relativeTime(ts: string | Date): string {
  const t = typeof ts === "string" ? new Date(ts).getTime() : ts.getTime();
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

function compass(deg: number): string {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round(deg / 45) % 8] ?? "N";
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-900">{value}</span>
    </div>
  );
}

function VehicleDetailCard({ pin }: { pin: LivePin }) {
  return (
    <div className="min-w-[14rem] text-xs">
      {pin.imageUrl && (
        <div className="relative mb-1.5 h-[108px] w-full overflow-hidden rounded bg-gray-100">
          <Image
            src={pin.imageUrl}
            alt={pin.makeModel ?? pin.label}
            fill
            sizes="224px"
            className="object-contain"
          />
        </div>
      )}
      <div className="flex items-center justify-between gap-2 border-b border-gray-100 pb-1.5">
        <span className="text-sm font-semibold text-gray-900">{pin.label}</span>
        <span
          className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
            pin.moving
              ? "bg-emerald-50 text-emerald-700"
              : "bg-gray-100 text-gray-600"
          }`}
        >
          {pin.moving ? "Moving" : "Idle"}
        </span>
      </div>
      <div className="space-y-1 py-2">
        {pin.makeModel && <DetailRow label="Vehicle" value={pin.makeModel} />}
        {pin.rego && <DetailRow label="Rego" value={pin.rego} />}
        <DetailRow
          label="Speed"
          value={
            pin.speedKph != null ? `${Math.round(pin.speedKph)} km/h` : "—"
          }
        />
        <DetailRow
          label="Heading"
          value={
            pin.headingDeg != null
              ? `${compass(pin.headingDeg)} (${Math.round(pin.headingDeg)}°)`
              : "—"
          }
        />
        <DetailRow
          label="Ignition"
          value={pin.ignitionOn == null ? "—" : pin.ignitionOn ? "On" : "Off"}
        />
        <DetailRow
          label="Voltage"
          value={pin.voltageV != null ? `${pin.voltageV.toFixed(1)} V` : "—"}
        />
        <DetailRow label="Updated" value={relativeTime(pin.timestamp)} />
        <DetailRow label="Device" value={pin.deviceId} />
      </div>
      {pin.vehicleId && (
        <Link
          href={`/staff/fleet/vehicles/${pin.vehicleId}`}
          className="block border-t border-gray-100 pt-1.5 font-medium text-emerald-700 hover:underline"
        >
          View vehicle →
        </Link>
      )}
    </div>
  );
}

const DEFAULT_CENTER: [number, number] = [153.2, -27.5];
const MOVING_GREEN = "#1B6B4A";
const IDLE_GREY = "#6b7280";

function LiveDot({
  pin,
  selected,
  onClick,
}: {
  pin: LivePin;
  selected: boolean;
  onClick: () => void;
}) {
  const moving = pin.moving === true;
  const color = moving ? MOVING_GREEN : IDLE_GREY;
  const size = selected ? 18 : 14;
  return (
    <div
      className="relative cursor-pointer"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={`${pin.label}${pin.speedKph != null ? ` • ${Math.round(pin.speedKph)} km/h` : ""}`}
    >
      <div
        style={{
          width: size,
          height: size,
          backgroundColor: color,
          border: "2px solid white",
          borderRadius: "9999px",
          boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
        }}
      />
    </div>
  );
}

export function FleetLiveMap({
  pins,
  selectedDeviceId,
  onSelect,
  detailPopup = false,
}: {
  pins: LivePin[];
  selectedDeviceId?: string | null;
  onSelect?: (id: string | null) => void;
  /** Show a rich detail popup over the selected vehicle. Off by default so the
   *  single-vehicle locate card (which has its own detail list) stays clean. */
  detailPopup?: boolean;
}) {
  const mapRef = useRef<MapRef | null>(null);
  const fitted = useRef(false);
  const { failed, onLoad, onError } = useMapStyleStatus();
  // The MapRef isn't wired up until react-map-gl finishes creating the map, so
  // the camera effects below can't run on first render — they gate on this and
  // re-run once `load` fires (and the ref is guaranteed ready).
  const [mapReady, setMapReady] = useState(false);
  const handleLoad = useCallback(
    (e: MapEvent) => {
      onLoad(e);
      setMapReady(true);
    },
    [onLoad],
  );
  const selectedPin = selectedDeviceId
    ? (pins.find((p) => p.deviceId === selectedDeviceId) ?? null)
    : null;

  // Multi-vehicle fleet map: fit to all pins once on first data; afterwards
  // leave the viewport under user control so live refreshes don't yank the map
  // around.
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || pins.length < 2 || fitted.current) return;
    const bounds = new maplibregl.LngLatBounds();
    for (const p of pins) bounds.extend([p.lng, p.lat]);
    map.fitBounds(bounds, { padding: 80, maxZoom: 13, duration: 0 });
    fitted.current = true;
  }, [pins, mapReady]);

  // Single-vehicle locate card: there's no background polling here — the only
  // refresh is an explicit "Locate now" — so recenter whenever the fix moves.
  // First fix jumps to street level; later fixes fly to the new position,
  // keeping whatever zoom the user has set.
  const only = pins.length === 1 ? pins[0]! : null;
  const onlyLng = only?.lng ?? null;
  const onlyLat = only?.lat ?? null;
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || onlyLng == null || onlyLat == null) return;
    if (fitted.current) {
      map.flyTo({ center: [onlyLng, onlyLat], duration: 600 });
    } else {
      map.jumpTo({ center: [onlyLng, onlyLat], zoom: 16 });
      fitted.current = true;
    }
  }, [onlyLng, onlyLat, mapReady]);

  useEffect(() => {
    if (!selectedDeviceId) return;
    const p = pins.find((x) => x.deviceId === selectedDeviceId);
    const map = mapRef.current;
    if (map && p)
      map.flyTo({ center: [p.lng, p.lat], zoom: 14, duration: 600 });
  }, [selectedDeviceId, pins]);

  return (
    <div className="relative h-full w-full">
      <Map
        ref={mapRef}
        mapLib={maplibregl}
        mapStyle={MAP_STYLE_URL}
        initialViewState={{
          longitude: DEFAULT_CENTER[0],
          latitude: DEFAULT_CENTER[1],
          zoom: 7,
        }}
        style={{ width: "100%", height: "100%" }}
        onLoad={handleLoad}
        onError={onError}
      >
        <NavigationControl position="top-right" showCompass={false} />
        {pins.map((p) => (
          <Marker
            key={p.deviceId}
            longitude={p.lng}
            latitude={p.lat}
            anchor="center"
          >
            <LiveDot
              pin={p}
              selected={selectedDeviceId === p.deviceId}
              onClick={() => onSelect?.(p.deviceId)}
            />
          </Marker>
        ))}
        {detailPopup && selectedPin && (
          <Popup
            longitude={selectedPin.lng}
            latitude={selectedPin.lat}
            anchor="top"
            offset={16}
            closeOnClick={false}
            onClose={() => onSelect?.(null)}
            maxWidth="none"
          >
            <VehicleDetailCard pin={selectedPin} />
          </Popup>
        )}
      </Map>
      {failed && <MapUnavailable />}
    </div>
  );
}

export default FleetLiveMap;
