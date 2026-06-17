"use client";

import { useCallback, useRef, useState } from "react";
import type { MapEvent } from "react-map-gl/maplibre";

/** Tracks whether the MapLibre basemap style actually loaded.
 *
 *  A style-document failure (provider down or rate-limiting — the OpenFreeMap
 *  `AJAXError ... (0)` case) fires the map `error` event *before* `load` ever
 *  fires, leaving a blank canvas plus an uncaught error in the console. We
 *  surface a controlled fallback for that case instead. Transient tile errors
 *  *after* the style has loaded are cosmetic — they self-heal on the next
 *  pan/zoom — so we ignore them.
 *
 *  Wire the returned handlers into <Map> and render <MapUnavailable /> when
 *  `failed` is true:
 *
 *    const { failed, onLoad, onError } = useMapStyleStatus();
 *    return (
 *      <div className="relative h-full w-full">
 *        <Map onLoad={onLoad} onError={onError} ...>...</Map>
 *        {failed && <MapUnavailable />}
 *      </div>
 *    );
 */
export function useMapStyleStatus() {
  const loaded = useRef(false);
  const imageFallback = useRef(false);
  const [failed, setFailed] = useState(false);

  const onLoad = useCallback((e: MapEvent) => {
    loaded.current = true;
    setFailed(false);

    // Hosted basemap styles (MapTiler, OpenFreeMap) ship symbol layers whose
    // `icon-image` resolves to a blank `" "` sprite name on some features. The
    // renderer can't find it, logs `Image "..." could not be loaded`, and
    // re-requests it every frame. Satisfy any missing-image request once with a
    // transparent 1×1 pixel so the warning stops and nothing extra is drawn.
    // `styleimagemissing` is a map-level event that survives style reloads, so
    // attach it a single time per map instance.
    if (imageFallback.current) return;
    imageFallback.current = true;
    const map = e.target;
    map.on("styleimagemissing", (ev) => {
      if (!ev.id || map.hasImage(ev.id)) return;
      map.addImage(ev.id, { width: 1, height: 1, data: new Uint8Array(4) });
    });
  }, []);

  const onError = useCallback(() => {
    if (!loaded.current) setFailed(true);
  }, []);

  return { failed, onLoad, onError };
}

/** Overlay shown when the basemap style can't be fetched. Absolutely
 *  positioned, so the parent must be `relative`. */
export function MapUnavailable() {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 bg-muted/95 p-4 text-center">
      <p className="text-sm font-medium text-foreground">Map unavailable</p>
      <p className="max-w-xs text-xs text-muted-foreground">
        The basemap tiles couldn’t be loaded. Check the connection or try again
        shortly.
      </p>
    </div>
  );
}
