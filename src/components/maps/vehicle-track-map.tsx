"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Map,
  Marker,
  Popup,
  NavigationControl,
  Source,
  Layer,
  type MapRef,
  type MapLayerMouseEvent,
} from "react-map-gl/maplibre";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MAP_STYLE_URL } from "@/lib/maps/style";
import {
  useMapStyleStatus,
  MapUnavailable,
} from "@/components/maps/map-style-status";

export type TrackMapPoint = { lat: number; lng: number };
export type TrackSegment = {
  id: string;
  color: string;
  points: TrackMapPoint[];
};

/** A single GPS fix rendered as a clickable dot on the track. Display fields
 *  ride along so the click handler can show a detail popup; they're serialised
 *  into a single GeoJSON `detail` property (primitives + nulls survive the
 *  round-trip through queryRenderedFeatures only when JSON-encoded). */
export type FixMarker = {
  lat: number;
  lng: number;
  timestamp: string | Date;
  speedKph: number | null;
  headingDeg: number | null;
  ignitionOn: boolean | null;
  batteryPct: number | null;
  bookingReference: string | null;
};

type FixDetail = {
  lng: number;
  lat: number;
  ts: string;
  speedKph: number | null;
  headingDeg: number | null;
  ignitionOn: boolean | null;
  batteryPct: number | null;
  bookingReference: string | null;
};

const DEFAULT_CENTER: [number, number] = [153.2, -27.5];
const ROUTE_GREEN = "#1B6B4A";
const FIXES_LAYER_ID = "vehicle-fixes-layer";

function compass(deg: number): string {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round(deg / 45) % 8] ?? "N";
}

/** Draws one or more coloured breadcrumb segments (booking-coloured paths, or a
 *  selected trip) with overall start/end markers, fitting the viewport to all
 *  points once. Optionally overlays every GPS fix as a clickable dot that opens
 *  a detail popup. Generalises TripMap, which stays single-segment for the
 *  booking panel. Empty input shows the default region so the panel never
 *  collapses. */
export function VehicleTrackMap({
  segments,
  fixes,
}: {
  segments: TrackSegment[];
  /** When provided, render each fix as a clickable dot with a detail popup. */
  fixes?: FixMarker[];
}) {
  const mapRef = useRef<MapRef | null>(null);
  const fitted = useRef(false);
  const [cursor, setCursor] = useState("");
  const [selectedFix, setSelectedFix] = useState<FixDetail | null>(null);
  const { failed, onLoad, onError } = useMapStyleStatus();

  const drawn = useMemo(
    () => segments.filter((s) => s.points.length >= 2),
    [segments],
  );
  const allPoints = useMemo(
    () => segments.flatMap((s) => s.points),
    [segments],
  );

  const fixCollection = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: (fixes ?? []).map((fx) => ({
        type: "Feature",
        properties: {
          detail: JSON.stringify({
            ts:
              typeof fx.timestamp === "string"
                ? fx.timestamp
                : fx.timestamp.toISOString(),
            speedKph: fx.speedKph,
            headingDeg: fx.headingDeg,
            ignitionOn: fx.ignitionOn,
            batteryPct: fx.batteryPct,
            bookingReference: fx.bookingReference,
          }),
        },
        geometry: { type: "Point", coordinates: [fx.lng, fx.lat] },
      })),
    }),
    [fixes],
  );

  // Fit to all points once data arrives; re-fit when the segment set changes
  // (e.g. switching trips or isolating a booking).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || allPoints.length === 0) return;
    if (fitted.current) return;
    if (allPoints.length === 1) {
      map.flyTo({
        center: [allPoints[0]!.lng, allPoints[0]!.lat],
        zoom: 14,
        duration: 0,
      });
      fitted.current = true;
      return;
    }
    const bounds = new maplibregl.LngLatBounds();
    for (const p of allPoints) bounds.extend([p.lng, p.lat]);
    map.fitBounds(bounds, { padding: 48, maxZoom: 15, duration: 0 });
    fitted.current = true;
  }, [allPoints]);

  useEffect(() => {
    fitted.current = false;
  }, [segments]);

  // Drop a stale fix popup when the underlying fixes change (filter/window edit).
  useEffect(() => {
    setSelectedFix(null);
  }, [fixes]);

  const handleClick = (e: MapLayerMouseEvent) => {
    const feature = e.features?.[0];
    if (!feature || feature.geometry.type !== "Point") {
      setSelectedFix(null);
      return;
    }
    try {
      const detail = JSON.parse(String(feature.properties?.detail ?? "{}"));
      const [lng, lat] = feature.geometry.coordinates as [number, number];
      setSelectedFix({ lng, lat, ...detail });
    } catch {
      setSelectedFix(null);
    }
  };

  const interactiveLayerIds =
    fixes && fixes.length > 0 ? [FIXES_LAYER_ID] : undefined;
  const start = allPoints[0];
  const end = allPoints[allPoints.length - 1];

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
        cursor={cursor}
        interactiveLayerIds={interactiveLayerIds}
        onClick={interactiveLayerIds ? handleClick : undefined}
        onMouseEnter={
          interactiveLayerIds ? () => setCursor("pointer") : undefined
        }
        onMouseLeave={interactiveLayerIds ? () => setCursor("") : undefined}
        onLoad={onLoad}
        onError={onError}
      >
        <NavigationControl position="top-right" showCompass={false} />
        {drawn.map((seg) => (
          <Source
            key={seg.id}
            id={`track-${seg.id}`}
            type="geojson"
            data={{
              type: "Feature",
              properties: {},
              geometry: {
                type: "LineString",
                coordinates: seg.points.map(
                  (p) => [p.lng, p.lat] as [number, number],
                ),
              },
            }}
          >
            <Layer
              id={`track-${seg.id}-layer`}
              type="line"
              layout={{ "line-join": "round", "line-cap": "round" }}
              paint={{
                "line-color": seg.color,
                "line-width": 4,
                "line-opacity": 0.85,
              }}
            />
          </Source>
        ))}
        {interactiveLayerIds && (
          <Source id="vehicle-fixes" type="geojson" data={fixCollection}>
            <Layer
              id={FIXES_LAYER_ID}
              type="circle"
              paint={{
                "circle-radius": 4,
                "circle-color": ROUTE_GREEN,
                "circle-opacity": 0.85,
                "circle-stroke-width": 1.5,
                "circle-stroke-color": "#ffffff",
              }}
            />
          </Source>
        )}
        {start && (
          <Marker longitude={start.lng} latitude={start.lat} anchor="center">
            <EndpointDot label="Start" color={ROUTE_GREEN} />
          </Marker>
        )}
        {end && allPoints.length > 1 && (
          <Marker longitude={end.lng} latitude={end.lat} anchor="center">
            <EndpointDot label="End" color="#b91c1c" />
          </Marker>
        )}
        {selectedFix && (
          <Popup
            longitude={selectedFix.lng}
            latitude={selectedFix.lat}
            anchor="bottom"
            offset={12}
            closeOnClick={false}
            onClose={() => setSelectedFix(null)}
            maxWidth="none"
          >
            <FixDetailCard fix={selectedFix} />
          </Popup>
        )}
      </Map>
      {failed && <MapUnavailable />}
    </div>
  );
}

function FixDetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-900">{value}</span>
    </div>
  );
}

function FixDetailCard({ fix }: { fix: FixDetail }) {
  const when = new Date(fix.ts);
  return (
    <div className="min-w-[12rem] text-xs">
      <div className="border-b border-gray-100 pb-1.5 text-sm font-semibold text-gray-900">
        GPS fix
      </div>
      <div className="space-y-1 py-2">
        <FixDetailRow label="Time" value={when.toLocaleString("en-AU")} />
        <FixDetailRow
          label="Speed"
          value={
            fix.speedKph != null ? `${Math.round(fix.speedKph)} km/h` : "—"
          }
        />
        <FixDetailRow
          label="Heading"
          value={
            fix.headingDeg != null
              ? `${compass(fix.headingDeg)} (${Math.round(fix.headingDeg)}°)`
              : "—"
          }
        />
        <FixDetailRow
          label="Ignition"
          value={fix.ignitionOn == null ? "—" : fix.ignitionOn ? "On" : "Off"}
        />
        <FixDetailRow
          label="Battery"
          value={
            fix.batteryPct != null ? `${Math.round(fix.batteryPct)}%` : "—"
          }
        />
        <FixDetailRow label="Booking" value={fix.bookingReference ?? "—"} />
      </div>
    </div>
  );
}

function EndpointDot({ label, color }: { label: string; color: string }) {
  return (
    <div className="relative" title={label}>
      <div
        style={{
          width: 14,
          height: 14,
          backgroundColor: color,
          border: "2px solid white",
          borderRadius: "9999px",
          boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
        }}
      />
    </div>
  );
}

export default VehicleTrackMap;
