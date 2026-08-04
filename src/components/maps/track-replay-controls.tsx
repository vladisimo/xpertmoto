"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Play, Pause, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export type ReplayPoint = {
  lat: number;
  lng: number;
  headingDeg: number | null;
  speedKph: number | null;
  timestamp: string | Date;
};

const BASE_DURATION_MS = 20_000; // full route replays in ~20s at 1×
const SPEEDS = [0.5, 1, 2, 4] as const;

function tsMs(t: string | Date): number {
  return typeof t === "string" ? new Date(t).getTime() : t.getTime();
}

/**
 * Play/pause/scrub controls that drive a moving marker along an already-loaded
 * track (no new query — operates on the client-side points). Progress is a 0..1
 * fraction advanced by requestAnimationFrame, mapped to the nearest fix, so an
 * irregular breadcrumb (long parks between fixes) replays at a steady visual
 * pace rather than stalling on time gaps.
 */
export function TrackReplayControls({
  points,
  onFrame,
}: {
  points: ReplayPoint[];
  onFrame: (p: ReplayPoint | null) => void;
}) {
  const [progress, setProgress] = useState(0); // 0..1
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);

  const n = points.length;
  const index = n === 0 ? 0 : Math.min(n - 1, Math.round(progress * (n - 1)));
  const current = n === 0 ? null : (points[index] ?? null);

  // Emit the current frame to the parent (drives the map marker).
  useEffect(() => {
    onFrame(current);
  }, [current, onFrame]);

  // Reset when the underlying track changes (trip switch / window edit).
  useEffect(() => {
    setPlaying(false);
    setProgress(0);
    lastTsRef.current = null;
  }, [points]);

  // Clear the marker when unmounted (replay toggled off).
  useEffect(() => () => onFrame(null), [onFrame]);

  useEffect(() => {
    if (!playing || n < 2) return;
    const step = (t: number) => {
      if (lastTsRef.current == null) lastTsRef.current = t;
      const dt = t - lastTsRef.current;
      lastTsRef.current = t;
      setProgress((prev) => {
        const next = prev + dt / (BASE_DURATION_MS / speed);
        if (next >= 1) {
          setPlaying(false);
          return 1;
        }
        return next;
      });
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      lastTsRef.current = null;
    };
  }, [playing, speed, n]);

  const toggle = useCallback(() => {
    if (n < 2) return;
    setPlaying((p) => {
      // Replaying from the end restarts.
      if (!p && progress >= 1) setProgress(0);
      return !p;
    });
  }, [n, progress]);

  const restart = useCallback(() => {
    setProgress(0);
    setPlaying(false);
    lastTsRef.current = null;
  }, []);

  if (n < 2) {
    return (
      <div className="text-xs text-muted-foreground">
        Not enough fixes in this window to replay.
      </div>
    );
  }

  const when = current ? new Date(tsMs(current.timestamp)) : null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" onClick={toggle} className="gap-1">
        {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        {playing ? "Pause" : "Play"}
      </Button>
      <Button size="sm" variant="ghost" onClick={restart} title="Restart" className="px-2">
        <RotateCcw className="h-3.5 w-3.5" />
      </Button>
      <input
        type="range"
        min={0}
        max={n - 1}
        value={index}
        onChange={(e) => {
          setPlaying(false);
          setProgress(n > 1 ? Number(e.target.value) / (n - 1) : 0);
        }}
        className="h-1.5 min-w-[8rem] flex-1 cursor-pointer accent-emerald-600"
        aria-label="Playback position"
      />
      <div className="flex items-center gap-1 text-xs">
        {SPEEDS.map((s) => (
          <button
            key={s}
            onClick={() => setSpeed(s)}
            className={`rounded px-1.5 py-0.5 ${
              speed === s ? "bg-emerald-600 text-white" : "text-muted-foreground hover:bg-muted"
            }`}
          >
            {s}×
          </button>
        ))}
      </div>
      <span className="min-w-[7rem] text-right font-mono text-xs tabular-nums text-muted-foreground">
        {when ? when.toLocaleTimeString("en-AU") : "—"}
        {current?.speedKph != null ? ` · ${Math.round(current.speedKph)}km/h` : ""}
      </span>
    </div>
  );
}

export default TrackReplayControls;
