"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type WizardStep = 1 | 2 | 3 | 4 | 5 | 6;

export type WizardAddon = { addonId: string; quantity: number };

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
  if (!identityPath) return false;
  if (identityPath === "AU_LICENCE") {
    return !!(customer.licenceNumber && customer.licenceState && customer.licenceExpiry);
  }
  // INTERNATIONAL — IDP + passport both required.
  return !!(
    customer.licenceNumber &&
    customer.licenceCountry &&
    customer.licenceExpiry &&
    customer.passportNumber &&
    customer.passportExpiry
  );
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
  const step6Ok = state.agreedToTerms && !!state.signatureDataUrl;
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
