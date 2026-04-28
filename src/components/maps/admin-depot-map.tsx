"use client";

import { useEffect, useMemo, useRef } from "react";
import { Map, Marker, NavigationControl, type MapRef } from "react-map-gl/maplibre";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

export type DepotPin = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  isActive: boolean;
  suburb: string;
  state: string;
  vehicleCount: number;
};

const BRAND_GREEN = "#1B6B4A";
const INACTIVE_ORANGE = "#E97319";
const DEFAULT_STYLE_URL =
  process.env.NEXT_PUBLIC_MAP_STYLE_URL ?? "https://tiles.openfreemap.org/styles/liberty";

const DEFAULT_CENTER: [number, number] = [153.2, -27.5];
const DEFAULT_ZOOM = 7;

function computeBubbleDirections(
  depots: DepotPin[],
): Record<string, "top" | "bottom" | "left" | "right"> {
  const directions: Record<string, "top" | "bottom" | "left" | "right"> = {};
  if (depots.length <= 1) {
    for (const d of depots) directions[d.id] = "right";
    return directions;
  }
  for (const depot of depots) {
    const others = depots.filter((d) => d.id !== depot.id);
    const centLat = others.reduce((s, d) => s + d.lat, 0) / others.length;
    const centLng = others.reduce((s, d) => s + d.lng, 0) / others.length;
    const dLat = depot.lat - centLat;
    const dLng = depot.lng - centLng;
    if (Math.abs(dLat) > Math.abs(dLng)) {
      directions[depot.id] = dLat > 0 ? "top" : "bottom";
    } else {
      directions[depot.id] = dLng > 0 ? "right" : "left";
    }
  }
  return directions;
}

const LABEL_POSITION: Record<
  "top" | "bottom" | "left" | "right",
  { left: string; top: string; transform: string }
> = {
  top: { left: "50%", top: "0", transform: "translate(-50%, calc(-100% - 8px))" },
  bottom: { left: "50%", top: "100%", transform: "translate(-50%, 8px)" },
  left: { left: "0", top: "50%", transform: "translate(calc(-100% - 8px), -50%)" },
  right: { left: "100%", top: "50%", transform: "translate(8px, -50%)" },
};

function DepotPinMarker({
  depot,
  isSelected,
  direction,
  onClick,
}: {
  depot: DepotPin;
  isSelected: boolean;
  direction: "top" | "bottom" | "left" | "right";
  onClick: () => void;
}) {
  const size = isSelected ? 38 : 30;
  const activeColor = isSelected ? BRAND_GREEN : "#2d8a62";
  const inactiveColor = isSelected ? INACTIVE_ORANGE : "#d97706";
  const color = depot.isActive ? activeColor : inactiveColor;
  const statusColor = depot.isActive ? BRAND_GREEN : INACTIVE_ORANGE;
  const labelStyle = LABEL_POSITION[direction];

  return (
    <div
      className="relative cursor-pointer"
      style={{ width: size, height: size }}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill={color}
        stroke="white"
        strokeWidth="1.5"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.3))",
          transform: "translateY(-50%)",
        }}
      >
        <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z" />
      </svg>
      <div
        className="absolute rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-lg"
        style={{ ...labelStyle, minWidth: 140, pointerEvents: "none" }}
      >
        <div className="mb-0.5 flex items-center gap-2">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: statusColor }}
          />
          <span className="truncate text-sm font-semibold text-gray-900">{depot.name}</span>
        </div>
        <div className="ml-4 text-xs text-gray-500">
          {depot.suburb}, {depot.state}
        </div>
        <div className="ml-4 text-xs text-gray-500">
          {depot.vehicleCount} vehicle{depot.vehicleCount !== 1 ? "s" : ""}
        </div>
      </div>
    </div>
  );
}

function AdminDepotMap({
  depots,
  selectedDepotId,
  onSelectDepot,
}: {
  depots: DepotPin[];
  selectedDepotId: string | null;
  onSelectDepot: (id: string) => void;
}) {
  const mapRef = useRef<MapRef | null>(null);
  const bubbleDirections = useMemo(() => computeBubbleDirections(depots), [depots]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || depots.length === 0) return;
    const bounds = new maplibregl.LngLatBounds();
    for (const d of depots) bounds.extend([d.lng, d.lat]);
    map.fitBounds(bounds, { padding: 240, maxZoom: 9, duration: 0 });
  }, [depots]);

  useEffect(() => {
    if (!selectedDepotId) return;
    const depot = depots.find((d) => d.id === selectedDepotId);
    const map = mapRef.current;
    if (!map || !depot) return;
    map.flyTo({ center: [depot.lng, depot.lat], zoom: 11, duration: 800 });
  }, [selectedDepotId, depots]);

  return (
    <Map
      ref={mapRef}
      mapLib={maplibregl}
      mapStyle={DEFAULT_STYLE_URL}
      initialViewState={{
        longitude: DEFAULT_CENTER[0],
        latitude: DEFAULT_CENTER[1],
        zoom: DEFAULT_ZOOM,
      }}
      style={{ width: "100%", height: "100%" }}
    >
      <NavigationControl position="top-right" showCompass={false} />
      {depots.map((depot) => (
        <Marker
          key={depot.id}
          longitude={depot.lng}
          latitude={depot.lat}
          anchor="bottom"
        >
          <DepotPinMarker
            depot={depot}
            isSelected={selectedDepotId === depot.id}
            direction={bubbleDirections[depot.id] ?? "right"}
            onClick={() => onSelectDepot(depot.id)}
          />
        </Marker>
      ))}
    </Map>
  );
}

export default AdminDepotMap;
