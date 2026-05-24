"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";

export interface HeroVideoBackgroundProps {
  /** WebM (VP9/AV1) source — preferred where supported. Optional. */
  webmSrc?: string;
  /** MP4 (H.264) source — universal fallback (Safari/iOS). Required. */
  mp4Src: string;
  /** Still frame shown as the LCP element and while the video buffers. */
  posterSrc: string;
  posterAlt?: string;
  className?: string;
}

/**
 * Full-bleed autoplaying background video for the hero. Designed to never hurt
 * Core Web Vitals or accessibility:
 *  - the poster <Image> is the LCP element and paints immediately;
 *  - the <video> is mounted only after the browser is idle, so it doesn't
 *    compete with the poster for the initial network/CPU budget;
 *  - `prefers-reduced-motion`, Save-Data and 2G connections get the poster only;
 *  - if the video fails to load the poster simply stays visible.
 * A left-weighted scrim keeps the overlaid hero copy legible over any footage.
 */
export function HeroVideoBackground({
  webmSrc,
  mp4Src,
  posterSrc,
  posterAlt = "",
  className,
}: HeroVideoBackgroundProps) {
  const [mountVideo, setMountVideo] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Decide whether to load the video at all, and defer it until idle.
  useEffect(() => {
    if (typeof window === "undefined") return;

    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    const conn = (
      navigator as Navigator & {
        connection?: { saveData?: boolean; effectiveType?: string };
      }
    ).connection;
    if (conn?.saveData) return;
    if (conn?.effectiveType && /2g$/.test(conn.effectiveType)) return;

    const start = () => setMountVideo(true);
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(start);
      return () => window.cancelIdleCallback(handle);
    }
    const handle = window.setTimeout(start, 200);
    return () => window.clearTimeout(handle);
  }, []);

  // Cross-fade poster → video once the video can actually play.
  useEffect(() => {
    if (!mountVideo) return;
    const v = videoRef.current;
    if (!v) return;

    const onReady = () => setVideoReady(true);
    if (v.readyState >= 3) onReady();
    else v.addEventListener("canplay", onReady, { once: true });

    // Autoplay may be rejected by the browser; the poster stays in that case.
    void v.play?.().catch(() => {});

    return () => v.removeEventListener("canplay", onReady);
  }, [mountVideo]);

  return (
    <div className={cn("absolute inset-0 overflow-hidden bg-foreground", className)} aria-hidden>
      <Image
        src={posterSrc}
        alt={posterAlt}
        fill
        priority
        sizes="100vw"
        className={cn(
          "object-cover transition-opacity duration-700",
          videoReady ? "opacity-0" : "opacity-100",
        )}
      />
      {mountVideo && (
        <video
          ref={videoRef}
          muted
          loop
          playsInline
          autoPlay
          preload="auto"
          poster={posterSrc}
          className={cn(
            "h-full w-full object-cover transition-opacity duration-700",
            videoReady ? "opacity-100" : "opacity-0",
          )}
        >
          {webmSrc && <source src={webmSrc} type="video/webm" />}
          <source src={mp4Src} type="video/mp4" />
        </video>
      )}
      {/* Legibility scrim — left-weighted because the hero copy sits left. */}
      <div className="absolute inset-0 bg-gradient-to-r from-foreground/60 via-foreground/25 to-transparent" />
    </div>
  );
}
