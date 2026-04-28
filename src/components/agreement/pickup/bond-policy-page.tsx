"use client";

import { formatCurrency } from "@/lib/utils";

type Money = number | string | { toString(): string };

export function BondPolicyPage({ booking }: { booking: { bondAmount: Money } }) {
  const bond = Number(booking.bondAmount);
  return (
    <div className="space-y-4 text-sm leading-relaxed">
      <section>
        <h4 className="mb-1 text-sm font-semibold">Bond</h4>
        <ul className="ml-5 list-disc space-y-1">
          <li>
            A refundable security bond of <strong>{formatCurrency(bond)}</strong> is held against your card at the start of the hire.
          </li>
          <li>The bond may be applied to damage, late-return fees, fuel shortfall, cleaning, infringements, and insurance excess.</li>
          <li>Any unused portion of the bond is released within 14 days of return.</li>
        </ul>
      </section>
      <section>
        <h4 className="mb-1 text-sm font-semibold">Cancellation</h4>
        <ul className="ml-5 list-disc space-y-1">
          <li>More than 72 hours before pickup — full refund less $25 administration fee.</li>
          <li>Between 24 and 72 hours — 50% refund.</li>
          <li>Less than 24 hours, or no-show — no refund; a $50 no-show fee may apply.</li>
        </ul>
      </section>
    </div>
  );
}
