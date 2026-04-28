"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useBookingWizard } from "@/stores/booking-wizard";
import { trpc } from "@/lib/trpc/client";
import { subscribeToEvents, trackEvent, type QueuedEvent } from "@/lib/analytics/track";
import {
  currentScrollPercentage,
  DEAD_CLICK_OBSERVATION_MS,
  isInteractiveElement,
  isRageClick,
  nextScrollBreakpoint,
  RAGE_CLICK_COOLDOWN_MS,
  RAGE_CLICK_WINDOW_MS,
} from "@/lib/analytics/engagement";

const FLUSH_INTERVAL_MS = 5_000;
const FLUSH_BATCH_SIZE = 20;
const QUEUE_CAP = 50;
const ENDPOINT = "/api/trpc/live.events";
const SCROLL_THROTTLE_MS = 250;

/**
 * Client-side event-tracking runtime. Mounted once in the public/root
 * layout via `VisitorEventsMount`, it:
 *   - subscribes to `trackEvent()` calls,
 *   - batches events into an in-memory queue,
 *   - flushes every 5s or on 20 events (whichever first),
 *   - flushes synchronously on `beforeunload` via `navigator.sendBeacon`,
 *   - registers a capture-phase click listener for `[data-track]`
 *     attributes so components opt in with one attribute rather than
 *     wiring a handler per call-site.
 *
 * PII is scrubbed inside `trackEvent` before the listener receives the
 * event — see `src/lib/analytics/track.ts`.
 */
export function useVisitorEvents(): void {
  const pathname = usePathname();
  const wizardStep = useBookingWizard((s) => s.step);
  const events = trpc.live.events.useMutation();

  const queueRef = useRef<QueuedEvent[]>([]);
  const eventsRef = useRef(events);
  const pathRef = useRef<string | null>(null);
  const stepRef = useRef<number | null>(null);
  const lastReportedStepRef = useRef<number | null>(null);

  useEffect(() => {
    eventsRef.current = events;
  });

  useEffect(() => {
    const onBooking = pathname?.startsWith("/booking");
    pathRef.current = pathname ?? "/";
    stepRef.current = onBooking ? wizardStep : null;
    // Fire WIZARD_STEP_ENTER once per (booking-page, step) transition.
    if (onBooking && lastReportedStepRef.current !== wizardStep) {
      lastReportedStepRef.current = wizardStep;
      trackEvent({
        kind: "WIZARD_STEP_ENTER",
        target: `wizard-step-${wizardStep}`,
        numericValue: wizardStep,
      });
    } else if (!onBooking) {
      lastReportedStepRef.current = null;
    }
  }, [pathname, wizardStep]);

  // Scroll-depth + exit-intent reset per path change.
  useEffect(() => {
    const reported = new Set<number>();
    let lastScrollAt = 0;

    const onScroll = () => {
      const now = Date.now();
      if (now - lastScrollAt < SCROLL_THROTTLE_MS) return;
      lastScrollAt = now;
      const el = document.documentElement;
      const pct = currentScrollPercentage({
        scrollTop: el.scrollTop || document.body.scrollTop || 0,
        clientHeight: el.clientHeight,
        scrollHeight: el.scrollHeight,
      });
      const bp = nextScrollBreakpoint(pct, reported);
      if (bp != null) {
        reported.add(bp);
        trackEvent({ kind: "SCROLL_DEPTH", target: `scroll-${bp}`, numericValue: bp });
      }
    };

    // Desktop: mouseleave across the top of the viewport.
    const onMouseOut = (ev: MouseEvent) => {
      if (ev.relatedTarget != null) return;          // moved to another element
      if (ev.clientY > 0) return;                    // left via side/bottom
      fireExitIntent("mouseleave-top");
    };

    // Mobile / tab-switch: page hidden while the wizard is partly filled.
    const onVisibility = () => {
      if (document.visibilityState !== "hidden") return;
      if ((stepRef.current ?? 0) >= 1) {
        fireExitIntent("tab-hidden");
      }
    };

    let exitFired = false;
    const fireExitIntent = (reason: string) => {
      if (exitFired) return;
      exitFired = true;
      trackEvent({
        kind: "EXIT_INTENT",
        target: reason,
        value: stepRef.current != null ? `wizard-step-${stepRef.current}` : null,
        numericValue: stepRef.current,
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("mouseout", onMouseOut);
    document.addEventListener("visibilitychange", onVisibility);
    // Fire the scroll handler once on mount so pages with content above
    // the fold that fit in the viewport still record a 100% depth.
    onScroll();
    return () => {
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("mouseout", onMouseOut);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [pathname]);

  useEffect(() => {
    // Flush helper — pulls the current queue in one go so a re-entrant
    // trackEvent during a flush can't drop items.
    const flush = () => {
      const batch = queueRef.current;
      if (batch.length === 0) return;
      queueRef.current = [];
      eventsRef.current.mutate(
        { events: batch },
        {
          onError: () => {
            // Best-effort — if the network errored, re-queue the first
            // few so they aren't lost, but respect the cap.
            queueRef.current = [...batch.slice(0, Math.max(0, QUEUE_CAP - queueRef.current.length)), ...queueRef.current];
          },
        },
      );
    };

    const unsubscribe = subscribeToEvents((e) => {
      const queued: QueuedEvent = {
        ...e,
        path: pathRef.current ?? "/",
        wizardStep: stepRef.current,
        occurredAt: new Date().toISOString(),
      };
      if (queueRef.current.length >= QUEUE_CAP) {
        // Drop the oldest — analytics is not life-critical.
        queueRef.current.shift();
      }
      queueRef.current.push(queued);
      if (queueRef.current.length >= FLUSH_BATCH_SIZE) {
        flush();
      }
    });

    const interval = setInterval(flush, FLUSH_INTERVAL_MS);

    const onUnload = () => {
      if (queueRef.current.length === 0) return;
      const payload = new Blob(
        [JSON.stringify({ events: queueRef.current })],
        { type: "application/json" },
      );
      queueRef.current = [];
      if (typeof navigator !== "undefined" && "sendBeacon" in navigator) {
        navigator.sendBeacon(ENDPOINT, payload);
      }
    };
    window.addEventListener("beforeunload", onUnload);

    // Click-capture that powers three event kinds from the same handler:
    //   - CTA_CLICK (or the explicit data-track-kind) when the target
    //     matches `[data-track]`
    //   - RAGE_CLICK when ≥3 clicks land on the same element within 1s
    //     (cooldown 3s to prevent floods)
    //   - DEAD_CLICK when the click target isn't interactive and no
    //     meaningful DOM change happens within 500ms of the click.
    const clicksByTarget = new Map<string, number[]>();
    let lastRageEmit = 0;
    const onClick = (ev: MouseEvent) => {
      const target = ev.target;
      if (!(target instanceof Element)) return;
      const now = Date.now();

      // CTA / opt-in tracking via data-track attribute.
      const hit = target.closest<HTMLElement>("[data-track]");
      if (hit) {
        const trackValue = hit.dataset.track;
        if (trackValue) {
          const explicitKind = hit.dataset.trackKind;
          const extraValue = hit.dataset.trackValue;
          trackEvent({
            kind: (explicitKind as Parameters<typeof trackEvent>[0]["kind"]) ?? "CTA_CLICK",
            target: trackValue,
            value: extraValue ?? null,
          });
        }
      }

      // Rage-click — key on tag + id + first class so clicks on the
      // same visual element group regardless of nested children.
      const key = rageKey(target);
      const history = clicksByTarget.get(key) ?? [];
      history.push(now);
      // Keep only clicks inside the window so the array can't grow.
      const trimmed = history.filter((t) => now - t <= RAGE_CLICK_WINDOW_MS);
      clicksByTarget.set(key, trimmed);
      if (isRageClick(trimmed) && now - lastRageEmit > RAGE_CLICK_COOLDOWN_MS) {
        lastRageEmit = now;
        trackEvent({
          kind: "RAGE_CLICK",
          target: key.slice(0, 120),
          numericValue: trimmed.length,
        });
      }

      // Dead-click — click on a non-interactive element with no
      // meaningful DOM mutation in the next 500ms is treated as a
      // "clicked on something that looks clickable but isn't".
      if (!isInteractiveElement(target) && !target.closest("[data-track]")) {
        let mutated = false;
        const observer = new MutationObserver(() => {
          mutated = true;
          observer.disconnect();
        });
        observer.observe(document.body, { childList: true, subtree: true, attributes: true });
        window.setTimeout(() => {
          observer.disconnect();
          if (!mutated) {
            trackEvent({
              kind: "DEAD_CLICK",
              target: key.slice(0, 120),
            });
          }
        }, DEAD_CLICK_OBSERVATION_MS);
      }
    };
    document.addEventListener("click", onClick, { capture: true });

    return () => {
      unsubscribe();
      clearInterval(interval);
      window.removeEventListener("beforeunload", onUnload);
      document.removeEventListener("click", onClick, { capture: true });
    };
  }, []);
}

/**
 * Build a stable key for an element to group "same target" clicks for
 * rage-click detection. Uses tag + id + first className so clicks on
 * nested children of the same visual element still group together.
 */
function rageKey(el: Element): string {
  const host = el.closest("button, a, [role='button'], [data-track]") ?? el;
  const tag = host.tagName.toLowerCase();
  const id = host.id ? `#${host.id}` : "";
  const cls = host.classList.length > 0 ? `.${host.classList[0]}` : "";
  return `${tag}${id}${cls}`;
}
