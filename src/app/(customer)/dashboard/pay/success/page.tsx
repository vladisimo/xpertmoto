"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { trpc } from "@/lib/trpc/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { PageShell } from "@/components/layout/page-section";

/**
 * Phase E — Stripe Checkout success landing page. Reads the
 * comma-separated payment ids from the ?ids= param and marks them
 * SUCCEEDED in our DB. The charge.succeeded webhook stays the
 * canonical source of truth; this just gives the customer instant
 * feedback instead of a blank "you've been charged" page.
 */
export default function PaySuccessPage() {
  const params = useSearchParams();
  const router = useRouter();
  const ids = (params.get("ids") ?? "").split(",").filter(Boolean);
  const markComplete = trpc.customer.markPayNowComplete.useMutation();
  const [state, setState] = useState<"marking" | "done" | "error">("marking");

  useEffect(() => {
    if (ids.length === 0) {
      setState("done");
      return;
    }
    markComplete
      .mutateAsync({ paymentIds: ids })
      .then(() => setState("done"))
      .catch(() => setState("error"));
  }, [ids.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <PageShell className="max-w-2xl">
      <PageHeader title="Payment received" />
      <Card>
        <CardHeader>
          <CardTitle className="h3">
            {state === "marking" && "Confirming your payment…"}
            {state === "done" && "Thanks — payment confirmed."}
            {state === "error" && "We received your payment."}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p className="text-muted-foreground">
            {state === "error"
              ? "We weren't able to immediately update your outstanding charges, but Stripe has the payment on file. Your account will reconcile within a few minutes."
              : "Your outstanding charges have been settled. A receipt is on its way to your email."}
          </p>
          <div className="flex gap-2">
            <Button asChild>
              <Link href="/dashboard">Back to dashboard</Link>
            </Button>
            <Button asChild variant="secondary" onClick={() => router.refresh()}>
              <Link href="/dashboard/pay">View charges</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </PageShell>
  );
}
