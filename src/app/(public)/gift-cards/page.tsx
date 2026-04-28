"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useBranding } from "@/components/shared/branding-provider";

const AMOUNTS = [50, 100, 250, 500];

export default function GiftCardsPage() {
  const { siteName } = useBranding();
  const [amount, setAmount] = useState<number>(100);
  const [purchaserEmail, setPurchaserEmail] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [message, setMessage] = useState("");
  const [issued, setIssued] = useState<{ code: string; amount: number } | null>(null);

  const purchase = trpc.giftCard.purchase.useMutation({
    onSuccess: (res) => {
      setIssued({ code: res.code, amount });
    },
  });

  return (
    <div className="container space-y-10 py-12">
      <div className="space-y-2 max-w-2xl">
        <p className="eyebrow">Gift a ride</p>
        <h1 className="h-display">{`${siteName} gift cards`}</h1>
        <p className="text-body text-muted-foreground">
          The perfect present for a friend visiting the Gold Coast, Byron or Noosa.
          Redeemable against any scooter rental, addon, or insurance upgrade. Valid
          for 3 years.
        </p>
      </div>

      {issued ? (
        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle>🎉 Gift card ready</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-body">
              We&apos;ve emailed <strong>{recipientEmail}</strong> with their new
              A${issued.amount.toFixed(2)} {siteName} gift card.
            </p>
            <div className="rounded-md border-2 border-dashed border-primary bg-accent/10 p-4 text-center">
              <p className="eyebrow">Code</p>
              <p className="text-2xl font-semibold tracking-widest text-primary font-mono">
                {issued.code}
              </p>
            </div>
            <Button variant="secondary" onClick={() => setIssued(null)}>
              Send another
            </Button>
          </CardContent>
        </Card>
      ) : (
        <form
          className="grid gap-8 lg:grid-cols-2 max-w-5xl"
          onSubmit={(e) => {
            e.preventDefault();
            purchase.mutate({
              amount,
              purchaserEmail,
              recipientEmail,
              recipientName: recipientName || undefined,
              personalMessage: message || undefined,
            });
          }}
        >
          <Card>
            <CardHeader>
              <CardTitle>Amount</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {AMOUNTS.map((a) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => setAmount(a)}
                    className={`rounded-md border p-3 text-sm font-semibold transition ${
                      amount === a
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-input hover:bg-muted"
                    }`}
                  >
                    A${a}
                  </button>
                ))}
              </div>
              <div>
                <label className="eyebrow" htmlFor="custom-amount">
                  Or custom
                </label>
                <Input
                  id="custom-amount"
                  type="number"
                  min={25}
                  max={2000}
                  value={amount}
                  onChange={(e) => setAmount(Number(e.target.value))}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="eyebrow">Your email</label>
                <Input
                  type="email"
                  required
                  value={purchaserEmail}
                  onChange={(e) => setPurchaserEmail(e.target.value)}
                />
              </div>
              <div>
                <label className="eyebrow">Recipient email</label>
                <Input
                  type="email"
                  required
                  value={recipientEmail}
                  onChange={(e) => setRecipientEmail(e.target.value)}
                />
              </div>
              <div>
                <label className="eyebrow">Recipient name (optional)</label>
                <Input
                  value={recipientName}
                  onChange={(e) => setRecipientName(e.target.value)}
                />
              </div>
              <div>
                <label className="eyebrow">Personal message (optional)</label>
                <textarea
                  className="w-full rounded-md border border-input bg-background p-2 text-sm"
                  rows={3}
                  maxLength={500}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />
              </div>
              <Button
                type="submit"
                variant="cta"
                size="lg"
                disabled={purchase.isPending || !purchaserEmail || !recipientEmail}
              >
                {purchase.isPending ? "Processing…" : `Send A$${amount.toFixed(2)} gift card`}
              </Button>
              {purchase.error ? (
                <p className="text-destructive text-caption">{purchase.error.message}</p>
              ) : null}
            </CardContent>
          </Card>
        </form>
      )}

      <section className="rounded-lg border bg-muted/30 p-6 max-w-3xl">
        <h2 className="h3">How it works</h2>
        <ol className="list-decimal pl-5 space-y-1 text-caption text-muted-foreground mt-3">
          <li>Choose an amount and enter the recipient&apos;s email.</li>
          <li>Secure payment via Stripe.</li>
          <li>
            We email a unique code (scheduled send supported) along with a friendly
            note.
          </li>
          <li>
            Recipient applies the code at booking checkout. Partial redemption is
            supported.
          </li>
        </ol>
      </section>
    </div>
  );
}
