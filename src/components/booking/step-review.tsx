"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { Info } from "lucide-react";
import { useSession } from "next-auth/react";
import { useBookingWizard } from "@/stores/booking-wizard";
import { QuoteSummary } from "./quote-summary";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldError } from "./field-error";
import { useStepContinueAction } from "@/hooks/use-step-continue-action";
import { useWizardShellLayout } from "@/components/booking/wizard-shell-layout-context";
import { useRequiredIdImagesGuard } from "@/components/booking/use-required-id-images-guard";
import { trackEvent } from "@/lib/analytics/track";
import { trpc } from "@/lib/trpc/client";

export function StepReview() {
  const w = useBookingWizard();
  const layout = useWizardShellLayout();
  const [attempted, setAttempted] = useState(false);
  const [platformTermsAgreed, setPlatformTermsAgreed] = useState(false);
  const [platformPrivacyAgreed, setPlatformPrivacyAgreed] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);
  const { missingImagesMessage, goBackToDetails } = useRequiredIdImagesGuard();
  const { status: sessionStatus } = useSession();
  // Only authenticated customers have a profile to read consent from. Step 5
  // is reachable in the wizard's authenticated branch, but guard explicitly
  // so the query doesn't fire on a logged-out path (404s the request).
  const consentQuery = trpc.customer.consentStatus.useQuery(undefined, {
    enabled: sessionStatus === "authenticated",
  });
  const acceptPlatformConsent = trpc.customer.acceptPlatformConsent.useMutation();
  // Fires DISCOUNT_ATTEMPTED at most once per unique code — same guard
  // pattern as the previous step-payment implementation.
  const lastAttemptedCode = useRef<string>("");

  // True once we know the customer is missing platform-level consent (T&Cs
  // and/or Privacy). Customers who already accepted the current versions
  // (e.g. fresh registrations from Step 4) skip the block entirely. While
  // the query is loading we don't render the block — avoids a flash of the
  // gate that resolves into "not needed".
  const consent = consentQuery.data;
  const needsTerms = !!consent && !consent.hasTerms;
  const needsPrivacy = !!consent && !consent.hasPrivacy;
  const showConsentBlock = needsTerms || needsPrivacy;

  async function handleContinue() {
    if (missingImagesMessage) {
      goBackToDetails();
      return;
    }
    if (!w.agreedToTerms) {
      setAttempted(true);
      return;
    }
    if (showConsentBlock) {
      if ((needsTerms && !platformTermsAgreed) || (needsPrivacy && !platformPrivacyAgreed)) {
        setAttempted(true);
        return;
      }
      try {
        setConsentError(null);
        await acceptPlatformConsent.mutateAsync({
          acceptedTerms: true,
          acceptedPrivacy: true,
        });
      } catch (e) {
        setConsentError(
          e instanceof Error
            ? e.message
            : "Could not record your consent. Please try again.",
        );
        return;
      }
    }
    w.next();
  }

  useStepContinueAction({
    label: "Continue to payment",
    disabled: false,
    pending: acceptPlatformConsent.isPending,
    onClick: handleContinue,
  });

  return (
    <div className="space-y-6">
      <h2 className="h2 hidden md:block">Review & terms</h2>
      {layout === "mobile" && <QuoteSummary />}
      {missingImagesMessage && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <Info className="h-4 w-4 shrink-0" aria-hidden />
          <span className="flex-1">{missingImagesMessage}</span>
          <Button type="button" size="sm" variant="secondary" onClick={goBackToDetails}>
            Back to your details
          </Button>
        </div>
      )}
      <div className="border rounded-lg p-4 space-y-2">
        <div className="text-sm font-semibold">Discount code (optional)</div>
        <Input
          placeholder="Enter code"
          value={w.discountCode}
          onChange={(e) => w.set("discountCode", e.target.value)}
          onBlur={(e) => {
            const code = e.target.value.trim();
            if (code && code !== lastAttemptedCode.current) {
              lastAttemptedCode.current = code;
              trackEvent({
                kind: "DISCOUNT_ATTEMPTED",
                target: "booking-discount-input",
                value: code,
              });
            }
          }}
        />
      </div>

      <div className="border rounded-lg p-4 text-sm space-y-2">
        <div className="font-semibold">Cancellation policy</div>
        <ul className="list-disc ml-5 text-muted-foreground">
          <li>More than 72 hours before pickup: full refund less $25 admin fee</li>
          <li>24–72 hours: 50% refund</li>
          <li>Less than 24 hours / no-show: no refund</li>
        </ul>
      </div>
      <div className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
        This is the provisional booking agreement. The full rental agreement — including the vehicle's pre-hire
        condition report, per-page initials and signatures — is signed with staff on a tablet at pickup.
      </div>
      {showConsentBlock && (
        <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
          <div className="text-sm">
            <div className="font-semibold">Platform terms &amp; privacy</div>
            <p className="mt-1 text-muted-foreground">
              Before you book, please accept the platform terms and privacy policy.
            </p>
          </div>
          {needsTerms && (
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                checked={platformTermsAgreed}
                onChange={(e) => setPlatformTermsAgreed(e.target.checked)}
                className="mt-1"
              />
              <span>
                I agree to the{" "}
                <Link href="/terms" target="_blank" className="text-primary underline">
                  Terms &amp; Conditions
                </Link>
                .
              </span>
            </label>
          )}
          {needsPrivacy && (
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                checked={platformPrivacyAgreed}
                onChange={(e) => setPlatformPrivacyAgreed(e.target.checked)}
                className="mt-1"
              />
              <span>
                I have read the{" "}
                <Link href="/privacy" target="_blank" className="text-primary underline">
                  Privacy Policy
                </Link>
                .
              </span>
            </label>
          )}
          {attempted &&
            ((needsTerms && !platformTermsAgreed) ||
              (needsPrivacy && !platformPrivacyAgreed)) && (
              <FieldError message="Please accept the platform terms and privacy policy to proceed." />
            )}
          {consentError && <FieldError message={consentError} />}
        </div>
      )}
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          checked={w.agreedToTerms}
          onChange={(e) => w.set("agreedToTerms", e.target.checked)}
          className="mt-1"
        />
        <span>
          I accept the <Link href="/terms" className="text-primary underline">terms &amp; conditions</Link>,
          cancellation and bond policy, subject to the full signed agreement at pickup.
        </span>
      </label>
      {attempted && !w.agreedToTerms && (
        <FieldError message="Please accept the terms and conditions to proceed to payment." />
      )}
      {layout === "desktop" && (
        <div className="flex justify-between">
          <Button variant="outline" onClick={() => w.back()} disabled={acceptPlatformConsent.isPending}>
            Back
          </Button>
          <Button onClick={handleContinue} disabled={acceptPlatformConsent.isPending}>
            Continue to payment
          </Button>
        </div>
      )}
    </div>
  );
}
