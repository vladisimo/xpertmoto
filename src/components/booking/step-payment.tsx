"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Info, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import {
  bookingCartSignature,
  DRAFT_TTL_MS,
  flushBookingWizard,
  useBookingWizard,
  type WizardDraft,
} from "@/stores/booking-wizard";
import { Button } from "@/components/ui/button";
import { QuoteSummary } from "./quote-summary";
import {
  StripePaymentForm,
  type StripePaymentFormHandle,
} from "./stripe-payment-form";
import { TERMS_VERSION } from "@/lib/consent-versions";
import { cn, formatCurrency } from "@/lib/utils";
import { useStepContinueAction } from "@/hooks/use-step-continue-action";
import { useWizardShellLayout } from "@/components/booking/wizard-shell-layout-context";
import { useRequiredIdImagesGuard } from "@/components/booking/use-required-id-images-guard";

type CreatedBooking = {
  booking: { id: string; bookingReference: string };
  paymentClientSecret: string | null;
  paymentIntentId: string | null;
  bondClientSecret: string | null;
  bondIntentId: string | null;
  stripeEnabled: boolean;
  payOnlineAmount: number;
  bondAmount: number;
};

/** Rehydrate the `created` state from a persisted wizard draft (H-4). */
function draftToCreated(d: WizardDraft): CreatedBooking {
  return {
    booking: { id: d.bookingId, bookingReference: d.bookingReference },
    paymentClientSecret: d.paymentClientSecret,
    paymentIntentId: d.paymentIntentId,
    bondClientSecret: d.bondClientSecret,
    bondIntentId: d.bondIntentId,
    stripeEnabled: d.stripeEnabled,
    payOnlineAmount: d.payOnlineAmount,
    bondAmount: d.bondAmount,
  };
}

export function StepPayment() {
  const w = useBookingWizard();
  const router = useRouter();
  // Desktop shell renders <QuoteSummary> in a sticky sidebar — only inline
  // it on mobile to avoid the duplicate "Your quote" card on desktop.
  const layout = useWizardShellLayout();
  const showInlineQuote = layout === "mobile";
  const [created, setCreated] = useState<CreatedBooking | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The card was charged but the confirm mutation failed (network drop,
  // transient server error). confirmPayment is idempotent server-side, so
  // retrying is safe and never double-charges — surface a dedicated
  // recovery panel instead of the generic card-error box.
  const [confirmFailed, setConfirmFailed] = useState(false);
  const lastPaidArgsRef = useRef<{
    paymentIntentId: string;
    bondPaymentIntentId?: string;
  } | null>(null);
  // Guards against re-firing handleStart() if React strict-mode or
  // re-renders cause the auto-start effect to run twice. Each step-6
  // mount creates at most one PaymentIntent.
  const autoStartedRef = useRef(false);
  // Imperative handle for the Stripe form so the wizard's mobile
  // bottom-bar CTA can drive the submit.
  const stripeFormRef = useRef<StripePaymentFormHandle>(null);
  const [stripeProcessing, setStripeProcessing] = useState(false);

  const createBooking = trpc.booking.create.useMutation();
  const confirmPayment = trpc.booking.confirmPayment.useMutation();
  const { missingImagesMessage, goBackToDetails, idGateReady } = useRequiredIdImagesGuard();

  async function handleStart() {
    if (
      !w.categoryId ||
      !w.pickupDepotId ||
      !w.returnDepotId ||
      !w.pickupDateTime ||
      !w.returnDateTime
    )
      return;
    setProcessing(true);
    setError(null);
    try {
      const res = await createBooking.mutateAsync({
        categoryId: w.categoryId,
        pickupDepotId: w.pickupDepotId,
        returnDepotId: w.returnDepotId,
        pickupDateTime: new Date(w.pickupDateTime),
        returnDateTime: new Date(w.returnDateTime),
        addons: w.addons,
        insuranceOptionId: w.insuranceOptionId ?? undefined,
        discountCode: w.discountCode || undefined,
        isDelivery: w.isDelivery,
        deliveryFee: w.deliveryFee,
        agreedToTerms: true,
        termsVersion: TERMS_VERSION,
        // H-4: hand the server our previous draft so it can retire it
        // instead of leaving an orphaned "Pending payment" row behind.
        draftBookingId: w.draft?.bookingId,
      });

      // Stub mode (no Stripe configured) — auto-confirm server-side as before.
      if (!res.stripeEnabled || !res.paymentClientSecret) {
        await confirmPayment.mutateAsync({
          bookingId: res.booking.id,
          paymentIntentId: res.paymentIntentId ?? undefined,
          bondPaymentIntentId: res.bondIntentId ?? undefined,
          preferredVehicleId: w.preferredVehicleId ?? undefined,
        });
        flushBookingWizard();
        router.push(`/booking/confirmation?ref=${res.booking.bookingReference}`);
        return;
      }

      // Real Stripe — hand off to the <StripePaymentForm> so the customer
      // can enter a card and confirm client-side. Persist the draft so a
      // refresh / back-forward reuses this booking + these PaymentIntents
      // instead of creating another orphaned draft (H-4).
      const created = res as CreatedBooking;
      w.setDraft({
        signature: bookingCartSignature(w),
        expiresAt: Date.now() + DRAFT_TTL_MS,
        bookingId: created.booking.id,
        bookingReference: created.booking.bookingReference,
        paymentClientSecret: created.paymentClientSecret,
        paymentIntentId: created.paymentIntentId,
        bondClientSecret: created.bondClientSecret,
        bondIntentId: created.bondIntentId,
        stripeEnabled: created.stripeEnabled,
        payOnlineAmount: created.payOnlineAmount,
        bondAmount: created.bondAmount,
      });
      setCreated(created);
      setProcessing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start payment");
      setProcessing(false);
    }
  }

  async function handlePaid(args: {
    paymentIntentId: string;
    bondPaymentIntentId?: string;
  }) {
    if (!created) return;
    lastPaidArgsRef.current = args;
    setProcessing(true);
    setError(null);
    try {
      await confirmPayment.mutateAsync({
        bookingId: created.booking.id,
        paymentIntentId: args.paymentIntentId,
        bondPaymentIntentId: args.bondPaymentIntentId,
        preferredVehicleId: w.preferredVehicleId ?? undefined,
      });
      flushBookingWizard();
      router.push(
        `/booking/confirmation?ref=${created.booking.bookingReference}`,
      );
    } catch (e) {
      setConfirmFailed(true);
      setError(e instanceof Error ? e.message : null);
      setProcessing(false);
    }
  }

  function retryConfirm() {
    if (lastPaidArgsRef.current) void handlePaid(lastPaidArgsRef.current);
  }

  // Drive the wizard's bottom-bar CTA on step 6: "Preparing payment…"
  // while we create the booking + PaymentIntents, then "Pay & confirm
  // $X" once the Stripe form is ready, calling its imperative submit.
  // If the customer has missing ID photos (deep-link / back-button bypass
  // of step 4), the CTA flips to "Back to your details" to send them
  // back to upload before we touch Stripe at all.
  const totalToday =
    (created?.payOnlineAmount ?? 0) + (created?.bondAmount ?? 0);
  const continueLabel = missingImagesMessage
    ? "Back to your details"
    : confirmFailed
      ? "Retry confirmation"
      : created
        ? `Pay & confirm ${formatCurrency(totalToday)}`
        : "Preparing payment…";
  const continueDisabled = missingImagesMessage || confirmFailed ? false : !created;
  const continuePending = missingImagesMessage
    ? false
    : processing || stripeProcessing;
  const handleContinueClick = useCallback(async () => {
    if (missingImagesMessage) {
      goBackToDetails();
      return;
    }
    if (confirmFailed) {
      retryConfirm();
      return;
    }
    await stripeFormRef.current?.submit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingImagesMessage, goBackToDetails, confirmFailed]);
  useStepContinueAction({
    label: continueLabel,
    disabled: continueDisabled,
    pending: continuePending,
    onClick: handleContinueClick,
  });

  // Auto-start on mount — step 6 is now a single screen that goes
  // straight into payment instead of the previous "click Continue,
  // then click again" two-stage flow. Discount code is collected on
  // step 5 (Review) and baked into the booking here.
  useEffect(() => {
    if (autoStartedRef.current) return;
    if (created || processing) return;
    // Wait for the profile to resolve before deciding — otherwise we'd
    // fire createBooking against a stale "no missing images" reading
    // taken while `me` is still loading, even though the customer is
    // actually missing photos.
    if (!idGateReady) return;
    // Don't fire createBooking if the ID-image gate is open — the server
    // eligibility check would reject it anyway, and the customer's path
    // back is to upload at step 4, not to retry payment.
    if (missingImagesMessage) return;
    if (
      !w.categoryId ||
      !w.pickupDepotId ||
      !w.returnDepotId ||
      !w.pickupDateTime ||
      !w.returnDateTime
    )
      return;
    autoStartedRef.current = true;
    // H-4: reuse a still-valid draft for an unchanged cart instead of firing
    // booking.create again — this is what stops refreshes / back-forwards on
    // step 6 from spawning orphaned "Pending payment" bookings.
    const draft = w.draft;
    if (
      draft &&
      draft.signature === bookingCartSignature(w) &&
      draft.stripeEnabled &&
      draft.paymentClientSecret &&
      Date.now() < draft.expiresAt
    ) {
      setCreated(draftToCreated(draft));
      return;
    }
    void handleStart();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingImagesMessage, idGateReady]);

  // Safety net for deep-link / back-forward arrivals on step 6 with the
  // ID-image gate still open. Renders a minimal block that nudges the
  // customer back to step 4 instead of spinning on "Preparing payment…"
  // (and we deliberately skip handleStart() above so no Stripe intents
  // get created).
  if (missingImagesMessage) {
    return (
      <div className="space-y-4">
        {layout === "desktop" && <h2 className="h2">Payment</h2>}
        {showInlineQuote && <CollapsedQuoteSummary />}
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <p className="flex items-start gap-2 font-medium">
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{missingImagesMessage}</span>
          </p>
          <p className="mt-2 text-muted-foreground">
            We need your photo ID on file before we can take payment. Head back
            to your details to upload, then return here to pay.
          </p>
        </div>
        {layout === "desktop" && (
          <div className="flex justify-between">
            <Button variant="outline" onClick={() => w.back()}>Back</Button>
            <Button variant="cta" onClick={goBackToDetails}>Back to your details</Button>
          </div>
        )}
      </div>
    );
  }

  // Card charged but confirmation failed — recovery panel. The card form
  // is deliberately NOT re-rendered: re-submitting Stripe against an
  // already-succeeded PaymentIntent would surface a bogus "payment
  // failed". Retrying the (idempotent) confirm mutation is the fix; the
  // Stripe webhook also confirms paid bookings server-side, so checking
  // "My bookings" a little later works too.
  if (created && confirmFailed) {
    return (
      <div className="space-y-4">
        {layout === "desktop" && <h2 className="h2">Payment</h2>}
        <div className="rounded-md border border-border bg-card p-4 text-sm">
          <p className="font-medium">
            Your payment was received — we just couldn&apos;t finish
            confirming the booking.
          </p>
          <p className="mt-2 text-muted-foreground">
            Booking reference{" "}
            <span className="font-semibold text-foreground">
              {created.booking.bookingReference}
            </span>
            . You have not been charged twice, and retrying is safe. If this
            keeps failing, your booking will still be confirmed automatically
            shortly — check My bookings, or contact us with the reference
            above.
          </p>
          {error && (
            <p className="mt-2 text-xs text-muted-foreground">{error}</p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {layout === "desktop" && (
              <Button variant="cta" onClick={retryConfirm} disabled={processing}>
                {processing ? "Retrying…" : "Try again"}
              </Button>
            )}
            <Button
              variant="outline"
              disabled={processing}
              onClick={() => {
                flushBookingWizard();
                router.push("/dashboard/bookings");
              }}
            >
              Go to my bookings
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Phase 2 — card entry step, shown once the booking + PaymentIntents
  // are created. Going "Back" from here would require cancelling the
  // PaymentIntent; for now we just let the user retry the card form.
  if (created) {
    return (
      <div className="space-y-3">
        {/* Render the heading only on desktop. With `hidden md:block` the
         *  element still counts as a preceding sibling for `space-y-*`,
         *  pushing the next child down by 24px on mobile — removing it
         *  from the mobile DOM tightens the gap above "Your quote". */}
        {layout === "desktop" && <h2 className="h2">Payment</h2>}
        {showInlineQuote && <CollapsedQuoteSummary />}
        <p className="text-xs text-muted-foreground">
          Your booking and price are held while you complete payment. If you
          don&apos;t finish, nothing is charged and the booking is released
          automatically.
        </p>
        <StripePaymentForm
          ref={stripeFormRef}
          paymentClientSecret={created.paymentClientSecret!}
          bondClientSecret={created.bondClientSecret}
          amountAud={created.payOnlineAmount}
          bondAmountAud={created.bondAmount}
          billingDetails={{
            name:
              [w.customer.firstName, w.customer.lastName]
                .filter(Boolean)
                .join(" ") || undefined,
            email: w.customer.email || undefined,
            phone: w.customer.phone || undefined,
          }}
          onSuccess={handlePaid}
          onCancel={() => {
            // Discard the in-progress PaymentIntents — the user can
            // re-create with a fresh click. The PaymentIntents will
            // auto-expire after 24h if never confirmed.
            setCreated(null);
          }}
          // Hide the inline Pay/Back row on mobile — the wizard's
          // bottom-bar CTA drives submit via stripeFormRef. Desktop
          // keeps the inline buttons because there's no bottom bar.
          hideActions={layout === "mobile"}
          onProcessingChange={setStripeProcessing}
        />
        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            <p className="font-medium">Something went wrong</p>
            <p className="mt-1">{error}</p>
          </div>
        )}
      </div>
    );
  }

  // Pre-Stripe state — auto-start kicks off as the user lands on step
  // 6, so this view is only seen briefly while the PaymentIntents are
  // being created, or as an error fallback if the create call fails.
  return (
    <div className="space-y-6">
      <h2 className="h2 hidden md:block">Payment</h2>
      {showInlineQuote && <CollapsedQuoteSummary />}
      {error ? (
        <>
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            <p className="font-medium">Something went wrong</p>
            <p className="mt-1">{error}</p>
            <p className="mt-2 text-muted-foreground">
              Please try again or go back to check your details. If this keeps
              happening, contact us for help.
            </p>
          </div>
          {layout === "desktop" && (
            <div className="flex justify-between">
              <Button
                variant="outline"
                onClick={() => w.back()}
                disabled={processing}
              >
                Back
              </Button>
              <Button
                variant="cta"
                onClick={() => {
                  autoStartedRef.current = true;
                  void handleStart();
                }}
                disabled={processing}
              >
                {processing ? "Starting…" : "Try again"}
              </Button>
            </div>
          )}
        </>
      ) : (
        <div className="flex items-center justify-center gap-2 rounded-md border border-border bg-muted/30 p-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Preparing your payment…
        </div>
      )}
    </div>
  );
}

/**
 * Collapsed-by-default quote summary for the mobile step-6 view. Shows a
 * one-line "Your quote — $X total" row that the customer can expand by
 * tapping; the full <QuoteSummary> reveals beneath. Keeps the payment
 * surface tight while still letting the customer double-check the
 * total before they enter their card.
 */
function CollapsedQuoteSummary() {
  const w = useBookingWizard();
  const [open, setOpen] = useState(false);
  const ready = !!(
    w.categoryId &&
    w.pickupDepotId &&
    w.returnDepotId &&
    w.pickupDateTime &&
    w.returnDateTime
  );
  const { data: quote } = trpc.booking.quote.useQuery(
    {
      categoryId: w.categoryId ?? "",
      vehicleId: w.preferredVehicleId ?? undefined,
      pickupDepotId: w.pickupDepotId ?? "",
      returnDepotId: w.returnDepotId ?? "",
      pickupDateTime: new Date(w.pickupDateTime ?? new Date()),
      returnDateTime: new Date(w.returnDateTime ?? new Date()),
      addons: w.addons,
      insuranceOptionId: w.insuranceOptionId ?? undefined,
      discountCode: w.discountCode || undefined,
      deliveryFee: w.deliveryFee,
    },
    { enabled: ready },
  );

  return (
    <div className="rounded-md border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <span className="text-sm font-medium">Your quote</span>
        <span className="flex items-center gap-2">
          {ready && quote && (
            <span className="text-sm font-semibold text-primary tabular-nums">
              {formatCurrency(quote.totalAmount)}
            </span>
          )}
          <ChevronDown
            className={cn(
              "h-4 w-4 text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
            aria-hidden
          />
        </span>
      </button>
      {open && (
        <div className="border-t border-border p-3">
          <QuoteSummary />
        </div>
      )}
    </div>
  );
}
