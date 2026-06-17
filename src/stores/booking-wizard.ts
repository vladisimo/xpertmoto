"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";

import { BOOKING_RULES } from "@/lib/constants";

export type WizardStep = 1 | 2 | 3 | 4 | 5 | 6;

export type WizardAddon = { addonId: string; quantity: number };

/**
 * H-4: a draft created at step 6 (a PENDING_PAYMENT booking + its Stripe
 * PaymentIntents). Persisted so a refresh / back-forward on the payment step
 * reuses the same booking + intents instead of firing `booking.create` again
 * and orphaning another "Pending payment" row. Reused only while the cart is
 * unchanged (`signature`) and the intents are still alive (`expiresAt`, kept
 * just under Stripe's 24h PaymentIntent lifetime). Cleared on completion via
 * `flushBookingWizard()` / `reset()`.
 */
export type WizardDraft = {
  signature: string;
  expiresAt: number;
  bookingId: string;
  bookingReference: string;
  paymentClientSecret: string | null;
  paymentIntentId: string | null;
  bondClientSecret: string | null;
  bondIntentId: string | null;
  stripeEnabled: boolean;
  payOnlineAmount: number;
  bondAmount: number;
};

/** Stripe PaymentIntents live ~24h; reuse a draft for a touch less. */
export const DRAFT_TTL_MS = 23 * 60 * 60 * 1000;

/**
 * Stable signature of the pricing-relevant cart fields — the exact inputs
 * `booking.create` consumes. A persisted draft is only reused when this
 * matches the current cart; any change (dates, category, addons, insurance,
 * discount, delivery) invalidates it and forces a fresh draft.
 */
export function bookingCartSignature(state: {
  categoryId: string | null;
  pickupDepotId: string | null;
  returnDepotId: string | null;
  pickupDateTime: string | null;
  returnDateTime: string | null;
  addons: WizardAddon[];
  insuranceOptionId: string | null;
  discountCode: string;
  isDelivery: boolean;
  deliveryFee: number;
}): string {
  const addons = [...state.addons]
    .map((a) => `${a.addonId}:${a.quantity}`)
    .sort()
    .join(",");
  return [
    state.categoryId ?? "",
    state.pickupDepotId ?? "",
    state.returnDepotId ?? "",
    state.pickupDateTime ?? "",
    state.returnDateTime ?? "",
    addons,
    state.insuranceOptionId ?? "",
    state.discountCode ?? "",
    state.isDelivery ? "1" : "0",
    String(state.deliveryFee ?? 0),
  ].join("|");
}

/**
 * Primary "Continue" CTA registered by whichever step is mounted. The
 * mobile shell reads this slice and renders the button in its sticky
 * bottom bar; the desktop shell ignores it because steps render their
 * own inline Back/Continue row.
 *
 * `onClick` is set once per register — steps that need access to
 * fresh-closure state (react-hook-form handles, mutation callbacks)
 * route through a ref-based indirection in useStepContinueAction so
 * changing the closure doesn't churn the store.
 */
export type WizardContinueAction = {
  label: string;
  disabled: boolean;
  pending?: boolean;
  onClick: () => void | Promise<void>;
};

/**
 * Which identity document path the customer selected at the Step 4 gate.
 * `null` before they answer. `"AU_LICENCE"` locks the form to the AU
 * licence fields. `"INTERNATIONAL"` requires both an International
 * Driver's Permit (with a country instead of a state) AND a passport.
 */
export type WizardIdentityPath = "AU_LICENCE" | "INTERNATIONAL" | null;

export type WizardCustomer = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  licenceNumber: string;
  licenceState: string;
  /** ISO-3166 alpha-2 issuing country for an International Driver's Permit. */
  licenceCountry: string;
  licenceExpiry: string;
  licenceClass: string;
  passportNumber: string;
  passportCountry: string;
  passportExpiry: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
};

export type WizardState = {
  step: WizardStep;
  pickupDepotId: string | null;
  returnDepotId: string | null;
  pickupDateTime: string | null;
  returnDateTime: string | null;
  categoryId: string | null;
  preferredVehicleId: string | null;
  /**
   * True when the customer explicitly ticks "No preference" on step 2 —
   * distinct from the default state where they simply haven't picked
   * anything yet. When true the vehicle list / filters are hidden so the
   * step shows just the confirmation, and unticking restores the picker.
   */
  noPreference: boolean;
  addons: WizardAddon[];
  waivedAddonIds: string[];
  insuranceOptionId: string | null;
  discountCode: string;
  isDelivery: boolean;
  deliveryAddress: string;
  deliveryFee: number;
  customer: WizardCustomer;
  identityPath: WizardIdentityPath;
  agreedToTerms: boolean;
  signatureDataUrl: string | null;
  /**
   * H-4: the step-6 payment draft (booking + Stripe intents), reused across
   * remounts for an unchanged cart. Persisted; cleared on completion.
   */
  draft: WizardDraft | null;
  /**
   * Registered at mount by the active step; cleared on unmount. Never
   * persisted — belongs in-memory only (functions can't serialise).
   */
  stepContinueAction: WizardContinueAction | null;

  setStep: (step: WizardStep) => void;
  /**
   * Set `step` without writing to browser history. For use by the
   * popstate listener (to avoid a feedback loop) and the initial-mount
   * reconcile (we use `replaceState` ourselves there, not `pushState`).
   */
  _setStepSilent: (step: WizardStep) => void;
  next: () => void;
  back: () => void;
  set: <K extends keyof WizardState>(key: K, value: WizardState[K]) => void;
  setCustomer: (patch: Partial<WizardCustomer>) => void;
  toggleAddon: (addonId: string) => void;
  waiveAddon: (addonId: string) => void;
  unwaiveAddon: (addonId: string) => void;
  setStepContinueAction: (action: WizardContinueAction | null) => void;
  setDraft: (draft: WizardDraft | null) => void;
  reset: () => void;
};

const emptyCustomer: WizardCustomer = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  dateOfBirth: "",
  licenceNumber: "",
  licenceState: "",
  licenceCountry: "",
  licenceExpiry: "",
  licenceClass: "",
  passportNumber: "",
  passportCountry: "",
  passportExpiry: "",
  emergencyContactName: "",
  emergencyContactPhone: "",
};

/**
 * Key used by `/booking/confirmation` and step-payment to flag the current
 * tab as "just completed a booking", so the param-seeding `useEffect` in
 * `/booking/page.tsx` knows to skip one hydration on the post-payment
 * bounce. Consumed + cleared on the next mount of /booking.
 */
export const POST_BOOKING_RESET_FLAG = "xpertmoto-booking-just-completed";

/**
 * Set by `resetStaleBookingWizard()` when a *resumed* wizard is wiped because
 * its pickup time is too late (past or within the booking cut-off) or its
 * vehicle/category has sold out. Read + cleared by step-search.tsx to show the
 * "we reset you" notice. Deliberately distinct from `POST_BOOKING_RESET_FLAG`:
 * this one carries a human reason and must NOT trigger the post-payment
 * seed-skip path in booking-wizard-client.tsx.
 */
export const STALE_RESET_FLAG = "xpertmoto-booking-stale-reset";
export type StaleResetReason = "PICKUP_PASSED" | "UNAVAILABLE";

/**
 * True when a persisted pickup is too late to resume against — already past,
 * or within the booking cut-off (`BOOKING_RULES.cutoffMinutesBeforePickup`)
 * so there's no realistic chance of completing the booking in time. Pure +
 * `now`-injectable so it can be unit-tested without faking the clock.
 */
export function isPickupTooLate(pickupIso: string | null, now = Date.now()): boolean {
  if (!pickupIso) return false;
  const ms = new Date(pickupIso).getTime();
  if (!Number.isFinite(ms)) return false;
  return ms - now <= BOOKING_RULES.cutoffMinutesBeforePickup * 60_000;
}

/**
 * Pragmatic check for whether the customer block holds enough data to
 * progress past step 4 via a URL-driven jump (browser forward, deep
 * link). The form-submit gate inside step-details.tsx still does its
 * own zod validation; this is only the "could the user have plausibly
 * reached step 5 by clicking Continue?" guard for `maxReachableStep`.
 */
export function isCustomerComplete(
  customer: WizardCustomer,
  identityPath: WizardIdentityPath,
): boolean {
  if (!customer.firstName || !customer.lastName) return false;
  if (!customer.email || !customer.dateOfBirth) return false;
  const licenceOk = !!(customer.licenceNumber && customer.licenceState && customer.licenceExpiry);
  if (identityPath === "AU_LICENCE") return licenceOk;
  if (identityPath === "INTERNATIONAL") {
    // IDP + passport both required.
    return !!(
      customer.licenceNumber &&
      customer.licenceCountry &&
      customer.licenceExpiry &&
      customer.passportNumber &&
      customer.passportExpiry
    );
  }
  // identityPath null — legacy mode (wizard_intl_licence_flow off, or a
  // profile saved before licenceType existed). Mirror detailsStepSchema's
  // documented flag-off rule: at least one valid ID (licence OR passport)
  // is sufficient. Requiring identityPath here left such customers silently
  // stuck at step 4: w.next() clamped back to 4 with no visible error.
  const passportOk = !!(customer.passportNumber && customer.passportExpiry);
  return licenceOk || passportOk;
}

/**
 * Highest step the user could legitimately have reached by clicking
 * Continue through the wizard. Used to clamp URL-driven jumps (deep
 * link, browser forward into invalid territory) so a hostile or stale
 * `?step=N` can't skip required input.
 */
export function maxReachableStep(state: WizardState): WizardStep {
  const step2Ok =
    !!state.categoryId &&
    !!state.pickupDepotId &&
    !!state.pickupDateTime &&
    !!state.returnDateTime;
  if (!step2Ok) return 1;
  const step3Ok = !!state.preferredVehicleId || state.noPreference;
  if (!step3Ok) return 2;
  // Step 4 has no extras-side gate — the auth gate is enforced inside
  // step-details.tsx itself, not at the URL layer (the user might sign
  // in mid-step).
  const step5Ok = isCustomerComplete(state.customer, state.identityPath);
  if (!step5Ok) return 4;
  // Step 6 (payment) unlocks once the provisional terms are accepted on
  // step 5. The customer wizard does NOT capture a signature — the full
  // rental agreement (incl. signatures) is signed with staff on a tablet
  // at pickup (see step-review.tsx). `signatureDataUrl` is never set in
  // this flow, so gating on it here left step 6 permanently unreachable.
  const step6Ok = state.agreedToTerms;
  if (!step6Ok) return 5;
  return 6;
}

const STEP_PARAM = "step";

/**
 * Sync the wizard `step` to the URL via `?step=N` so browser back /
 * forward walks the wizard. Idempotent — skips writing if the URL
 * already reflects the target step (prevents duplicate history entries
 * when actions fire twice).
 */
function writeStepToUrl(step: WizardStep): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (Number(url.searchParams.get(STEP_PARAM)) === step) return;
  url.searchParams.set(STEP_PARAM, String(step));
  window.history.pushState({ wizardStep: step }, "", url);
}

export const useBookingWizard = create<WizardState>()(
  persist(
    (set, get) => ({
      step: 1,
      pickupDepotId: null,
      returnDepotId: null,
      pickupDateTime: null,
      returnDateTime: null,
      categoryId: null,
      preferredVehicleId: null,
      noPreference: false,
      addons: [],
      waivedAddonIds: [],
      insuranceOptionId: null,
      discountCode: "",
      isDelivery: false,
      deliveryAddress: "",
      deliveryFee: 0,
      customer: emptyCustomer,
      identityPath: null,
      agreedToTerms: false,
      signatureDataUrl: null,
      draft: null,
      stepContinueAction: null,

      setStep: (step) => {
        const clamped = Math.min(step, maxReachableStep(get())) as WizardStep;
        set({ step: clamped });
        writeStepToUrl(clamped);
      },
      _setStepSilent: (step) => set({ step }),
      next: () => get().setStep(Math.min(6, get().step + 1) as WizardStep),
      back: () => get().setStep(Math.max(1, get().step - 1) as WizardStep),
      set: (key, value) => set({ [key]: value } as never),
      setCustomer: (patch) => set({ customer: { ...get().customer, ...patch } }),
      toggleAddon: (addonId) => {
        const existing = get().addons.find((a) => a.addonId === addonId);
        set({
          addons: existing
            ? get().addons.filter((a) => a.addonId !== addonId)
            : [...get().addons, { addonId, quantity: 1 }],
          waivedAddonIds: get().waivedAddonIds.filter((id) => id !== addonId),
        });
      },
      waiveAddon: (addonId) => {
        set({
          addons: get().addons.filter((a) => a.addonId !== addonId),
          waivedAddonIds: get().waivedAddonIds.includes(addonId)
            ? get().waivedAddonIds
            : [...get().waivedAddonIds, addonId],
        });
      },
      unwaiveAddon: (addonId) => {
        set({
          waivedAddonIds: get().waivedAddonIds.filter((id) => id !== addonId),
        });
      },
      setStepContinueAction: (action) => set({ stepContinueAction: action }),
      setDraft: (draft) => set({ draft }),
      reset: () =>
        set({
          step: 1,
          pickupDepotId: null,
          returnDepotId: null,
          pickupDateTime: null,
          returnDateTime: null,
          categoryId: null,
          preferredVehicleId: null,
          noPreference: false,
          addons: [],
          waivedAddonIds: [],
          insuranceOptionId: null,
          discountCode: "",
          isDelivery: false,
          deliveryAddress: "",
          deliveryFee: 0,
          customer: emptyCustomer,
          identityPath: null,
          agreedToTerms: false,
          signatureDataUrl: null,
          draft: null,
          stepContinueAction: null,
        }),
    }),
    {
      name: "xpertmoto-booking-wizard",
      // `stepContinueAction` holds a function — exclude it from persistence
      // so we don't serialise an incomplete record and rehydrate with
      // `onClick` missing.
      partialize: (state) => {
        const { stepContinueAction: _ignored, ...rest } = state;
        return rest;
      },
    },
  ),
);

/**
 * Clear the wizard in-memory, wipe its localStorage row, and mark the tab
 * as just-completed so /booking's URL-param seeding skips one hydration.
 * Call this from the payment success path — NOT from mid-wizard "cancel"
 * flows (those should only `reset()`).
 */
export function flushBookingWizard(): void {
  useBookingWizard.getState().reset();
  void useBookingWizard.persist.clearStorage();
  if (typeof window !== "undefined") {
    try {
      sessionStorage.setItem(POST_BOOKING_RESET_FLAG, "1");
    } catch {
      // sessionStorage can throw in Safari private mode — safe to ignore.
    }
    // Strip any lingering `?step=` so a subsequent Back doesn't restore
    // step 6 of the just-completed booking.
    const url = new URL(window.location.href);
    if (url.searchParams.has(STEP_PARAM)) {
      url.searchParams.delete(STEP_PARAM);
      window.history.replaceState({}, "", url);
    }
  }
}

/**
 * Wipe a resumed wizard that's gone stale (pickup too late, or the chosen
 * vehicle/category sold out) and send the customer back to step 1 from
 * scratch. Mirrors `flushBookingWizard()` but records a human-readable
 * `reason` in sessionStorage (for the step-1 notice) and — crucially — does
 * NOT set `POST_BOOKING_RESET_FLAG`, so this reset isn't mistaken for a
 * completed booking (which would skip URL-param seeding on the next entry).
 */
export function resetStaleBookingWizard(reason: StaleResetReason): void {
  useBookingWizard.getState().reset();
  void useBookingWizard.persist.clearStorage();
  if (typeof window !== "undefined") {
    try {
      sessionStorage.setItem(STALE_RESET_FLAG, reason);
    } catch {
      // sessionStorage can throw in Safari private mode — safe to ignore.
    }
    // Strip any lingering `?step=` and anchor history at step 1 so a
    // subsequent Back / popstate can't restore the stale deep step.
    const url = new URL(window.location.href);
    url.searchParams.delete(STEP_PARAM);
    window.history.replaceState({ wizardStep: 1 }, "", url);
  }
}
