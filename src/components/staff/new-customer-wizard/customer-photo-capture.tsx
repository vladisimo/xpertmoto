"use client";

import * as React from "react";
import { Camera, Loader2, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type UploadResult = { url: string; key: string };

async function uploadPhoto(file: Blob, filename: string): Promise<UploadResult> {
  const fd = new FormData();
  fd.append("file", file, filename);
  const res = await fetch("/api/upload/customer-document", {
    method: "POST",
    body: fd,
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `Upload failed (${res.status})`);
  }
  return (await res.json()) as UploadResult;
}

export type CustomerPhotoCaptureProps = {
  value: string;
  onChange: (url: string) => void;
};

/**
 * Tablet-friendly customer photo capture. Uses getUserMedia when available
 * for a live viewfinder with a circular crop guide and a capture button.
 * Falls back to a plain `<input type="file" capture="user">` (OS camera)
 * on devices/browsers without getUserMedia permission.
 */
export function CustomerPhotoCapture({ value, onChange }: CustomerPhotoCaptureProps) {
  const [supported, setSupported] = React.useState<boolean | null>(null);
  const [streaming, setStreaming] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const fallbackInputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    const hasMedia =
      typeof navigator !== "undefined" &&
      !!navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === "function";
    // Can't run this during render (SSR has no `navigator`). Post-mount
    // setState is the idiomatic detection path for client-only APIs.
    setSupported(hasMedia);
  }, []);

  const stopStream = React.useCallback(() => {
    const stream = streamRef.current;
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setStreaming(false);
  }, []);

  React.useEffect(() => stopStream, [stopStream]);

  async function startStream() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setStreaming(true);
    } catch (e) {
      setError(
        e instanceof Error
          ? `Camera error: ${e.message}`
          : "Camera unavailable — use the device camera option.",
      );
    }
  }

  async function capture() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const w = video.videoWidth || 800;
    const h = video.videoHeight || 600;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // Mirror the drawn frame to match what the customer saw on the preview.
    ctx.save();
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, w, h);
    ctx.restore();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.82),
    );
    if (!blob) {
      setError("Failed to capture frame — try again.");
      return;
    }
    setUploading(true);
    try {
      const res = await uploadPhoto(blob, `customer-photo-${Date.now()}.jpg`);
      onChange(res.url);
      stopStream();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleFallbackFile(file: File) {
    setError(null);
    setUploading(true);
    try {
      const res = await uploadPhoto(file, file.name || `customer-photo-${Date.now()}.jpg`);
      onChange(res.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  if (value) {
    return (
      <div className="space-y-2">
        <div className="relative inline-block overflow-hidden rounded-md border bg-muted/30">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value} alt="Customer photo" className="h-48 w-auto object-cover" />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onChange("")}
            className="absolute right-1 top-1 h-7 w-7 bg-background/80 hover:bg-background"
            aria-label="Remove photo"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => onChange("")}
          disabled={uploading}
        >
          <RotateCcw className="h-4 w-4" />
          Retake
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {supported && streaming && (
        <div className="space-y-2">
          <div className="relative inline-block overflow-hidden rounded-md border bg-black">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={cn("h-64 w-auto", "scale-x-[-1]")}
            />
            <div
              className="pointer-events-none absolute inset-0 flex items-center justify-center"
              aria-hidden
            >
              <div className="h-48 w-48 rounded-full border-2 border-white/60 shadow-[0_0_0_9999px_rgba(0,0,0,0.25)]" />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={capture} disabled={uploading}>
              {uploading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Uploading…
                </>
              ) : (
                <>
                  <Camera className="h-4 w-4" />
                  Capture
                </>
              )}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={stopStream}
              disabled={uploading}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {(!streaming || !supported) && (
        <div className="flex flex-wrap gap-2">
          {supported && (
            <Button type="button" onClick={startStream}>
              <Camera className="h-4 w-4" />
              Open camera
            </Button>
          )}
          <Button
            type="button"
            variant="secondary"
            onClick={() => fallbackInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Uploading…
              </>
            ) : (
              <>
                <Camera className="h-4 w-4" />
                Use device camera
              </>
            )}
          </Button>
          <input
            ref={fallbackInputRef}
            type="file"
            accept="image/*"
            capture="user"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFallbackFile(f);
              e.target.value = "";
            }}
          />
        </div>
      )}

      <canvas ref={canvasRef} className="hidden" />
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
