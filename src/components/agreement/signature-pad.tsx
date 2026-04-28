"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type SignaturePadProps = {
  /** Aspect ratio — width/height. Full signatures use 3, initials use 1. */
  aspectRatio?: number;
  /** Placeholder label shown when the pad is empty. */
  label?: string;
  /** Called with a PNG data-URL when the user taps Accept. */
  onAccept: (dataUrl: string) => void;
  /** Disable the pad (e.g. after apply). */
  disabled?: boolean;
  /** If set, renders a preview of this existing signature instead of a fresh pad. */
  existingUrl?: string | null;
  /** Override the Accept button label. */
  acceptLabel?: string;
  className?: string;
};

type Point = { x: number; y: number; p: number };

/**
 * Canvas-backed signature pad optimised for tablet with a stylus. Handles
 * Pointer Events (pen pressure, palm rejection via pointerType) and falls
 * back cleanly to touch and mouse. Renders a PNG data-URL on Accept.
 */
export function SignaturePad({
  aspectRatio = 3,
  label = "Sign here",
  onAccept,
  disabled,
  existingUrl,
  acceptLabel = "Accept",
  className,
}: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const strokesRef = useRef<Point[][]>([]);
  const currentRef = useRef<Point[] | null>(null);
  const [hasInk, setHasInk] = useState(false);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#0a0a0a";
    for (const stroke of strokesRef.current) {
      if (stroke.length < 2) continue;
      for (let i = 1; i < stroke.length; i++) {
        const a = stroke[i - 1]!;
        const b = stroke[i]!;
        ctx.lineWidth = 1.5 + b.p * 2.0;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
  }, []);

  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const rect = wrap.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    redraw();
  }, [redraw]);

  useEffect(() => {
    if (existingUrl) return;
    resize();
    const handler = () => resize();
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, [resize, existingUrl]);

  const pointFromEvent = (e: PointerEvent): Point => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const pressure = e.pointerType === "pen" ? Math.max(e.pressure || 0.5, 0.1) : 0.5;
    return { x: e.clientX - rect.left, y: e.clientY - rect.top, p: pressure };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled || existingUrl) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    canvas?.setPointerCapture(e.pointerId);
    const stroke: Point[] = [pointFromEvent(e.nativeEvent)];
    currentRef.current = stroke;
    strokesRef.current.push(stroke);
    setHasInk(true);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!currentRef.current) return;
    e.preventDefault();
    currentRef.current.push(pointFromEvent(e.nativeEvent));
    redraw();
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    canvas?.releasePointerCapture?.(e.pointerId);
    currentRef.current = null;
  };

  const clear = () => {
    strokesRef.current = [];
    currentRef.current = null;
    setHasInk(false);
    redraw();
  };

  const accept = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL("image/png");
    onAccept(dataUrl);
  };

  if (existingUrl) {
    return (
      <div className={cn("space-y-2", className)}>
        <div
          ref={wrapRef}
          className="relative w-full overflow-hidden rounded-md border border-input bg-background"
          style={{ aspectRatio: String(aspectRatio) }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={existingUrl}
            alt={label}
            className="h-full w-full object-contain p-2"
          />
        </div>
        <p className="text-xs text-muted-foreground">{label} — on file</p>
      </div>
    );
  }

  return (
    <div className={cn("space-y-2", className)}>
      <div
        ref={wrapRef}
        className="relative w-full overflow-hidden rounded-md border-2 border-dashed border-input bg-background touch-none select-none"
        style={{ aspectRatio: String(aspectRatio) }}
      >
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="absolute inset-0 h-full w-full cursor-crosshair"
          style={{ touchAction: "none" }}
        />
        {!hasInk && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            {label}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={clear} disabled={!hasInk || disabled}>
          Clear
        </Button>
        <Button type="button" size="sm" onClick={accept} disabled={!hasInk || disabled}>
          {acceptLabel}
        </Button>
      </div>
    </div>
  );
}
