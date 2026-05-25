import { expect } from "@playwright/test";
import type { Api } from "./api";

/**
 * Pricing oracle helpers. The booking wizard's QuoteSummary and these helpers
 * both call the public `booking.quote` procedure (src/server/services/pricing.ts
 * is the canonical engine), so a spec can fetch the authoritative quote here and
 * assert the rendered UI matches it field-for-field — plus check the structural
 * invariants the engine must always satisfy (GST = total / 11, breakdown sums).
 */

export type QuoteInput = {
  categoryId: string;
  vehicleId?: string;
  pickupDepotId: string;
  returnDepotId: string;
  pickupDateTime: Date;
  returnDateTime: Date;
  addons?: Array<{ addonId: string; quantity: number }>;
  insuranceOptionId?: string;
  discountCode?: string;
  deliveryFee?: number;
};

export type Quote = Awaited<ReturnType<Api["booking"]["quote"]["query"]>>;

/** First active depot + first bookable category — the seed exposes exactly one of each. */
export async function bookingRefData(api: Api): Promise<{
  depotId: string;
  depotName: string;
  categoryId: string;
  categoryName: string;
}> {
  const [depots, categories] = await Promise.all([
    api.depot.list.query(),
    api.vehicle.listCategories.query(),
  ]);
  const depot = depots[0];
  const category = categories[0];
  if (!depot || !category) throw new Error("seed is missing a depot or bookable category");
  return {
    depotId: depot.id,
    depotName: depot.name,
    categoryId: category.id,
    categoryName: category.name,
  };
}

/** A pickup→return window `days` long, starting at 10:00 a few days out (inside depot hours). */
export function quoteWindow(days: number, startInDays = 3): { pickupDateTime: Date; returnDateTime: Date } {
  const pickup = new Date();
  pickup.setDate(pickup.getDate() + startInDays);
  pickup.setHours(10, 0, 0, 0);
  const ret = new Date(pickup);
  ret.setDate(ret.getDate() + days);
  return { pickupDateTime: pickup, returnDateTime: ret };
}

export function fetchQuote(api: Api, input: QuoteInput): Promise<Quote> {
  return api.booking.quote.query(input);
}

/** Round half-up to cents, matching src/lib/money.ts. */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Structural invariants the pricing engine must always satisfy, independent of
 * the rate card. Catches drift in GST, the pay-now split, or breakdown sums.
 */
export function assertQuoteInvariants(quote: Quote): void {
  // GST is divide-by-11 of the GST-inclusive total (CLAUDE.md rule #1), to the cent.
  expect(round2(quote.gstAmount)).toBeCloseTo(round2(quote.totalAmount / 11), 2);

  // The "Pay now" breakdown rows sum to the pay-now figure.
  if (quote.payOnlineBreakdown.length > 0) {
    const sum = quote.payOnlineBreakdown.reduce((acc, li) => acc + li.amount, 0);
    expect(round2(sum)).toBeCloseTo(round2(quote.payOnlineAmount), 2);
  }

  // Nothing is negative, and the bond is never folded into the charge.
  expect(quote.totalAmount).toBeGreaterThan(0);
  expect(quote.payOnlineAmount).toBeGreaterThanOrEqual(0);
  expect(quote.bondAmount).toBeGreaterThanOrEqual(0);

  // For a standard (non long-term) hire, pay-now + pay-at-pickup === total.
  if (!quote.isLongTerm) {
    expect(round2(quote.payOnlineAmount + quote.remainderDueAtPickup)).toBeCloseTo(
      round2(quote.totalAmount),
      2,
    );
  }
}

/** AUD formatting matching src/lib/utils#formatCurrency, for asserting rendered text. */
export function formatAud(n: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
  }).format(n);
}
