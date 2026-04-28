"use client";

import { formatCurrency } from "@/lib/utils";

type Charge = {
  id: string;
  description: string;
  severity: string;
  resolution: "STANDARD" | "QUOTE_PENDING" | "WAIVED" | "WARRANTY";
  amount: number;
  quoteCapAmount: number | null;
  tariffName: string | null;
  staffNote: string | null;
};

export function ReturnChargesPage({ charges }: { charges: Charge[] }) {
  if (charges.length === 0) {
    return <p>No damage charges raised against this return.</p>;
  }
  return (
    <div className="space-y-4 text-sm">
      <p>The following damage lines have been identified. You will be asked to initial this page to acknowledge them.</p>
      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full">
          <thead className="bg-muted/40">
            <tr>
              <th className="px-3 py-2 text-left">Item</th>
              <th className="px-3 py-2 text-left">Severity</th>
              <th className="px-3 py-2 text-left">Resolution</th>
              <th className="px-3 py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {charges.map((c) => (
              <tr key={c.id}>
                <td className="px-3 py-2">
                  <div>{c.description}</div>
                  {c.tariffName && <div className="caption">{c.tariffName}</div>}
                  {c.staffNote && <div className="caption">{c.staffNote}</div>}
                </td>
                <td className="px-3 py-2">{c.severity.slice(0, 1) + c.severity.slice(1).toLowerCase()}</td>
                <td className="px-3 py-2">{c.resolution.replace("_", " ")}</td>
                <td className="px-3 py-2 text-right">
                  {c.resolution === "QUOTE_PENDING"
                    ? `up to ${formatCurrency(c.quoteCapAmount ?? 0)}`
                    : formatCurrency(c.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
