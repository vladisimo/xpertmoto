"use client";

import type { VisitorEventKind } from "@prisma/client";

/**
 * Client-side event tracking API. Components call `trackEvent(kind, opts)`
 * to enqueue an event; the `useVisitorEvents` hook batches and flushes
 * every 5s or on 20 events (whichever comes first), and on
 * `beforeunload` via `navigator.sendBeacon`.
 *
 * PII-scrub rules live here so every caller — hand-authored emitters,
 * `[data-track]` click-capture, form-field listeners — gets the same
 * guarantees. Never send emails, phones, licences, DOBs, or credit-card
 * numbers to the events pipeline.
 */

export type TrackEventInput = {
  kind: VisitorEventKind;
  target?: string | null;
  value?: string | null;
  numericValue?: number | null;
  // Primitive-only — matches the server-side schema for `live.events`.
  // Nested objects/arrays are rejected to keep the payload predictable
  // and eliminate an unvalidated JSON sink.
  metadata?: Record<string, string | number | boolean | null> | null;
};

export type QueuedEvent = TrackEventInput & {
  path: string;
  wizardStep: number | null;
  occurredAt: string;
};

const MAX_TARGET_LEN = 120;
const MAX_VALUE_LEN = 240;
// Order matters: card detector runs before phone so a 16-digit card
// number with spaces doesn't get greedily swallowed by the phone regex.
const PII_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i, label: "[email]" },
  // Credit-card-like sequences (13–19 digits, optionally space/hyphen separated).
  { pattern: /(?:\d[ -]?){13,19}/, label: "[card]" },
  // Simple phone detector — matches 7+ contiguous digits with common separators.
  { pattern: /(?:\+?\d[\d\s().-]{6,}\d)/, label: "[phone]" },
];

// Field names / data-track values that should NEVER have their value
// recorded (PII by construction). We still record the field was focused
// or changed — just blank out `value`. Matched by word boundaries so
// benign substrings (e.g. "fleet-card-book") don't trip on "card".
const PII_FIELD_HINTS = [
  "email",
  "phone",
  "mobile",
  "firstname",
  "lastname",
  "name",
  "dob",
  "dateofbirth",
  "licence",
  "license",
  "passport",
  "password",
  "cvv",
  "cvc",
  "cardnumber",
  "creditcard",
  "signature",
  "address",
  "postcode",
  "postal",
  "zip",
  "emergency",
];

/**
 * Strip PII from an arbitrary string value. Applied to every event
 * `value` before it leaves the tab. Replaces detected patterns with a
 * labelled token so downstream aggregates can still count occurrences.
 */
export function scrubPii(input: string): string {
  let out = input;
  for (const { pattern, label } of PII_PATTERNS) {
    out = out.replace(new RegExp(pattern, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g"), label);
  }
  return out;
}

export function targetLooksPii(target: string | null | undefined): boolean {
  if (!target) return false;
  // Tokenise on non-alphanumerics so "fleet-card-book" tokenises to
  // ["fleet", "card", "book"] and "first_name" → ["first", "name"].
  // Hints are matched against tokens and the full flattened string so
  // "firstName" (camelCase) is also caught via the flattened path.
  const lower = target.toLowerCase();
  const flattened = lower.replace(/[^a-z0-9]/g, "");
  const tokens = lower.split(/[^a-z0-9]+/).filter(Boolean);
  return PII_FIELD_HINTS.some(
    (hint) => tokens.includes(hint) || flattened.includes(hint),
  );
}

/**
 * Normalise an event before it goes onto the queue. Trims strings,
 * clamps lengths, applies PII scrubs, and drops `value` entirely when
 * the target looks like a PII-bearing field.
 */
export function sanitizeEvent(input: TrackEventInput): TrackEventInput {
  const target = input.target ? input.target.trim().slice(0, MAX_TARGET_LEN) : undefined;
  let value: string | null | undefined = input.value;
  if (value != null) {
    value = String(value).trim();
    if (targetLooksPii(target)) {
      value = null;
    } else if (value.length > 0) {
      value = scrubPii(value).slice(0, MAX_VALUE_LEN);
    } else {
      value = null;
    }
  }
  return {
    kind: input.kind,
    target: target ?? null,
    value: value ?? null,
    numericValue: typeof input.numericValue === "number" && Number.isFinite(input.numericValue)
      ? Math.trunc(input.numericValue)
      : null,
    metadata: input.metadata ?? null,
  };
}

/**
 * Subscribe to track events. The `useVisitorEvents` hook registers a
 * listener; each `trackEvent()` call fans out to every listener so we
 * don't need a module-level queue. Kept small (~20 LoC) so the module
 * stays tree-shakeable — no React imports, no Zustand.
 */
type Listener = (event: TrackEventInput) => void;
const listeners = new Set<Listener>();

export function subscribeToEvents(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Enqueue an event. No-op when no listener is subscribed (SSR / test
 * harness / events hook not yet mounted). Synchronous — fast enough to
 * call from hot click handlers.
 */
export function trackEvent(input: TrackEventInput): void {
  if (listeners.size === 0) return;
  const sanitized = sanitizeEvent(input);
  for (const l of listeners) {
    try {
      l(sanitized);
    } catch {
      // A misbehaving listener shouldn't break the tracking pipeline.
    }
  }
}
