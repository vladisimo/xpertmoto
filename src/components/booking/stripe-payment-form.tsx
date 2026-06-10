"use client";

import * as React from "react";
import { useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import type { StripeError } from "@stripe/stripe-js";
import { getStripeClient } from "@/lib/stripe-client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { formatCurrency } from "@/lib/utils";

/**
 * Real Stripe payment capture for the booking wizard.
 *
 * Two PaymentIntents are involved:
 *   1. `paymentClientSecret` — the rental charge (auto-capture, `succeeded`
 *      on success).
 *   2. `bondClientSecret` — the bond authorisation (capture_method=manual,
 *      `requires_capture` on success so we can capture/cancel later).
 *
 * Single card entry: `<PaymentElement />` collects the card for the rental
 * charge; once that confirms, we reuse the attached PaymentMethod to
 * confirm the bond hold without a second card form. This is why the
 * callback shape is `{ paymentIntentId, bondPaymentIntentId? }`.
 */

/**
 * Imperative handle exposed via the forwarded ref. Lets step-payment
 * trigger a Stripe submit from the wizard's mobile bottom-bar without
 * mounting an inline submit button.
 */
export type StripePaymentFormHandle = {
  submit: () => Promise<void>;
};

type Props = {
  paymentClientSecret: string;
  bondClientSecret?: string | null;
  amountAud: number;
  bondAmountAud?: number;
  /** Billing details collected on Step 4. Forwarded to PaymentElement
   *  via `defaultValues` and to Stripe via `payment_method_data` on
   *  confirm — the email/name fields are then suppressed inside the
   *  card form so the Link "Save my info" panel collapses. */
  billingDetails?: {
    name?: string;
    email?: string;
    phone?: string;
  };
  onSuccess: (args: {
    paymentIntentId: string;
    bondPaymentIntentId?: string;
  }) => void;
  onCancel: () => void;
  /** Hide the inline Back/Pay row — used when an external CTA (the
   *  mobile bottom bar) drives the submit via the imperative handle. */
  hideActions?: boolean;
  /** Notifies the parent when the form's processing state changes,
   *  so an external CTA can show its own pending spinner. */
  onProcessingChange?: (processing: boolean) => void;
};

export const StripePaymentForm = React.forwardRef<StripePaymentFormHandle, Props>(
  function StripePaymentForm(props, ref) {
    const stripePromise = getStripeClient();
    return (
      <Elements
        stripe={stripePromise}
        options={{
          clientSecret: props.paymentClientSecret,
          appearance: { theme: "stripe" },
        }}
      >
        <InnerForm {...props} apiRef={ref} />
      </Elements>
    );
  },
);

function InnerForm({
  paymentClientSecret: _paymentClientSecret,
  bondClientSecret,
  amountAud,
  bondAmountAud,
  billingDetails,
  onSuccess,
  onCancel,
  hideActions,
  onProcessingChange,
  apiRef,
}: Props & { apiRef?: React.Ref<StripePaymentFormHandle> }) {
  const stripe = useStripe();
  const elements = useElements();
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep the latest submit closure on a ref so the imperative handle
  // can call into fresh state without re-binding the api object every
  // render. Updated in an effect (see below) so we don't write to a
  // ref during render — keeps the React Compiler lint rule happy.
  const submitRef = useRef<() => Promise<void>>(async () => {});

  // Synchronous double-submit guard. The `processing` state disables the
  // button, but a fast second click (or bottom-bar CTA tap) can land in
  // the ~100ms before React re-renders — a second confirmPayment against
  // an already-succeeded PaymentIntent surfaces a bogus "Payment failed"
  // even though the card was charged. A ref flips synchronously.
  const inFlightRef = useRef(false);

  async function runSubmit() {
    if (!stripe || !elements) return;
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setProcessing(true);
    setError(null);
    try {
      // Confirm the rental charge first. `redirect: "if_required"` keeps
      // the user on this page for card-only methods; a bank-redirect-style
      // method would navigate away with `return_url` (we don't offer any
      // such methods today but keep the return_url defensively).
      const rental = await stripe.confirmPayment({
        elements,
        redirect: "if_required",
        confirmParams: {
          return_url: `${window.location.origin}/booking/confirmation`,
          // We suppress the name/email fields inside PaymentElement
          // (see `fields.billingDetails` below), so we MUST pass the
          // equivalent values here or Stripe rejects the confirm.
          payment_method_data: {
            billing_details: {
              name: billingDetails?.name,
              email: billingDetails?.email,
              phone: billingDetails?.phone,
            },
          },
        },
      });
      if (rental.error) throw rental.error;
      const rentalPi = rental.paymentIntent;
      if (!rentalPi || rentalPi.status !== "succeeded") {
        throw new Error(
          `Payment not completed (status: ${rentalPi?.status ?? "unknown"})`,
        );
      }
      const paymentMethodId =
        typeof rentalPi.payment_method === "string"
          ? rentalPi.payment_method
          : rentalPi.payment_method?.id;

      // Confirm the bond hold with the same card — authorisation only,
      // Stripe returns `requires_capture` on success.
      let bondPaymentIntentId: string | undefined;
      if (bondClientSecret && paymentMethodId) {
        const bond = await stripe.confirmCardPayment(bondClientSecret, {
          payment_method: paymentMethodId,
        });
        if (bond.error) throw bond.error;
        if (bond.paymentIntent?.status !== "requires_capture") {
          throw new Error(
            `Bond authorisation failed (status: ${bond.paymentIntent?.status ?? "unknown"})`,
          );
        }
        bondPaymentIntentId = bond.paymentIntent.id;
      } else if (bondClientSecret && !paymentMethodId) {
        // Shouldn't happen — Stripe always returns a payment_method after a
        // successful confirmation. Surface clearly if it ever does.
        throw new Error(
          "Bond hold could not be processed — payment method missing from confirmation.",
        );
      }

      onSuccess({ paymentIntentId: rentalPi.id, bondPaymentIntentId });
    } catch (err) {
      const message =
        (err as StripeError)?.message ??
        (err instanceof Error ? err.message : "Payment failed");
      setError(message);
      // Re-arm only on failure — after a successful charge the form must
      // never submit again (the parent swaps to confirm/recovery UI).
      inFlightRef.current = false;
      setProcessing(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await runSubmit();
  }

  // Mirror runSubmit onto the ref used by the imperative handle.
  useEffect(() => {
    submitRef.current = runSubmit;
  });

  // Imperative submit() invoked by the wizard's mobile bottom-bar CTA.
  // Stable handle — `submitRef.current` always points at the latest
  // runSubmit closure thanks to the effect above.
  useImperativeHandle(apiRef, () => ({ submit: () => submitRef.current() }), []);

  // Surface the processing flag so the parent's external CTA can show
  // its own pending spinner.
  useEffect(() => {
    onProcessingChange?.(processing);
  }, [processing, onProcessingChange]);

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="border rounded-lg p-4 bg-background">
        <Label className="mb-2 block text-sm font-medium">Card details</Label>
        <PaymentElement
          options={{
            layout: "tabs",
            paymentMethodOrder: ["card"],
            // Stripe's own legal copy can't be styled from outside its
            // iframe, so suppress it here and render our own italicised,
            // smaller disclosure below the form (see <p> further down).
            terms: { card: "never" },
            // Prefill from Step 4 so the Link "Save my info for faster
            // checkout" panel renders with name/email/phone already
            // populated rather than as an empty form.
            defaultValues: {
              billingDetails: {
                name: billingDetails?.name,
                email: billingDetails?.email,
                phone: billingDetails?.phone,
              },
            },
            // Suppress the name + email fields entirely — we already
            // collected them on Step 4 and we forward them via
            // `payment_method_data.billing_details` on confirm. With
            // no email field inside PaymentElement, Stripe Link's
            // "Save my information" lookup collapses.
            fields: {
              billingDetails: { name: "never", email: "never" },
            },
          }}
        />
        <p className="mt-3 text-xs italic text-muted-foreground">
          By providing your card information, you allow us to charge your
          card for the rental and authorise a separate hold for the
          refundable bond, per the terms and conditions accepted on the
          previous step.
        </p>
      </div>

      <div className="rounded-md border border-emerald-600/30 bg-emerald-50 p-3 text-sm dark:border-emerald-400/30 dark:bg-emerald-500/10">
        <div className="flex justify-between">
          <span className="font-medium">Pay now</span>
          <span className="font-semibold tabular-nums">{formatCurrency(amountAud)}</span>
        </div>
        <div className="text-xs text-muted-foreground">Charged to your card today</div>
      </div>

      {bondAmountAud && bondAmountAud > 0 && (
        <div className="rounded-md border border-sky-600/30 bg-sky-50 p-3 text-sm dark:border-sky-400/30 dark:bg-sky-500/10">
          <div className="flex justify-between">
            <span className="font-medium text-sky-800 dark:text-sky-200">
              Refundable bond (authorisation hold)
            </span>
            <span className="font-semibold tabular-nums text-sky-800 dark:text-sky-200">
              {formatCurrency(bondAmountAud)}
            </span>
          </div>
          <div className="text-xs text-sky-700/80 dark:text-sky-300/80">
            Held on your card — not charged. Released after the vehicle is
            returned. While held, this amount reduces your card&apos;s
            available balance.
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {!hideActions && (
        <div className="flex justify-between">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={processing}
          >
            Back
          </Button>
          <Button type="submit" variant="cta" disabled={!stripe || !elements || processing}>
            {processing ? "Processing…" : "Pay & confirm"}
          </Button>
        </div>
      )}
    </form>
  );
}
