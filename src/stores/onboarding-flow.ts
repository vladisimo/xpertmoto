"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Customer onboarding wizard state. Persisted to localStorage so the
 * customer can leave mid-flow (e.g. to find their licence) and pick up
 * where they left off. Cleared by `flushOnboardingFlow()` after the
 * `complete` mutation succeeds.
 *
 * Modeled after src/stores/booking-wizard.ts so the same patterns
 * (`persist` + `partialize` to drop non-serialisable fields) apply.
 */

export type OnboardingStep = 1 | 2 | 3 | 4 | 5;

export type OnboardingIdentityPath = "AU_LICENCE" | "INTERNATIONAL" | null;

export type OnboardingProfileForm = {
  dateOfBirth: string;
  addressLine1: string;
  addressLine2: string;
  suburb: string;
  state: string;
  postcode: string;
  country: string;
  phone: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyContactRelationship: string;
};

export type OnboardingIdentityForm = {
  licenceNumber: string;
  licenceState: string;
  licenceCountry: string;
  licenceExpiry: string;
  licenceClass: string;
  licenceImageFrontKey: string;
  licenceImageBackKey: string;
  passportNumber: string;
  passportCountry: string;
  passportExpiry: string;
  passportImageKey: string;
};

export type OnboardingConsentsForm = {
  acceptedTerms: boolean;
  acceptedPrivacy: boolean;
  acceptedCancellation: boolean;
  acceptedMarketing: boolean;
  marketingEmailOptIn: boolean;
  marketingSmsOptIn: boolean;
};

export type OnboardingFlowState = {
  step: OnboardingStep;
  profile: OnboardingProfileForm;
  identityPath: OnboardingIdentityPath;
  identity: OnboardingIdentityForm;
  consents: OnboardingConsentsForm;
  /** PNG data URL captured client-side; never persisted (signatures are
   *  PII and we don't want them lingering in localStorage). */
  signatureDataUrl: string | null;

  setStep: (step: OnboardingStep) => void;
  next: () => void;
  back: () => void;
  setProfile: (patch: Partial<OnboardingProfileForm>) => void;
  setIdentityPath: (path: OnboardingIdentityPath) => void;
  setIdentity: (patch: Partial<OnboardingIdentityForm>) => void;
  setConsents: (patch: Partial<OnboardingConsentsForm>) => void;
  setSignature: (dataUrl: string | null) => void;
  reset: () => void;
};

const emptyProfile: OnboardingProfileForm = {
  dateOfBirth: "",
  addressLine1: "",
  addressLine2: "",
  suburb: "",
  state: "",
  postcode: "",
  country: "Australia",
  phone: "",
  emergencyContactName: "",
  emergencyContactPhone: "",
  emergencyContactRelationship: "",
};

const emptyIdentity: OnboardingIdentityForm = {
  licenceNumber: "",
  licenceState: "",
  licenceCountry: "",
  licenceExpiry: "",
  licenceClass: "",
  licenceImageFrontKey: "",
  licenceImageBackKey: "",
  passportNumber: "",
  passportCountry: "",
  passportExpiry: "",
  passportImageKey: "",
};

const emptyConsents: OnboardingConsentsForm = {
  acceptedTerms: false,
  acceptedPrivacy: false,
  acceptedCancellation: false,
  acceptedMarketing: false,
  marketingEmailOptIn: false,
  marketingSmsOptIn: false,
};

export const useOnboardingFlow = create<OnboardingFlowState>()(
  persist(
    (set, get) => ({
      step: 1,
      profile: emptyProfile,
      identityPath: null,
      identity: emptyIdentity,
      consents: emptyConsents,
      signatureDataUrl: null,

      setStep: (step) => set({ step }),
      next: () => set({ step: Math.min(5, get().step + 1) as OnboardingStep }),
      back: () => set({ step: Math.max(1, get().step - 1) as OnboardingStep }),
      setProfile: (patch) => set({ profile: { ...get().profile, ...patch } }),
      setIdentityPath: (path) => set({ identityPath: path }),
      setIdentity: (patch) => set({ identity: { ...get().identity, ...patch } }),
      setConsents: (patch) => set({ consents: { ...get().consents, ...patch } }),
      setSignature: (dataUrl) => set({ signatureDataUrl: dataUrl }),
      reset: () =>
        set({
          step: 1,
          profile: emptyProfile,
          identityPath: null,
          identity: emptyIdentity,
          consents: emptyConsents,
          signatureDataUrl: null,
        }),
    }),
    {
      name: "xpertmoto-onboarding-flow",
      // Drop the signature data URL on serialisation. Keeping it in
      // localStorage is a PII / size hazard — re-prompt for signature on
      // resume, the rest of the form repopulates.
      partialize: (state) => {
        const { signatureDataUrl: _ignored, ...rest } = state;
        return rest;
      },
    },
  ),
);

export function flushOnboardingFlow(): void {
  useOnboardingFlow.getState().reset();
  void useOnboardingFlow.persist.clearStorage();
}
