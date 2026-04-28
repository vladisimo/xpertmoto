"use client";

import { useBranding } from "@/components/shared/branding-provider";
import { formatCurrency } from "@/lib/utils";

type PendingCharge = { id: string; description: string; quoteCapAmount: number | null };

export function QuoteAckPage({ charges }: { charges: PendingCharge[] }) {
  const { siteName } = useBranding();
  return (
    <div className="space-y-4 text-sm">
      <p className="rounded-md border-l-4 border-amber-500 bg-amber-50 p-3">
        I acknowledge that the items below require a mechanic&apos;s quote. I authorise {siteName} to charge my payment
        method on file for the confirmed repair cost <strong>up to the cap</strong> shown beside each item, once the
        mechanic&apos;s quote is finalised. Any amount above the cap will not be charged without my further agreement.
      </p>
      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full">
          <thead className="bg-muted/40">
            <tr>
              <th className="px-3 py-2 text-left">Item</th>
              <th className="px-3 py-2 text-right">Acknowledged cap</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {charges.map((c) => (
              <tr key={c.id}>
                <td className="px-3 py-2">{c.description}</td>
                <td className="px-3 py-2 text-right">{formatCurrency(c.quoteCapAmount ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
