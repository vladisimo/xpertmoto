"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  Map,
  Marker,
  NavigationControl,
  Source,
  Layer,
  type MapRef,
} from "react-map-gl/maplibre";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MAP_STYLE_URL } from "@/lib/maps/style";
import {
  useMapStyleStatus,
  MapUnavailable,
} from "@/components/maps/map-style-status";

export type TripMapPoint = { lat: number; lng: number };

const DEFAULT_CENTER: [number, number] = [153.2, -27.5];
const ROUTE_GREEN = "#1B6B4A";

/** Renders a rental's GPS breadcrumb as a polyline with start/end markers and
 *  fits the viewport to the whole track once. Empty `points` shows the default
 *  region so the panel never collapses. */
export function TripMap({ points }: { points: TripMapPoint[] }) {
  const mapRef = useRef<MapRef | null>(null);
  const fitted = useRef(false);
  const { failed, onLoad, onError } = useMapStyleStatus();

  const lineData = useMemo(
    () => ({
      type: "Feature" as const,
      properties: {},
      geometry: {
        type: "LineString" as const,
        coordinates: points.map((p) => [p.lng, p.lat] as [number, number]),
      },
    }),
    [points],
  );

  // Fit to the full track once data arrives; re-fit if the point set changes
  // (e.g. swapping the stored breadcrumb for the authoritative GPS51 track).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || points.length === 0) return;
    if (fitted.current) return;
    if (points.length === 1) {
      map.flyTo({
        center: [points[0]!.lng, points[0]!.lat],
        zoom: 14,
        duration: 0,
      });
      fitted.current = true;
      return;
    }
    const bounds = new maplibregl.LngLatBounds();
    for (const p of points) bounds.extend([p.lng, p.lat]);
    map.fitBounds(bounds, { padding: 48, maxZoom: 15, duration: 0 });
    fitted.current = true;
  }, [points]);

  // Allow a re-fit when the track is replaced wholesale.
  useEffect(() => {
    fitted.current = false;
  }, [lineData]);

  const start = points[0];
  const end = points[points.length - 1];

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
        onLoad={onLoad}
        onError={onError}
      >
        <NavigationControl position="top-right" showCompass={false} />
        {points.length >= 2 && (
          <Source id="trip-line" type="geojson" data={lineData}>
            <Layer
              id="trip-line-layer"
              type="line"
              layout={{ "line-join": "round", "line-cap": "round" }}
              paint={{
                "line-color": ROUTE_GREEN,
                "line-width": 4,
                "line-opacity": 0.85,
              }}
            />
          </Source>
        )}
        {start && (
          <Marker longitude={start.lng} latitude={start.lat} anchor="center">
            <EndpointDot label="Start" color={ROUTE_GREEN} />
          </Marker>
        )}
        {end && points.length > 1 && (
          <Marker longitude={end.lng} latitude={end.lat} anchor="center">
            <EndpointDot label="End" color="#b91c1c" />
          </Marker>
        )}
      </Map>
      {failed && <MapUnavailable />}
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

export default TripMap;
