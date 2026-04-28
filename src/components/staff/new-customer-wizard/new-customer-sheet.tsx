"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { trpc } from "@/lib/trpc/client";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { WizardProgress } from "@/components/shared/wizard-progress";
import {
  DEFAULTS,
  WIZARD_STEPS,
  wizardSchema,
  type WizardFormValues,
  type WizardStepKey,
} from "./wizard-types";
import { StepIdentity } from "./step-identity";
import { StepDetails } from "./step-details";
import { StepConsent } from "./step-consent";
import { StepFinalise } from "./step-finalise";
import { StepReview } from "./step-review";

const STEP_ORDER: WizardStepKey[] = WIZARD_STEPS.map((s) => s.key);

/** Which form fields each step "owns" — used to validate before advancing. */
const STEP_FIELDS: Record<WizardStepKey, (keyof WizardFormValues)[]> = {
  identity: [],
  details: [
    "firstName",
    "lastName",
    "email",
    "dateOfBirth",
    "addressLine1",
    "suburb",
    "state",
    "postcode",
    "isInternational",
    "passportImage",
  ],
  consent: ["signedConsents"],
  finalise: [],
  review: [],
};

export function NewCustomerSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const util = trpc.useUtils();
  const create = trpc.staffCustomer.createDetailed.useMutation();
  const [stepIndex, setStepIndex] = React.useState(0);
  const [submitError, setSubmitError] = React.useState<string | null>(null);

  const form = useForm<WizardFormValues>({
    resolver: zodResolver(wizardSchema),
    defaultValues: DEFAULTS,
    mode: "onBlur",
  });

  const currentStep = STEP_ORDER[stepIndex]!;
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === STEP_ORDER.length - 1;

  const close = React.useCallback(
    (next: boolean) => {
      if (!next) {
        form.reset(DEFAULTS);
        setStepIndex(0);
        setSubmitError(null);
      }
      onOpenChange(next);
    },
    [form, onOpenChange],
  );

  async function goNext() {
    const fields = STEP_FIELDS[currentStep];
    if (fields.length > 0) {
      const ok = await form.trigger(fields);
      if (!ok) return;
    }
    if (currentStep === "consent") {
      const consents = form.getValues("signedConsents");
      if (consents.length < 4) {
        form.setError("signedConsents", {
          type: "manual",
          message: "All four consent documents must be signed before continuing.",
        });
        return;
      }
    }
    setStepIndex((i) => Math.min(i + 1, STEP_ORDER.length - 1));
  }

  function goBack() {
    setStepIndex((i) => Math.max(i - 1, 0));
  }

  async function onSubmit(values: WizardFormValues) {
    setSubmitError(null);
    try {
      const termsSigned = values.signedConsents.some((c) => c.docKey === "TERMS");
      const privacySigned = values.signedConsents.some((c) => c.docKey === "PRIVACY");
      const created = await create.mutateAsync({
        firstName: values.firstName,
        lastName: values.lastName,
        email: values.email,
        phone: values.phone || undefined,
        dateOfBirth: values.dateOfBirth || undefined,
        addressLine1: values.addressLine1 || undefined,
        addressLine2: values.addressLine2 || undefined,
        suburb: values.suburb || undefined,
        state: values.state || undefined,
        postcode: values.postcode || undefined,
        country: values.country || undefined,
        isInternational: values.isInternational,
        licenceNumber: values.licenceNumber || undefined,
        licenceState: values.licenceState || undefined,
        licenceClass: values.licenceClass || undefined,
        licenceExpiry: values.licenceExpiry || undefined,
        licenceImageFront: values.licenceImageFront || undefined,
        licenceImageBack: values.licenceImageBack || undefined,
        passportNumber: values.passportNumber || undefined,
        passportCountry: values.passportCountry || undefined,
        passportExpiry: values.passportExpiry || undefined,
        passportImage: values.passportImage || undefined,
        emergencyContactName: values.emergencyContactName || undefined,
        emergencyContactPhone: values.emergencyContactPhone || undefined,
        emergencyContactRelationship: values.emergencyContactRelationship || undefined,
        termsAccepted: termsSigned,
        privacyAccepted: privacySigned,
        marketingEmailOptIn: values.marketingEmailOptIn,
        marketingSmsOptIn: values.marketingSmsOptIn,
        staffNote: values.staffNote || undefined,
        documents: values.documents.map((d) => ({
          type: d.type,
          fileUrl: d.fileUrl,
          label: d.label || undefined,
          expiryDate: d.expiryDate || undefined,
        })),
        signatureImage: values.signatureKey || undefined,
        customerPhotoUrl: values.customerPhotoUrl || undefined,
        signedConsents: values.signedConsents,
      });
      await Promise.all([
        util.staffCustomer.list.invalidate(),
        util.staffCustomer.stats.invalidate(),
      ]);
      // Navigate BEFORE closing so `close()` resetting form state doesn't
      // race with the router transition. `router.refresh()` ensures the
      // server-rendered `/staff/customers/[id]` page picks up the row we
      // just created instead of rendering from a stale RSC cache.
      router.push(`/staff/customers/${created.id}`);
      router.refresh();
      close(false);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Failed to create customer");
    }
  }

  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetContent
        side="right"
        className="flex w-full flex-col p-0 sm:max-w-[900px]"
      >
        <SheetHeader className="shrink-0 border-b px-6 py-5">
          <SheetTitle>New customer</SheetTitle>
          <SheetDescription>
            Drop an ID to pre-fill details, hand the tablet over for consent, then
            photo + final files.
          </SheetDescription>
        </SheetHeader>

        <div className="shrink-0 border-b">
          <WizardProgress
            steps={WIZARD_STEPS}
            current={stepIndex + 1}
            onStepClick={(n) => setStepIndex(n - 1)}
          />
        </div>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="flex-1 space-y-6 overflow-y-auto px-6 py-6">
              {currentStep === "identity" && <StepIdentity />}
              {currentStep === "details" && <StepDetails />}
              {currentStep === "consent" && <StepConsent />}
              {currentStep === "finalise" && <StepFinalise />}
              {currentStep === "review" && <StepReview />}

              {submitError && (
                <p className="text-sm text-destructive">{submitError}</p>
              )}
            </div>

            <WizardFooter
              isFirst={isFirst}
              isLast={isLast}
              onBack={goBack}
              onNext={goNext}
              onCancel={() => close(false)}
              isPending={create.isPending || form.formState.isSubmitting}
            />
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}

function WizardFooter({
  isFirst,
  isLast,
  onBack,
  onNext,
  onCancel,
  isPending,
}: {
  isFirst: boolean;
  isLast: boolean;
  onBack: () => void;
  onNext: () => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  return (
    <div className="flex shrink-0 justify-between gap-2 border-t px-6 py-4">
      <Button type="button" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
      <div className="flex items-center gap-2">
        {!isFirst && (
          <Button type="button" variant="secondary" onClick={onBack}>
            <ChevronLeft className="h-4 w-4" />
            Back
          </Button>
        )}
        {isLast ? (
          <Button type="submit" disabled={isPending}>
            {isPending ? "Creating…" : "Create customer & send welcome"}
          </Button>
        ) : (
          <Button type="button" onClick={onNext}>
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

