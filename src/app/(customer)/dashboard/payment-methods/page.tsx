"use client";

import { useState, type FormEvent } from "react";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import type { StripeError } from "@stripe/stripe-js";
import { trpc } from "@/lib/trpc/client";
import { getStripeClient } from "@/lib/stripe-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { PageShell } from "@/components/layout/page-section";
import { LoadingBlock } from "@/components/ui/spinner";

// Baked at build time by Next.js. When absent, Stripe.js can't load, so we
// fall back to the dev-stub flow — matches the server-side stub gate in
// src/lib/stripe.ts so dev environments without Stripe credentials remain
// end-to-end usable.
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;

/**
 * Phase D — stored payment methods. The customer can see the card we have
 * on file (brand + last 4 + expiry only; no PAN ever leaves Stripe), start
 * the "Add card" SetupIntent flow, and remove the current card.
 *
 * Two modes:
 *  - Live Stripe: createSetupIntent returns a real clientSecret driving
 *    <Elements> + <PaymentElement>; on confirmSetup we extract the
 *    resulting payment_method id and call savePaymentMethod, which the
 *    server attaches to the Stripe Customer and persists on
 *    CustomerProfile (with brand/last4/expiry fetched off the real card).
 *  - Stub: when the publishable key is missing client-side or the server's
 *    STRIPE_SECRET_KEY is missing (clientSecret comes back as
 *    cs_seti_stub_*), we generate a deterministic pm_stub_* id so the
 *    portal still walks through the persistence shape end-to-end.
 */
export default function PaymentMethodsPage() {
  const { data: pm, isLoading, refetch } = trpc.customer.paymentMethod.useQuery();
  const createSetup = trpc.customer.createSetupIntent.useMutation();
  const save = trpc.customer.savePaymentMethod.useMutation({ onSuccess: () => refetch() });
  const remove = trpc.customer.removePaymentMethod.useMutation({ onSuccess: () => refetch() });

  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);

  async function startAddCard() {
    setErr(null);
    setAdding(true);
    try {
      const intent = await createSetup.mutateAsync();
      const isStubSecret = intent.clientSecret.startsWith("cs_seti_stub_");
      if (PUBLISHABLE_KEY && !isStubSecret) {
        setClientSecret(intent.clientSecret);
      } else {
        // Server didn't return a real SetupIntent (or we have no
        // publishable key to mount Elements with) — exercise the
        // persistence shape with a stub PM id so the dev UI stays usable.
        const stubPmId = `pm_stub_${Date.now()}`;
        await save.mutateAsync({ paymentMethodId: stubPmId });
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not start card setup");
    } finally {
      setAdding(false);
    }
  }

  async function handleSavedFromElements(paymentMethodId: string) {
    try {
      await save.mutateAsync({ paymentMethodId });
      setClientSecret(null);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save card");
    }
  }

  function cancelAddCard() {
    setClientSecret(null);
    setErr(null);
  }

  return (
    <PageShell className="max-w-2xl">
      <PageHeader
        title="Payment methods"
        description="Your card on file — used for booking extensions, return settlement, and long-term rental billing."
      />

      <Card>
        <CardHeader>
          <CardTitle className="h3">Card on file</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {isLoading ? (
            <LoadingBlock padded="sm" />
          ) : pm ? (
            <div className="space-y-3">
              <div className="rounded-md border bg-muted/30 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold">
                      {pm.brand?.toUpperCase() ?? "CARD"} •• {pm.last4 ?? "••••"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Expires {String(pm.expMonth ?? "—").padStart(2, "0")}/
                      {String(pm.expYear ?? "——").slice(-2)}
                    </div>
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate()}
                  >
                    {remove.isPending ? "Removing…" : "Remove"}
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                We&apos;ll charge this card automatically for recurring rental payments, end-of-hire
                charges, and post-rental infringements. You can remove it any time.
              </p>
            </div>
          ) : clientSecret ? (
            <AddCardForm
              clientSecret={clientSecret}
              onSaved={handleSavedFromElements}
              onCancel={cancelAddCard}
              onError={setErr}
            />
          ) : (
            <div className="space-y-3">
              <p className="text-muted-foreground">No card on file yet.</p>
              <Button onClick={startAddCard} disabled={adding}>
                {adding ? "Starting…" : "Add a card"}
              </Button>
              {!PUBLISHABLE_KEY && (
                <p className="caption">
                  Stripe Elements confirmation is stubbed in this environment. Configure{" "}
                  <code>STRIPE_SECRET_KEY</code> and{" "}
                  <code>NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY</code> to enable the live Stripe Setup
                  flow.
                </p>
              )}
            </div>
          )}
          {err && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {err}
            </div>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}

type AddCardFormProps = {
  clientSecret: string;
  onSaved: (paymentMethodId: string) => Promise<void>;
  onCancel: () => void;
  onError: (message: string) => void;
};

function AddCardForm({ clientSecret, onSaved, onCancel, onError }: AddCardFormProps) {
  return (
    <Elements
      stripe={getStripeClient()}
      options={{ clientSecret, appearance: { theme: "stripe" } }}
    >
      <AddCardInner onSaved={onSaved} onCancel={onCancel} onError={onError} />
    </Elements>
  );
}

function AddCardInner({
  onSaved,
  onCancel,
  onError,
}: Omit<AddCardFormProps, "clientSecret">) {
  const stripe = useStripe();
  const elements = useElements();
  const [processing, setProcessing] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setProcessing(true);
    try {
      // SetupIntent confirm — no charge, just saves the card against the
      // Stripe Customer for off-session use later. redirect:"if_required"
      // keeps simple card flows on-page; 3DS-modal cards resolve in-page,
      // and the rare full-redirect challenge returns to this URL.
      const result = await stripe.confirmSetup({
        elements,
        redirect: "if_required",
        confirmParams: {
          return_url: `${window.location.origin}/dashboard/payment-methods`,
        },
      });
      if (result.error) throw result.error;
      const si = result.setupIntent;
      if (!si || si.status !== "succeeded") {
        throw new Error(`Card setup did not complete (status: ${si?.status ?? "unknown"})`);
      }
      const paymentMethodId =
        typeof si.payment_method === "string"
          ? si.payment_method
          : si.payment_method?.id;
      if (!paymentMethodId) {
        throw new Error("Stripe did not return a payment method id");
      }
      await onSaved(paymentMethodId);
    } catch (err) {
      const message =
        (err as StripeError)?.message ??
        (err instanceof Error ? err.message : "Could not save card");
      onError(message);
      setProcessing(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="rounded-md border bg-background p-4">
        <PaymentElement
          options={{
            layout: "tabs",
            paymentMethodOrder: ["card"],
            terms: { card: "never" },
          }}
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={processing}>
          Cancel
        </Button>
        <Button type="submit" disabled={!stripe || !elements || processing}>
          {processing ? "Saving…" : "Save card"}
        </Button>
      </div>
    </form>
  );
}
