"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { getStripeClient } from "@/lib/stripe-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { PageShell } from "@/components/layout/page-section";
import { LoadingBlock } from "@/components/ui/spinner";
import { formatCurrency } from "@/lib/utils";

/**
 * Phase E — customer "pay outstanding balance" page. Lists every
 * PENDING / FAILED charge grouped by booking, with a "Pay now" button
 * that hands off to Stripe Checkout (or the stub redirect in dev), plus a
 * "complete card verification" section for off-session charges the issuer
 * bounced to 3DS (the emailed "action required" deep-links here).
 */
export default function CustomerPayPage() {
  const { data, isLoading, refetch } = trpc.customer.outstandingBalance.useQuery();
  const needsAuth = trpc.customer.paymentsRequiringAuthentication.useQuery();
  const createSession = trpc.customer.createPayNowSession.useMutation();
  const [busyFor, setBusyFor] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [authDone, setAuthDone] = useState<string[]>([]);

  async function payBooking(paymentIds: string[], key: string) {
    setErr(null);
    setBusyFor(key);
    try {
      const res = await createSession.mutateAsync({ paymentIds });
      window.location.href = res.url;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not start payment");
      setBusyFor(null);
    }
  }

  async function completeAuthentication(paymentId: string, clientSecret: string) {
    setErr(null);
    setBusyFor(`auth-${paymentId}`);
    try {
      const stripe = await getStripeClient();
      if (!stripe) throw new Error("Payments are unavailable right now — try again shortly.");
      // The PI already carries the saved card; only the 3DS challenge runs.
      const result = await stripe.confirmCardPayment(clientSecret);
      if (result.error) throw new Error(result.error.message ?? "Verification failed");
      if (result.paymentIntent?.status !== "succeeded") {
        throw new Error(`Verification not completed (${result.paymentIntent?.status ?? "unknown"})`);
      }
      // The payment_intent.succeeded webhook flips the Payment row + balance.
      setAuthDone((d) => [...d, paymentId]);
      await Promise.all([refetch(), needsAuth.refetch()]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Verification failed");
    } finally {
      setBusyFor(null);
    }
  }

  if (isLoading) {
    return (
      <PageShell className="max-w-3xl">
        <PageHeader title="Outstanding charges" />
        <LoadingBlock padded="lg" />
      </PageShell>
    );
  }

  const hasAny = data && data.count > 0;

  return (
    <PageShell className="max-w-3xl">
      <PageHeader
        title="Outstanding charges"
        description={
          hasAny
            ? `You have ${formatCurrency(data!.total)} across ${data!.count} charge${data!.count === 1 ? "" : "s"} waiting to be settled.`
            : "You're all caught up — no outstanding charges."
        }
      />

      {err && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {err}
        </div>
      )}

      {(needsAuth.data?.filter((p) => !authDone.includes(p.paymentId)).length ?? 0) > 0 && (
        <Card className="border-amber-500/40">
          <CardHeader>
            <CardTitle className="h3">Card verification needed</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              Your bank asked for an extra verification step on these charges.
              Confirming takes a few seconds — no card details needed.
            </p>
            {needsAuth.data!
              .filter((p) => !authDone.includes(p.paymentId))
              .map((p) => (
                <div key={p.paymentId} className="flex items-center justify-between gap-3">
                  <span>
                    {p.bookingReference ?? p.reference} —{" "}
                    <strong className="tabular-nums">{formatCurrency(p.amount)}</strong>
                  </span>
                  <Button
                    size="sm"
                    disabled={busyFor === `auth-${p.paymentId}`}
                    onClick={() => completeAuthentication(p.paymentId, p.clientSecret)}
                  >
                    {busyFor === `auth-${p.paymentId}` ? "Verifying…" : "Verify & pay"}
                  </Button>
                </div>
              ))}
          </CardContent>
        </Card>
      )}

      {hasAny &&
        Object.entries(data!.byBooking).map(([key, group]) => (
          <Card key={key}>
            <CardHeader>
              <CardTitle className="h3">{group.bookingReference}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span>Amount outstanding</span>
                <strong className="tabular-nums">{formatCurrency(group.total)}</strong>
              </div>
              <Button
                disabled={busyFor === key}
                onClick={() => payBooking(group.paymentIds, key)}
              >
                {busyFor === key ? "Redirecting…" : "Pay now"}
              </Button>
            </CardContent>
          </Card>
        ))}

      {!hasAny && (
        <Button onClick={() => refetch()} variant="secondary">
          Refresh
        </Button>
      )}
    </PageShell>
  );
}
