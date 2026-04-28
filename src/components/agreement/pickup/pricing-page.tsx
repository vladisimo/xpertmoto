"use client";

import { formatCurrency } from "@/lib/utils";

type Money = number | string | { toString(): string };
type BookingForPricing = {
  durationDays: number;
  category: { name: string };
  subtotal: Money;
  addonTotal: Money;
  insuranceTotal: Money;
  discountAmount: Money;
  gstAmount: Money;
  totalAmount: Money;
  bondAmount: Money;
  addons: { addon: { name: string }; quantity: number; totalPrice: Money }[];
  insurance: { insuranceOption: { name: string; excessAmount: Money }; totalPrice: Money }[];
};

export function PricingPage({ booking }: { booking: BookingForPricing }) {
  const subtotal = Number(booking.subtotal);
  const insurance = Number(booking.insuranceTotal);
  const discount = Number(booking.discountAmount);
  const gst = Number(booking.gstAmount);
  const total = Number(booking.totalAmount);
  const bond = Number(booking.bondAmount);
  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="px-3 py-2 text-left">Item</th>
              <th className="px-3 py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            <tr>
              <td className="px-3 py-2">
                {booking.category.name} · {booking.durationDays} day(s)
              </td>
              <td className="px-3 py-2 text-right">{formatCurrency(subtotal)}</td>
            </tr>
            {booking.addons.map((a, i) => (
              <tr key={`a-${i}`}>
                <td className="px-3 py-2">
                  {a.addon.name} × {a.quantity}
                </td>
                <td className="px-3 py-2 text-right">{formatCurrency(Number(a.totalPrice))}</td>
              </tr>
            ))}
            {insurance > 0 && (
              <tr>
                <td className="px-3 py-2">
                  Insurance
                  {booking.insurance[0]
                    ? ` — ${booking.insurance[0].insuranceOption.name} (excess ${formatCurrency(
                        Number(booking.insurance[0].insuranceOption.excessAmount),
                      )})`
                    : ""}
                </td>
                <td className="px-3 py-2 text-right">{formatCurrency(insurance)}</td>
              </tr>
            )}
            {discount > 0 && (
              <tr>
                <td className="px-3 py-2">Discount</td>
                <td className="px-3 py-2 text-right">-{formatCurrency(discount)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="ml-auto max-w-sm space-y-1 text-sm">
        <div className="flex justify-between">
          <span>Subtotal (ex GST)</span>
          <span>{formatCurrency(total - gst)}</span>
        </div>
        <div className="flex justify-between">
          <span>GST 10%</span>
          <span>{formatCurrency(gst)}</span>
        </div>
        <div className="flex justify-between border-t-2 border-primary pt-1 text-base font-semibold">
          <span>Total (AUD)</span>
          <span>{formatCurrency(total)}</span>
        </div>
      </div>
      <div className="rounded-md border-l-4 border-amber-500 bg-amber-50 p-3 text-sm">
        A refundable <strong>bond of {formatCurrency(bond)}</strong> is held against your card. It may be applied to
        damage, late fees, fuel shortfall, cleaning, infringements or insurance excess. Unused portions are released
        within 14 days of return.
      </div>
    </div>
  );
}
