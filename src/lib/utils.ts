import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number | string, currency = "AUD") {
  const value = typeof amount === "string" ? Number(amount) : amount;
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency,
  }).format(value);
}

export function formatDate(date: Date | string, opts?: Intl.DateTimeFormatOptions) {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("en-AU", opts ?? { dateStyle: "medium" }).format(d);
}

export function formatDateTime(date: Date | string) {
  return formatDate(date, { dateStyle: "medium", timeStyle: "short" });
}

// Compact human-friendly duration for analytics cells ("3m 12s", "2h 4m", "3d").
// Designed for staff-productivity views where precision past one unit is noise.
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return "—";
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

// NOTE: `generateBookingReference` is intentionally NOT re-exported here.
// It lives in `@/lib/id-gen` which imports from `node:crypto` and must not
// be pulled into client bundles. Server code should import from id-gen.
