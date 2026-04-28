"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export type DamageView = "LEFT" | "RIGHT" | "FRONT" | "REAR";

export const DAMAGE_VIEWS: readonly DamageView[] = ["LEFT", "RIGHT", "FRONT", "REAR"] as const;

export type DamageMarker = {
  id: string;
  /** 0..1 coordinate inside the view image */
  x: number;
  y: number;
  severity: "MINOR" | "MODERATE" | "MAJOR";
  note?: string;
  source: "staff" | "customer";
  addedAt: string;
  view?: DamageView;
};

const SEVERITY_COLOUR: Record<DamageMarker["severity"], string> = {
  MINOR: "#F59E0B",
  MODERATE: "#F97316",
  MAJOR: "#DC2626",
};

const VIEW_LABEL: Record<DamageView, string> = {
  LEFT: "Left",
  RIGHT: "Right",
  FRONT: "Front",
  REAR: "Rear",
};

const VIEW_IMAGE: Record<DamageView, string> = {
  LEFT: "/images/damage-map/left.svg",
  RIGHT: "/images/damage-map/right.svg",
  FRONT: "/images/damage-map/front.svg",
  REAR: "/images/damage-map/rear.svg",
};

/** Normalises raw JSON markers from the DB into a safe in-memory shape. Legacy markers without a `view` fall onto LEFT. */
export function normalizeMarkers(raw: unknown): DamageMarker[] {
  const arr = Array.isArray(raw) ? raw : [];
  return arr.map((m, idx) => {
    const src = (m ?? {}) as Partial<DamageMarker> & Record<string, unknown>;
    const view = typeof src.view === "string" && (DAMAGE_VIEWS as readonly string[]).includes(src.view) ? (src.view as DamageView) : "LEFT";
    const severity = (src.severity === "MINOR" || src.severity === "MODERATE" || src.severity === "MAJOR") ? src.severity : "MINOR";
    const source = src.source === "customer" ? "customer" : "staff";
    return {
      id: typeof src.id === "string" && src.id.length > 0 ? src.id : `m_${idx}_${Math.random().toString(36).slice(2, 8)}`,
      x: typeof src.x === "number" ? src.x : 0,
      y: typeof src.y === "number" ? src.y : 0,
      severity,
      note: typeof src.note === "string" ? src.note : undefined,
      source,
      addedAt: typeof src.addedAt === "string" ? src.addedAt : "",
      view,
    };
  });
}

type SingleViewProps = {
  view: DamageView;
  baseMarkers: DamageMarker[];
  markers: DamageMarker[];
  baseOffsetForNumber: number;
  onAdd?: (marker: DamageMarker) => void;
  onRemove?: (id: string) => void;
  activeSeverity: "MINOR" | "MODERATE" | "MAJOR";
  source: "staff" | "customer";
  readOnly?: boolean;
  compact?: boolean;
};

function DamageMapView({
  view,
  baseMarkers,
  markers,
  baseOffsetForNumber,
  onAdd,
  onRemove,
  activeSeverity,
  source,
  readOnly,
  compact,
}: SingleViewProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [imgLoaded, setImgLoaded] = useState(false);

  // Cached images may never fire onLoad; check `complete` on mount.
  useEffect(() => {
    if (imgRef.current?.complete) setImgLoaded(true);
  }, []);

  const addMarker = (e: React.PointerEvent<SVGSVGElement>) => {
    if (readOnly || !onAdd || !imgLoaded) return;
    const target = e.target as Element;
    if (target.closest("[data-marker-id]")) return;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    onAdd({
      id: `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      x,
      y,
      severity: activeSeverity,
      source,
      addedAt: new Date().toISOString(),
      view,
    });
  };

  const startLongPress = (id: string) => {
    longPressTimer.current = window.setTimeout(() => {
      onRemove?.(id);
      setSelectedId(null);
    }, 550);
  };

  const cancelLongPress = () => {
    if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (readOnly || !onRemove || !selectedId) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      onRemove(selectedId);
      setSelectedId(null);
    } else if (e.key === "Escape") {
      setSelectedId(null);
    }
  };

  const markerRadius = compact ? 7 : 9;
  // Invisible circle for touch/click ergonomics — WCAG 2.5.8 target-size guideline.
  // 28px at 1000x600 viewbox ≈ 44px on a typical container width.
  const hitRadius = compact ? 20 : 28;
  const fontSize = compact ? 9 : 11;

  return (
    <div
      className="relative w-full overflow-hidden rounded-md border border-border bg-muted/40 focus-within:ring-2 focus-within:ring-ring"
      onKeyDown={handleKeyDown}
    >
      <div className="relative aspect-[5/3] w-full">
        {/* Plain <img> rather than next/image so format swaps (svg → webp) are drop-in. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imgRef}
          src={VIEW_IMAGE[view]}
          alt={`${VIEW_LABEL[view]} view`}
          className="pointer-events-none absolute inset-0 h-full w-full object-contain select-none"
          draggable={false}
          onLoad={() => setImgLoaded(true)}
        />
        <svg
          ref={svgRef}
          viewBox="0 0 1000 600"
          preserveAspectRatio="none"
          onPointerDown={addMarker}
          tabIndex={readOnly ? -1 : 0}
          className={cn(
            "absolute inset-0 block h-full w-full select-none outline-none",
            readOnly ? "cursor-default" : "cursor-crosshair",
          )}
          style={{ touchAction: "none" }}
          role="img"
          aria-label={`Damage map — ${VIEW_LABEL[view]} view`}
        >
          {baseMarkers.map((m) => (
            <g key={`base-${m.id}`} opacity={0.5}>
              <circle
                cx={m.x * 1000}
                cy={m.y * 600}
                r={markerRadius + 1}
                fill="#94a3b8"
                stroke="#475569"
                strokeWidth="1.5"
              />
            </g>
          ))}
          {markers.map((m, idx) => {
            const cx = m.x * 1000;
            const cy = m.y * 600;
            const number = baseOffsetForNumber + idx + 1;
            const isSelected = selectedId === m.id;
            return (
              <g
                key={m.id}
                data-marker-id={m.id}
                role="button"
                aria-label={`Damage marker ${number} (${m.severity.toLowerCase()}) on ${VIEW_LABEL[view]} view${isSelected ? " — selected, press Delete to remove" : ""}`}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  if (readOnly || !onRemove) return;
                  setSelectedId(m.id);
                  startLongPress(m.id);
                }}
                onPointerUp={cancelLongPress}
                onPointerLeave={cancelLongPress}
                onPointerCancel={cancelLongPress}
                style={{ cursor: readOnly ? "default" : "pointer" }}
              >
                {/* Invisible hit-target expands the tap area to WCAG-friendly size. */}
                {!readOnly && (
                  <circle cx={cx} cy={cy} r={hitRadius} fill="transparent" />
                )}
                <circle
                  cx={cx}
                  cy={cy}
                  r={isSelected ? markerRadius + 2 : markerRadius}
                  fill={SEVERITY_COLOUR[m.severity]}
                  stroke={isSelected ? "#ffffff" : "#1a1a1a"}
                  strokeWidth={isSelected ? 2.5 : 1.5}
                />
                {isSelected && (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={markerRadius + 6}
                    fill="none"
                    stroke="#1a1a1a"
                    strokeWidth="1.5"
                    strokeDasharray="3 2"
                  />
                )}
                <text
                  x={cx}
                  y={cy + fontSize / 3}
                  fontSize={fontSize}
                  fontWeight="700"
                  fill="#fff"
                  textAnchor="middle"
                  pointerEvents="none"
                >
                  {number}
                </text>
              </g>
            );
          })}
        </svg>
        {selectedId && !readOnly && onRemove ? (
          <div className="absolute bottom-2 right-2 flex items-center gap-2 rounded-md bg-background/90 px-2 py-1 text-xs shadow-sm">
            <span className="text-muted-foreground">Marker selected</span>
            <button
              type="button"
              onClick={() => {
                onRemove(selectedId);
                setSelectedId(null);
              }}
              className="rounded-sm bg-destructive px-2 py-0.5 font-medium text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export type DamageMapProps = {
  /** Pre-existing markers shown in grey. Used for the post-hire diff view. */
  baseMarkers?: DamageMarker[];
  /** Editable markers — the ones this canvas is responsible for. */
  markers: DamageMarker[];
  onChange: (markers: DamageMarker[]) => void;
  activeSeverity?: "MINOR" | "MODERATE" | "MAJOR";
  source: "staff" | "customer";
  /** If true, taps are ignored and the user can only view. */
  readOnly?: boolean;
  className?: string;
  initialView?: DamageView;
  /** `tabs` — one view at a time (default, for editing). `grid` — all four views side-by-side (read-only diff). */
  layout?: "tabs" | "grid";
};

/**
 * Tap-to-add damage markers on a scooter silhouette. Four views (left, right,
 * front, rear) — tabs for editing, 2×2 grid for read-only diffs. Long-press a
 * marker to delete. Supports pen and touch via pointer events. `baseMarkers`
 * are rendered read-only underneath — used for post-hire diff against pre-hire.
 */
export function DamageMapCanvas({
  baseMarkers,
  markers,
  onChange,
  activeSeverity = "MINOR",
  source,
  readOnly,
  className,
  initialView = "LEFT",
  layout = "tabs",
}: DamageMapProps) {
  const safeMarkers = useMemo(
    () => markers.map((m) => ({ ...m, view: m.view ?? "LEFT" as DamageView })),
    [markers],
  );
  const safeBase = useMemo(
    () => (baseMarkers ?? []).map((m) => ({ ...m, view: m.view ?? "LEFT" as DamageView })),
    [baseMarkers],
  );

  const byView = useMemo(() => {
    const out: Record<DamageView, { markers: DamageMarker[]; base: DamageMarker[] }> = {
      LEFT: { markers: [], base: [] },
      RIGHT: { markers: [], base: [] },
      FRONT: { markers: [], base: [] },
      REAR: { markers: [], base: [] },
    };
    for (const m of safeMarkers) out[m.view ?? "LEFT"].markers.push(m);
    for (const m of safeBase) out[m.view ?? "LEFT"].base.push(m);
    return out;
  }, [safeMarkers, safeBase]);

  const handleAdd = (marker: DamageMarker) => {
    onChange([...safeMarkers, marker]);
  };
  const handleRemove = (id: string) => {
    onChange(safeMarkers.filter((m) => m.id !== id));
  };

  const [view, setView] = useState<DamageView>(initialView);

  if (layout === "grid") {
    return (
      <div className={cn("grid grid-cols-1 gap-3 md:grid-cols-2", className)}>
        {DAMAGE_VIEWS.map((v) => {
          const bucket = byView[v];
          return (
            <div key={v} className="space-y-1">
              <div className="flex items-center justify-between px-1">
                <span className="eyebrow">{VIEW_LABEL[v]}</span>
                <span className="caption text-muted-foreground">
                  {bucket.markers.length > 0 ? `${bucket.markers.length} new` : "no new damage"}
                </span>
              </div>
              <DamageMapView
                view={v}
                baseMarkers={bucket.base}
                markers={bucket.markers}
                baseOffsetForNumber={0}
                activeSeverity={activeSeverity}
                source={source}
                readOnly
                compact
              />
            </div>
          );
        })}
      </div>
    );
  }

  const bucket = byView[view];
  const baseOffset = (() => {
    let offset = 0;
    for (const v of DAMAGE_VIEWS) {
      if (v === view) return offset;
      offset += byView[v].markers.length;
    }
    return offset;
  })();

  return (
    <div className={cn("space-y-3", className)}>
      <Tabs value={view} onValueChange={(v) => setView(v as DamageView)}>
        <TabsList>
          {DAMAGE_VIEWS.map((v) => {
            const n = byView[v].markers.length;
            const b = byView[v].base.length;
            return (
              <TabsTrigger key={v} value={v}>
                <span>{VIEW_LABEL[v]}</span>
                {n > 0 ? (
                  <span className="ml-2 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold leading-none text-primary-foreground">
                    {n}
                  </span>
                ) : null}
                {b > 0 && n === 0 ? (
                  <span className="ml-2 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-muted px-1.5 text-[11px] font-semibold leading-none text-muted-foreground">
                    {b}
                  </span>
                ) : null}
              </TabsTrigger>
            );
          })}
        </TabsList>
        {DAMAGE_VIEWS.map((v) => (
          <TabsContent key={v} value={v}>
            {v === view ? (
              <DamageMapView
                view={v}
                baseMarkers={bucket.base}
                markers={bucket.markers}
                baseOffsetForNumber={baseOffset}
                onAdd={handleAdd}
                onRemove={handleRemove}
                activeSeverity={activeSeverity}
                source={source}
                readOnly={readOnly}
              />
            ) : null}
          </TabsContent>
        ))}
      </Tabs>
      {!readOnly ? (
        <p className="caption text-muted-foreground">Tap to add · long-press to remove</p>
      ) : null}
    </div>
  );
}
