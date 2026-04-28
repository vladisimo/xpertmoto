"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { PageShell } from "@/components/layout/page-section";
import { LoadingBlock } from "@/components/ui/spinner";
import { formatCurrency } from "@/lib/utils";

/**
 * Phase E — customer "pay outstanding balance" page. Lists every
 * PENDING / FAILED charge grouped by booking, with a "Pay now" button
 * that hands off to Stripe Checkout (or the stub redirect in dev).
 */
export default function CustomerPayPage() {
  const { data, isLoading, refetch } = trpc.customer.outstandingBalance.useQuery();
  const createSession = trpc.customer.createPayNowSession.useMutation();
  const [busyFor, setBusyFor] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

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
