"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useBookingWizard, type WizardState } from "@/stores/booking-wizard";
import { trpc } from "@/lib/trpc/client";

const HEARTBEAT_MS = 20_000;
const CHANGE_DEBOUNCE_MS = 300;
const VISITOR_COOKIE = "sc_visitor";
const VISITOR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

/**
 * Read or mint the persistent visitor-fingerprint cookie. Stable
 * across sessions, rotates the separate session cookie
 * (`xpertmoto_vid`). Random UUID — not identifying by itself; the
 * server uses it only to derive `sessionNumber` and `isReturning` on
 * the visitor's future sessions.
 *
 * We write the cookie client-side with `document.cookie` (not
 * HttpOnly) so a fresh tab in the same browser can pick it up without
 * needing a server round-trip. Returns `null` in SSR / no-cookie
 * environments.
 */
function readOrMintVisitorFingerprint(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.split(";").find((c) => c.trim().startsWith(`${VISITOR_COOKIE}=`));
  if (match) {
    const value = match.split("=")[1]?.trim();
    if (value && /^[a-zA-Z0-9-]{8,64}$/.test(value)) return value;
  }
  const minted = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : null;
  if (!minted) return null;
  document.cookie = `${VISITOR_COOKIE}=${minted}; Max-Age=${VISITOR_COOKIE_MAX_AGE}; Path=/; SameSite=Lax`;
  return minted;
}

/**
 * Narrow, PII-free projection of the booking-wizard store sent with
 * every heartbeat. Must match `WizardStateSchema` on the server
 * (src/server/trpc/router/live.ts). The `customer` / `deliveryAddress`
 * / `signatureDataUrl` fields are deliberately omitted — those carry
 * PII (licence, DOB, email, phone, passport, signature) and must never
 * be sent to the visitor-analytics pipeline.
 */
function buildWizardSnapshot(state: WizardState) {
  const onBookingPage = typeof window !== "undefined" && window.location.pathname.startsWith("/booking");
  const empty =
    !state.pickupDepotId &&
    !state.returnDepotId &&
    !state.pickupDateTime &&
    !state.returnDateTime &&
    !state.categoryId &&
    !state.preferredVehicleId &&
    state.addons.length === 0 &&
    !state.insuranceOptionId &&
    !state.discountCode &&
    !state.isDelivery;
  // Send nothing when the store is untouched and the visitor isn't
  // currently on the wizard — keeps the column `null` for bounced
  // browsers so abandoned-cart aggregates don't see junk rows.
  if (empty && !onBookingPage) return null;
  return {
    step: state.step,
    pickupDepotId: state.pickupDepotId,
    returnDepotId: state.returnDepotId,
    pickupDateTime: state.pickupDateTime,
    returnDateTime: state.returnDateTime,
    categoryId: state.categoryId,
    preferredVehicleId: state.preferredVehicleId,
    addons: state.addons,
    insuranceOptionId: state.insuranceOptionId,
    discountCode: state.discountCode || undefined,
    isDelivery: state.isDelivery,
    deliveryFee: state.deliveryFee,
    agreedToTerms: state.agreedToTerms,
  };
}

/**
 * Pings the server with the current page path, booking-wizard step, and
 * a narrow PII-free snapshot of the wizard store so the staff Live
 * Visitor View can see what each visitor has configured in their cart.
 * One fire on mount, one per path/step transition (debounced 300ms to
 * absorb rapid clicks), and one every 20 seconds thereafter.
 *
 * The tRPC mutation objects are captured in refs so re-renders don't
 * reschedule the effect. Without that shield the effect used to fire on
 * every render and TanStack Query collapsed the flood into huge batched
 * POSTs (30+ heartbeats per batch during the booking wizard).
 *
 * On tab close `navigator.sendBeacon` flips the session offline. No-op
 * when the visitor cookie is absent — the server returns `{ok: false}`.
 */
export function useVisitorHeartbeat(): void {
  const pathname = usePathname();
  const wizardStep = useBookingWizard((s) => s.step);
  const heartbeat = trpc.live.heartbeat.useMutation();
  const endSession = trpc.live.endSession.useMutation();

  const heartbeatRef = useRef(heartbeat);
  const endSessionRef = useRef(endSession);
  const pathRef = useRef<string | null>(null);
  const stepRef = useRef<number | null>(null);
  const lastSentRef = useRef<string>("");
  const firstHitRef = useRef<boolean>(true);

  useEffect(() => {
    heartbeatRef.current = heartbeat;
    endSessionRef.current = endSession;
  });

  useEffect(() => {
    const effectivePath = pathname ?? "/";
    const effectiveStep = pathname?.startsWith("/booking") ? wizardStep : null;
    pathRef.current = effectivePath;
    stepRef.current = effectiveStep;

    const key = `${effectivePath}|${effectiveStep ?? ""}`;
    if (lastSentRef.current === key) return;

    const timer = setTimeout(() => {
      lastSentRef.current = key;
      const firstHit = firstHitRef.current;
      firstHitRef.current = false;
      const firstHitAttrs = firstHit
        ? (() => {
            const params = new URLSearchParams(window.location.search);
            return {
              referrer: document.referrer || null,
              utmSource: params.get("utm_source"),
              utmMedium: params.get("utm_medium"),
              utmCampaign: params.get("utm_campaign"),
            };
          })()
        : {};
      heartbeatRef.current.mutate({
        path: effectivePath,
        wizardStep: effectiveStep,
        wizardState: buildWizardSnapshot(useBookingWizard.getState()),
        visitorFingerprint: readOrMintVisitorFingerprint(),
        ...firstHitAttrs,
      });
    }, CHANGE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [pathname, wizardStep]);

  useEffect(() => {
    const interval = setInterval(() => {
      heartbeatRef.current.mutate({
        path: pathRef.current ?? "/",
        wizardStep: stepRef.current,
        wizardState: buildWizardSnapshot(useBookingWizard.getState()),
        visitorFingerprint: readOrMintVisitorFingerprint(),
      });
    }, HEARTBEAT_MS);

    const onUnload = () => {
      const url = "/api/trpc/live.endSession";
      const payload = new Blob([JSON.stringify({})], {
        type: "application/json",
      });
      if (typeof navigator !== "undefined" && "sendBeacon" in navigator) {
        navigator.sendBeacon(url, payload);
      } else {
        endSessionRef.current.mutate();
      }
    };
    window.addEventListener("beforeunload", onUnload);
    return () => {
      clearInterval(interval);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, []);
}
