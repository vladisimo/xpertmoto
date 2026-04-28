"use client";

import { CreditCard, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";

type Props = {
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
};

function expiryMonthsAway(month: number, year: number): number {
  const now = new Date();
  const cardEndsAt = new Date(Date.UTC(year, month, 1)); // first of month after expiry
  return (cardEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24 * 30);
}

export function CardOnFileCard({ brand, last4, expMonth, expYear }: Props) {
  const hasCard = !!(brand && last4 && expMonth && expYear);
  const monthsLeft =
    hasCard && expMonth && expYear ? expiryMonthsAway(expMonth, expYear) : null;
  const status =
    monthsLeft === null
      ? ("PENDING" as const)
      : monthsLeft < 0
        ? ("FAILED" as const)
        : monthsLeft < 1
          ? ("FAILED" as const)
          : monthsLeft < 3
            ? ("PENDING" as const)
            : ("ACTIVE" as const);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="h3 flex items-center gap-2">
          <CreditCard className="h-4 w-4" aria-hidden />
          Card on file
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!hasCard ? (
          <div className="text-muted-foreground">
            No card saved yet. A card is saved automatically when you complete
            your next booking.
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-medium uppercase">{brand}</span>
                <span className="text-muted-foreground">•••• {last4}</span>
              </div>
              <div className="text-muted-foreground">
                Expires {String(expMonth).padStart(2, "0")}/{expYear}
              </div>
            </div>

            <div className="flex items-center justify-between text-xs">
              <StatusBadge status={status} />
              {monthsLeft !== null && monthsLeft < 3 && monthsLeft >= 0 && (
                <span className="flex items-center gap-1 text-destructive">
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                  Expires in {Math.max(0, Math.round(monthsLeft * 30))} days — please update before
                  your next booking
                </span>
              )}
              {monthsLeft !== null && monthsLeft < 0 && (
                <span className="flex items-center gap-1 text-destructive">
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                  Card has expired
                </span>
              )}
            </div>

            <p className="text-xs text-muted-foreground">
              Your card is stored securely by Stripe — we never see the full
              number. It auto-updates when your bank reissues it via the Card
              Updater service.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
