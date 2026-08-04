"use client";

import { useRef, useState } from "react";
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
 * Card-entry step for a gift-card purchase. The purchase mutation creates the
 * card in PENDING and returns a PaymentIntent client secret; this form
 * confirms it, and the payment_intent.succeeded webhook activates the card
 * and emails the recipient. Mirrors the booking wizard's StripePaymentForm
 * minus the bond leg.
 */
type Props = {
  clientSecret: string;
  amountAud: number;
  purchaserEmail: string;
  onSuccess: () => void;
  onCancel: () => void;
};

export function GiftCardPaymentForm(props: Props) {
  const stripePromise = getStripeClient();
  return (
    <Elements
      stripe={stripePromise}
      options={{ clientSecret: props.clientSecret, appearance: { theme: "stripe" } }}
    >
      <InnerForm {...props} />
    </Elements>
  );
}

function InnerForm({ amountAud, purchaserEmail, onSuccess, onCancel }: Props) {
  const stripe = useStripe();
  const elements = useElements();
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Synchronous double-submit guard — same rationale as the booking form:
  // a fast second click can land before React re-renders the disabled state.
  const inFlightRef = useRef(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setProcessing(true);
    setError(null);
    try {
      const result = await stripe.confirmPayment({
        elements,
        redirect: "if_required",
        confirmParams: {
          return_url: `${window.location.origin}/gift-cards`,
          payment_method_data: {
            billing_details: { email: purchaserEmail },
          },
        },
      });
      if (result.error) throw result.error;
      if (result.paymentIntent?.status !== "succeeded") {
        throw new Error(
          `Payment not completed (status: ${result.paymentIntent?.status ?? "unknown"})`,
        );
      }
      onSuccess();
    } catch (err) {
      const message =
        (err as StripeError)?.message ??
        (err instanceof Error ? err.message : "Payment failed");
      setError(message);
      inFlightRef.current = false;
      setProcessing(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="border rounded-lg p-4 bg-background">
        <Label className="mb-2 block text-sm font-medium">Card details</Label>
        <PaymentElement
          options={{
            layout: "tabs",
            paymentMethodOrder: ["card"],
            terms: { card: "never" },
            defaultValues: { billingDetails: { email: purchaserEmail } },
            fields: { billingDetails: { email: "never" } },
          }}
        />
        <p className="mt-3 text-xs italic text-muted-foreground">
          By providing your card information, you allow us to charge your card
          for the gift card amount shown below.
        </p>
      </div>

      <div className="rounded-md border border-emerald-600/30 bg-emerald-50 p-3 text-sm dark:border-emerald-400/30 dark:bg-emerald-500/10">
        <div className="flex justify-between">
          <span className="font-medium">Pay now</span>
          <span className="font-semibold tabular-nums">{formatCurrency(amountAud)}</span>
        </div>
        <div className="text-xs text-muted-foreground">Charged to your card today</div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="flex justify-between">
        <Button type="button" variant="outline" onClick={onCancel} disabled={processing}>
          Back
        </Button>
        <Button type="submit" variant="cta" disabled={!stripe || !elements || processing}>
          {processing ? "Processing…" : "Pay & send gift card"}
        </Button>
      </div>
    </form>
  );
}
