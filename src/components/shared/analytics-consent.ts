"use client";

import { useSyncExternalStore } from "react";

/**
 * Analytics consent gate (APP 3/5 — no analytics cookies before the visitor
 * agrees). This module owns the *whether*, never the *what*: the PostHog event
 * taxonomy, distinct_id and group conventions are untouched. Every browser-side
 * PostHog entry point reads it — `posthog-provider.tsx` (loader snippet),
 * `posthog-identify.tsx` (identify) and `web-vitals-reporter.tsx` (captures).
 *
 * Persisted in `localStorage` rather than a cookie so the choice never travels
 * to the server on every request. Storage access is wrapped because Safari
 * private browsing and hardened profiles throw — a throw resolves to "unset",
 * i.e. analytics stays off, which is the safe direction.
 */

export type ConsentChoice = "granted" | "denied";
export type ConsentState = ConsentChoice | "unset";

/** Versioned so a future change to what we ask for can re-prompt. */
export const ANALYTICS_CONSENT_KEY = "analytics-consent.v1";

const listeners = new Set<() => void>();

/**
 * `useSyncExternalStore` may call the snapshot getter several times per render,
 * so the parsed value is memoised and invalidated on write / `storage` event.
 */
let cached: ConsentState | undefined;

function readStored(): ConsentState {
  if (typeof window === "undefined") return "unset";
  try {
    const raw = window.localStorage.getItem(ANALYTICS_CONSENT_KEY);
    return raw === "granted" || raw === "denied" ? raw : "unset";
  } catch {
    return "unset";
  }
}

function emit(): void {
  for (const listener of listeners) listener();
}

function handleStorage(event: StorageEvent): void {
  // `key === null` means the whole store was cleared.
  if (event.key !== null && event.key !== ANALYTICS_CONSENT_KEY) return;
  refreshAnalyticsConsent();
}

/** Current choice. `"unset"` until the visitor answers the banner. */
export function getAnalyticsConsent(): ConsentState {
  if (cached === undefined) cached = readStored();
  return cached;
}

/** The single question every capture path asks before firing. */
export function isAnalyticsGranted(): boolean {
  return getAnalyticsConsent() === "granted";
}

/** Record the visitor's answer and wake every subscriber. */
export function setAnalyticsConsent(choice: ConsentChoice): void {
  try {
    window.localStorage.setItem(ANALYTICS_CONSENT_KEY, choice);
  } catch {
    // Storage unavailable — the choice still applies for this page-load.
  }
  cached = choice;
  emit();
}

/**
 * Forget the stored answer so the banner asks again — this is the
 * "change your choice" affordance on the privacy page.
 */
export function clearAnalyticsConsent(): void {
  try {
    window.localStorage.removeItem(ANALYTICS_CONSENT_KEY);
  } catch {
    // Nothing persisted to remove.
  }
  cached = "unset";
  emit();
}

/** Re-read from storage (another tab answered the banner) and notify on change. */
export function refreshAnalyticsConsent(): void {
  const next = readStored();
  if (next === cached) return;
  cached = next;
  emit();
}

export function subscribeAnalyticsConsent(listener: () => void): () => void {
  if (listeners.size === 0 && typeof window !== "undefined") {
    window.addEventListener("storage", handleStorage);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined") {
      window.removeEventListener("storage", handleStorage);
    }
  };
}

const serverSnapshot = (): ConsentState | null => null;

/**
 * Returns `null` until hydration has run — `localStorage` doesn't exist during
 * SSR, so rendering the banner (or the loader snippet) from the server markup
 * would flash it at visitors who already answered. React re-renders with the
 * real value straight after hydration commits.
 */
export function useAnalyticsConsent(): ConsentState | null {
  return useSyncExternalStore<ConsentState | null>(
    subscribeAnalyticsConsent,
    getAnalyticsConsent,
    serverSnapshot,
  );
}
