"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

import { Spinner } from "@/components/ui/spinner";
import { trpc } from "@/lib/trpc/client";
import {
  flushOnboardingFlow,
  useOnboardingFlow,
  type OnboardingProfileForm,
} from "@/stores/onboarding-flow";
import type { OnboardingIdentityValues, OnboardingProfileValues } from "@/lib/validators/onboarding";

import { OnboardingShell, type StepDescriptor } from "./onboarding-shell";
import { StepProfile } from "./step-profile";
import { StepLicenceGate } from "./step-licence-gate";
import { StepIdentity } from "./step-identity";
import { StepConsents } from "./step-consents";
import { StepSignature } from "./step-signature";

const STEPS: readonly StepDescriptor[] = [
  { index: 1, label: "Your details" },
  { index: 2, label: "Licence type" },
  { index: 3, label: "Identity docs" },
  { index: 4, label: "Read & accept" },
  { index: 5, label: "Sign" },
];

const STEP_TITLES: Record<number, { title: string; description?: string }> = {
  1: {
    title: "Tell us about yourself",
    description:
      "These are the details our staff will check at pickup, and that we'll use to contact you if anything comes up during your hire.",
  },
  2: {
    title: "Which licence will you use?",
    description: "We use a different document set for Australian and overseas drivers.",
  },
  3: {
    title: "Show us your identification",
    description:
      "Upload clear photos of the document(s) you'll bring to pickup. We'll cross-check them with the details you typed.",
  },
  4: {
    title: "Read & accept our policies",
    description:
      "Four short documents covering your hire. Open each one, scroll to the end, and tick the box.",
  },
  5: {
    title: "One signature, four documents",
    description:
      "Sign once below and we'll generate a signed PDF copy of every policy you just accepted.",
  },
};

export interface OnboardingWizardProps {
  next: string;
}

/**
 * Top-level client orchestrator for the customer onboarding flow.
 * Owns the persisted Zustand store, fetches `bootstrap` once on mount,
 * routes the active step into the right component, and triggers the
 * mutation chain on the final step.
 */
export function OnboardingWizard({ next }: OnboardingWizardProps) {
  const router = useRouter();
  const session = useSession();
  const utils = trpc.useUtils();
  const bootstrap = trpc.onboarding.bootstrap.useQuery(undefined, {
    staleTime: Infinity,
  });
  const updateProfile = trpc.onboarding.updateProfile.useMutation();
  const acceptConsents = trpc.onboarding.acceptConsents.useMutation();
  const generateSignedPdfs = trpc.onboarding.generateSignedPdfs.useMutation();
  const complete = trpc.onboarding.complete.useMutation();

  const flow = useOnboardingFlow();

  // Step-1 / Step-3 forms register their submit handler with these refs
  // so the shell's primary CTA can pick the right action per step.
  const profileSubmitRef = React.useRef<() => Promise<OnboardingProfileValues | null>>(
    async () => null,
  );
  const identitySubmitRef = React.useRef<() => Promise<OnboardingIdentityValues | null>>(
    async () => null,
  );
  const bindProfileSubmit = React.useCallback(
    (handler: () => Promise<OnboardingProfileValues | null>) => {
      profileSubmitRef.current = handler;
    },
    [],
  );
  const bindIdentitySubmit = React.useCallback(
    (handler: () => Promise<OnboardingIdentityValues | null>) => {
      identitySubmitRef.current = handler;
    },
    [],
  );

  // Seed profile defaults from bootstrap once the query lands. We only
  // overwrite empty fields so an in-progress wizard isn't clobbered.
  const seededRef = React.useRef(false);
  React.useEffect(() => {
    if (!bootstrap.data || seededRef.current) return;
    seededRef.current = true;
    const p = bootstrap.data.profile;
    if (!p) return;
    const patchProfile: Partial<OnboardingProfileForm> = {};
    const cur = flow.profile;
    if (!cur.dateOfBirth && p.dateOfBirth) patchProfile.dateOfBirth = p.dateOfBirth;
    if (!cur.addressLine1 && p.addressLine1) patchProfile.addressLine1 = p.addressLine1;
    if (!cur.addressLine2 && p.addressLine2) patchProfile.addressLine2 = p.addressLine2;
    if (!cur.suburb && p.suburb) patchProfile.suburb = p.suburb;
    if (!cur.state && p.state) patchProfile.state = p.state;
    if (!cur.postcode && p.postcode) patchProfile.postcode = p.postcode;
    if (!cur.country && p.country) patchProfile.country = p.country;
    if (!cur.emergencyContactName && p.emergencyContactName)
      patchProfile.emergencyContactName = p.emergencyContactName;
    if (!cur.emergencyContactPhone && p.emergencyContactPhone)
      patchProfile.emergencyContactPhone = p.emergencyContactPhone;
    if (!cur.emergencyContactRelationship && p.emergencyContactRelationship)
      patchProfile.emergencyContactRelationship = p.emergencyContactRelationship;
    if (!cur.phone && bootstrap.data.user.phone) patchProfile.phone = bootstrap.data.user.phone;
    if (Object.keys(patchProfile).length > 0) flow.setProfile(patchProfile);

    // Identity prefill.
    if (p.licenceType && !flow.identityPath) flow.setIdentityPath(p.licenceType);
    flow.setIdentity({
      licenceNumber: flow.identity.licenceNumber || p.licenceNumber || "",
      licenceState: flow.identity.licenceState || p.licenceState || "",
      licenceCountry: flow.identity.licenceCountry || p.licenceCountry || "",
      licenceExpiry: flow.identity.licenceExpiry || p.licenceExpiry || "",
      licenceClass: flow.identity.licenceClass || p.licenceClass || "",
      licenceImageFrontKey: flow.identity.licenceImageFrontKey || p.licenceImageFront || "",
      licenceImageBackKey: flow.identity.licenceImageBackKey || p.licenceImageBack || "",
      passportNumber: flow.identity.passportNumber || p.passportNumber || "",
      passportCountry: flow.identity.passportCountry || p.passportCountry || "",
      passportExpiry: flow.identity.passportExpiry || p.passportExpiry || "",
      passportImageKey: flow.identity.passportImageKey || p.passportImage || "",
    });
    flow.setConsents({
      marketingEmailOptIn: flow.consents.marketingEmailOptIn || p.marketingOptIn,
      marketingSmsOptIn: flow.consents.marketingSmsOptIn || p.marketingSmsOptIn,
    });
  }, [bootstrap.data, flow]);

  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  if (bootstrap.isLoading || !bootstrap.data) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (bootstrap.isError) {
    return (
      <div className="mx-auto max-w-md p-8 text-center">
        <p className="body-text text-destructive">Couldn&apos;t load onboarding. Please refresh.</p>
      </div>
    );
  }

  const fullName = `${bootstrap.data.user.firstName} ${bootstrap.data.user.lastName}`.trim();

  async function handlePrimary() {
    setError(null);
    if (flow.step === 1) {
      const values = await profileSubmitRef.current();
      if (!values) return;
      flow.setProfile(values);
      try {
        await updateProfile.mutateAsync({ profile: values });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't save your details.");
        return;
      }
      flow.next();
      return;
    }
    if (flow.step === 2) {
      if (!flow.identityPath) {
        setError("Please choose a licence type to continue.");
        return;
      }
      flow.next();
      return;
    }
    if (flow.step === 3) {
      const values = await identitySubmitRef.current();
      if (!values) return;
      flow.setIdentity({
        licenceNumber: values.licenceNumber,
        licenceState: values.licenceState ?? "",
        licenceCountry: values.licenceCountry ?? "",
        licenceExpiry: values.licenceExpiry,
        licenceClass: values.licenceClass,
        licenceImageFrontKey: values.licenceImageFrontKey,
        licenceImageBackKey: values.licenceImageBackKey,
        passportNumber: values.passportNumber,
        passportCountry: values.passportCountry,
        passportExpiry: values.passportExpiry,
        passportImageKey: values.passportImageKey,
      });
      try {
        await updateProfile.mutateAsync({ identity: values });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't save your documents.");
        return;
      }
      flow.next();
      return;
    }
    if (flow.step === 4) {
      const c = flow.consents;
      if (!c.acceptedTerms || !c.acceptedPrivacy || !c.acceptedCancellation || !c.acceptedMarketing) {
        setError("Please tick all four documents to continue.");
        return;
      }
      flow.next();
      return;
    }
    // Step 5: final submit chain
    if (!flow.signatureDataUrl) {
      setError("Please draw your signature before submitting.");
      return;
    }
    setSubmitting(true);
    try {
      await acceptConsents.mutateAsync({
        acceptedTerms: true,
        acceptedPrivacy: true,
        acceptedCancellation: true,
        acceptedMarketing: true,
        marketingEmailOptIn: flow.consents.marketingEmailOptIn,
        marketingSmsOptIn: flow.consents.marketingSmsOptIn,
      });
      await generateSignedPdfs.mutateAsync({
        signatureDataUrl: flow.signatureDataUrl,
      });
      await complete.mutateAsync();
      flushOnboardingFlow();
      // Drop the requiresOnboarding flag in the JWT, then route back.
      await session.update();
      // Best-effort cache invalidation so /dashboard reads fresh data.
      await utils.invalidate();
      router.push(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong submitting your onboarding.");
      setSubmitting(false);
    }
  }

  function handleSecondary() {
    if (flow.step > 1) flow.back();
  }

  const stepTitle = STEP_TITLES[flow.step] ?? { title: "" };

  return (
    <OnboardingShell
      steps={STEPS}
      currentStep={flow.step}
      title={stepTitle.title}
      description={stepTitle.description}
      primaryAction={{
        label:
          flow.step === 5
            ? submitting
              ? "Submitting…"
              : "Submit & generate PDFs"
            : "Continue",
        onClick: handlePrimary,
        disabled:
          (flow.step === 2 && !flow.identityPath) ||
          (flow.step === 5 && !flow.signatureDataUrl) ||
          submitting,
        pending: submitting,
      }}
      secondaryAction={
        flow.step > 1 ? { label: "Back", onClick: handleSecondary, disabled: submitting } : undefined
      }
    >
      {error ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {error}
        </div>
      ) : null}

      {flow.step === 1 ? (
        <StepProfile initialValues={flow.profile} bindSubmit={bindProfileSubmit} />
      ) : null}

      {flow.step === 2 ? (
        <StepLicenceGate value={flow.identityPath} onChange={flow.setIdentityPath} />
      ) : null}

      {flow.step === 3 && flow.identityPath ? (
        <StepIdentity
          identityPath={flow.identityPath}
          initialValues={flow.identity}
          bindSubmit={bindIdentitySubmit}
        />
      ) : null}

      {flow.step === 4 ? (
        <StepConsents
          docs={bootstrap.data.consentDocs}
          values={flow.consents}
          onChange={flow.setConsents}
        />
      ) : null}

      {flow.step === 5 ? (
        <StepSignature
          customerFullName={fullName}
          signatureDataUrl={flow.signatureDataUrl}
          onSignatureChange={flow.setSignature}
        />
      ) : null}
    </OnboardingShell>
  );
}
