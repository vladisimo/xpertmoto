"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { useBranding } from "@/components/shared/branding-provider";

type Variant = "default" | "inverse" | "mark";

export interface BrandLogoProps {
  variant?: Variant;
  /** When true, wraps the logo in a Link to `/`. Default true. Use false inside an existing anchor. */
  linked?: boolean;
  className?: string;
  /** Pixel height of the rendered logo. Width auto-scales. */
  height?: number;
}

const DEFAULT_WIDE = "/brand/xpert-logo-white.png";
const DEFAULT_SQUARE = "/brand/xpert-logo-white-square.png";
const DEFAULT_WIDE_DARK = "/brand/xpert-logo-black.avif";

export function BrandLogo({ variant = "default", linked = true, className, height = 32 }: BrandLogoProps) {
  const branding = useBranding();
  const homeLabel = `${branding.siteName} home`;

  if (variant === "inverse") {
    const src = branding.logoWideUrl ?? DEFAULT_WIDE;
    const img = (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={branding.siteName}
        fetchPriority="high"
        className={cn("w-auto", className)}
        style={{ height }}
      />
    );
    if (!linked) return img;
    return (
      <Link href="/" className="inline-flex items-center" aria-label={homeLabel}>
        {img}
      </Link>
    );
  }

  if (variant === "mark") {
    if (branding.logoSquareUrl) {
      const img = (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={branding.logoSquareUrl}
          alt={branding.siteName}
          fetchPriority="high"
          className={cn("object-contain", className)}
          style={{ width: height, height }}
        />
      );
      if (!linked) return img;
      return (
        <Link href="/" className="inline-flex items-center" aria-label={homeLabel}>
          {img}
        </Link>
      );
    }
    const mark = <MarkSvg height={height} label={branding.siteName} className={cn("text-foreground", className)} />;
    if (!linked) return mark;
    return (
      <Link href="/" className="inline-flex items-center" aria-label={homeLabel}>
        {mark}
      </Link>
    );
  }

  // variant === "default" — wordmark on a light surface.
  const wordmark = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={DEFAULT_WIDE_DARK}
      alt={branding.siteName}
      fetchPriority="high"
      className={cn("w-auto", className)}
      style={{ height }}
    />
  );
  if (!linked) return wordmark;
  return (
    <Link href="/" className="inline-flex items-center" aria-label={homeLabel}>
      {wordmark}
    </Link>
  );
}

function MarkSvg({ height, label, className }: { height: number; label: string; className?: string }) {
  const initial = label.trim().charAt(0).toUpperCase() || "X";
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 48 48"
      role="img"
      aria-label={label}
      height={height}
      width={height}
      className={className}
    >
      <rect width="48" height="48" rx="8" fill="currentColor" />
      <text
        x="24"
        y="33"
        textAnchor="middle"
        className="font-display"
        fontSize="28"
        fontWeight={700}
        fill="hsl(var(--background))"
      >
        {initial}
      </text>
    </svg>
  );
}
