// Presentation-layer mapping for CommunicationLog delivery outcomes.
//
// The per-channel admin gate (server/services/notification-gate.ts) records an
// intentionally-withheld message as CommunicationLog.status FAILED +
// errorMessage "SUPPRESSED:<reason>". The raw code is kept on the row so it
// stays filterable/queryable; this module is the single place that turns it
// into human copy and a neutral (not red "Failed") presentation. Shared by the
// comms log table and the detail drawer so the two views never disagree.

// Friendly copy keyed by the gate's reason code (see notification-gate.ts).
const SUPPRESSION_COPY: Record<string, string> = {
  channel_disabled: "Not delivered — this channel is turned off in admin notification settings.",
  paused: "Not delivered — all notifications are currently paused in admin settings.",
};

// Recognised *internal* error fingerprints. These are framework/runtime
// exceptions that leak into a send (a bug, not a delivery problem) and read as
// gibberish to back-office staff. We show friendly copy and tuck the raw text
// into `detail`. Unrecognised messages (real provider errors like "Twilio
// 21610: blocked") are left verbatim — they're already actionable. Keep the
// list small and high-confidence; the fallback is to show the raw message.
const INTERNAL_ERROR_PATTERNS: { match: RegExp; text: string }[] = [
  {
    // Next.js "use cache" / cacheLife / cacheTag / revalidateTag invoked
    // outside a request scope (e.g. a background worker). See branding.ts.
    match: /cacheLife|cacheComponents|cacheTag|use cache|static generation store|revalidateTag/i,
    text: "Couldn't be generated due to a server configuration error. This is a system bug, not a delivery problem — resending won't help until it's fixed.",
  },
];

// `text` is what staff read; `suppressed` flips the badge/tone to neutral;
// `detail` (when present) is the raw technical message kept for debugging.
export type DeliveryNote = { text: string; suppressed: boolean; detail?: string };

// Maps a CommunicationLog.errorMessage into display copy.
//   - "SUPPRESSED:<reason>" — intentional admin gate (not a failure): neutral tone.
//   - recognised internal/runtime error — friendly copy + raw kept in `detail`.
//   - anything else (real provider error) — passed through verbatim.
export function formatDeliveryNote(errorMessage: string | null | undefined): DeliveryNote | null {
  if (!errorMessage) return null;
  if (errorMessage.startsWith("SUPPRESSED:")) {
    const reason = errorMessage.slice("SUPPRESSED:".length);
    return {
      text: SUPPRESSION_COPY[reason] ?? "Not delivered — suppressed by an admin notification setting.",
      suppressed: true,
    };
  }
  const internal = INTERNAL_ERROR_PATTERNS.find((p) => p.match.test(errorMessage));
  if (internal) {
    return { text: internal.text, suppressed: false, detail: errorMessage };
  }
  return { text: errorMessage, suppressed: false };
}

// True when the row was withheld by the admin gate rather than failing in
// transit. Used to swap the red "Failed" badge for a neutral "Suppressed" pill.
export function isSuppressed(errorMessage: string | null | undefined): boolean {
  return Boolean(errorMessage?.startsWith("SUPPRESSED:"));
}
