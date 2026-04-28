import type {
  PrismaClient,
  VehicleCategory,
  InsuranceOption,
  BillingFrequency,
  OnlinePaymentStrategy,
  PricingTier,
} from "@prisma/client";
import { Prisma } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { GST_RATE } from "@/lib/constants";
import { lookupOrComputeMultiplier } from "./yield-pricing";
import {
  aud,
  roundCents,
  gstFromInclusive,
  subtotalExGst as subExGstDecimal,
  sum,
  times,
  divide,
  applyPercentage,
  multiply,
  gt,
  max,
  toNumber,
} from "@/lib/money";

export type PricingAddonSelection = { addonId: string; quantity: number };

export type PricingInput = {
  categoryId: string;
  /** Optional: when allocated, a vehicle's own PricingTier ladder overrides
   *  the category-level ladder. Not set from the public wizard (vehicle is
   *  allocated at check-out) but set by extension and swap flows. */
  vehicleId?: string;
  pickupDateTime: Date;
  returnDateTime: Date;
  addons?: PricingAddonSelection[];
  insuranceOptionId?: string;
  discountCode?: string;
  // C5: when the two differ the quote looks up OneWayFee and either adds
  // the configured fee or throws if the pair is disallowed.
  pickupDepotId?: string;
  returnDepotId?: string;
  isOneWay?: boolean;
  deliveryFee?: number;
};

/** Which pricing cascade produced the base subtotal:
 *  - `TIERED` — progressive PricingTier ladder (replaces duration discount)
 *  - `FLAT`   — legacy daily/weekly/monthly rate + hardcoded 10%/25% ladder
 */
export type PricingMethod = "TIERED" | "FLAT";

export type PricingLineItem = {
  label: string;
  amount: number;
  qty?: number;
  unit?: number;
};

export type PricingQuote = {
  durationDays: number;
  baseRate: number;
  baseSubtotal: number;
  seasonMultiplier: number;
  /** Lever 1: demand/yield multiplier applied after season, before duration discount. */
  yieldMultiplier: number;
  durationDiscountPct: number;
  /** Which cascade produced baseSubtotal — see PricingMethod. When TIERED,
   *  durationDiscountPct is always 0 (tier ladder replaces the flat
   *  duration-discount rule). */
  pricingMethod: PricingMethod;
  discountAmount: number;
  addonTotal: number;
  insuranceTotal: number;
  deliveryFee: number;
  oneWayFee: number;
  subtotalExGst: number;
  gstAmount: number;
  totalAmount: number;
  bondAmount: number;
  lineItems: PricingLineItem[];

  // Phase A1 — strategy-driven split between what's paid during the
  // online wizard and what's collected at pickup. The bond is always
  // authorised online on top of payOnlineAmount (it's held, not
  // captured, so it's not part of the rental total). For a FULL
  // strategy: payOnlineAmount = totalAmount, remainderDueAtPickup = 0.
  onlinePaymentStrategy: OnlinePaymentStrategy;
  payOnlineAmount: number;
  remainderDueAtPickup: number;

  // Phase A2 — populated only when durationDays >= longTermMinDays on
  // the selected category (i.e. a progressive billing plan is created).
  // firstPeriodAmount is the portion of totalAmount covering the first
  // billing period and is included in payOnlineAmount. The job charges
  // `recurringAmount` every `recurringFrequency` for `recurringPeriodsTotal`
  // subsequent periods until the return date.
  isLongTerm: boolean;
  recurringFrequency: BillingFrequency | null;
  recurringAmount: number;
  recurringPeriodsTotal: number;
  firstPeriodAmount: number;
};

export class OneWayDisallowedError extends Error {
  readonly code = "ONE_WAY_DISALLOWED";
  constructor(fromName: string, toName: string) {
    super(
      `One-way rentals between ${fromName} and ${toName} are not available. Please return the vehicle to the pickup depot.`,
    );
    this.name = "OneWayDisallowedError";
  }
}

export function calcDurationDays(
  pickup: Date,
  ret: Date,
  timezone: string = "Australia/Brisbane",
): number {
  // Wall-clock duration in the depot's timezone — NOT elapsed UTC ms —
  // so a 24h rental that crosses a DST boundary counts as 1 day, not
  // 0.96 or 1.04. QLD has no DST (UTC+10 year-round); NSW/VIC/TAS/SA/ACT
  // do. Pass the correct depot timezone to get this right.
  const ms = wallClockElapsedMs(pickup, ret, timezone);
  return Math.max(1, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

/**
 * Wall-clock elapsed ms between two instants in `timezone`. For AEDT→AEST
 * fall-back (first Sunday in April), elapsed UTC ms is 25h for a 24h
 * wall-clock span; this normaliser strips the extra hour out so pricing
 * doesn't double-charge for a clock-change.
 */
export function wallClockElapsedMs(
  a: Date,
  b: Date,
  timezone: string = "Australia/Brisbane",
): number {
  // wall_b - wall_a = (utc_b + offset_b) - (utc_a + offset_a)
  //                 = utc_elapsed + (offset_b - offset_a)
  // Spring-forward: offsetB > offsetA → adds the hour back.
  // Fall-back:      offsetB < offsetA → subtracts the duplicated hour.
  const offsetA = tzOffsetMinutes(a, timezone);
  const offsetB = tzOffsetMinutes(b, timezone);
  const offsetDeltaMs = (offsetB - offsetA) * 60 * 1000;
  return b.getTime() - a.getTime() + offsetDeltaMs;
}

function tzOffsetMinutes(d: Date, timezone: string): number {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  const asUTC = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return (asUTC - d.getTime()) / (60 * 1000);
}

// Internal: full-precision base rate calculation kept as Decimal end-to-end.
// Prior version used `Number(...) / 7` which lost precision for weekly rates
// that don't divide evenly (e.g. $279 / 7 = $39.8571428571... in IEEE-754).
function chooseBaseRateDecimal(cat: VehicleCategory, days: number): Prisma.Decimal {
  if (days >= 28) return divide(cat.baseMonthlyRate, 30);
  if (days >= 7) return divide(cat.baseWeeklyRate, 7);
  return aud(cat.baseDailyRate);
}

function durationDiscountPct(days: number): number {
  if (days >= 30) return 0.25;
  if (days >= 7) return 0.1;
  return 0;
}

/** Operator-controlled pricing levers. Both default to `true` so an
 *  unseeded SystemSetting row preserves historical behaviour. Read off the
 *  passed-in `prisma` so test fakes that omit `systemSetting` (every error
 *  is caught) and production clients use the same path. */
type PricingFlags = { yieldEnabled: boolean; durationDiscountEnabled: boolean };

async function readPricingFlags(prisma: PrismaClient): Promise<PricingFlags> {
  try {
    const rows = await prisma.systemSetting.findMany({
      where: {
        key: { in: ["pricing.yieldEnabled", "pricing.durationDiscountEnabled"] },
      },
    });
    const byKey = new Map(rows.map((r) => [r.key, r.value as unknown]));
    const yieldEnabled = byKey.get("pricing.yieldEnabled");
    const durationDiscountEnabled = byKey.get("pricing.durationDiscountEnabled");
    return {
      yieldEnabled: typeof yieldEnabled === "boolean" ? yieldEnabled : true,
      durationDiscountEnabled:
        typeof durationDiscountEnabled === "boolean" ? durationDiscountEnabled : true,
    };
  } catch {
    return { yieldEnabled: true, durationDiscountEnabled: true };
  }
}

/** Look up the active PricingTier ladder for a booking. Vehicle-scoped tiers
 *  override category-scoped tiers when present. Returns null when neither
 *  scope has any active tiers — the caller falls back to the legacy
 *  daily/weekly/monthly + durationDiscountPct cascade. */
export async function resolvePricingTiers(
  prisma: PrismaClient,
  categoryId: string,
  vehicleId?: string,
): Promise<PricingTier[] | null> {
  if (vehicleId) {
    const vehicleTiers = await prisma.pricingTier.findMany({
      where: { vehicleId, isActive: true },
      orderBy: { minDays: "asc" },
    });
    if (vehicleTiers.length > 0) return vehicleTiers;
  }
  const categoryTiers = await prisma.pricingTier.findMany({
    where: { categoryId, isActive: true },
    orderBy: { minDays: "asc" },
  });
  return categoryTiers.length > 0 ? categoryTiers : null;
}

/** Progressive ("tax-bracket") tier total for a booking of `days` days.
 *
 *  Walks the ladder in order. For each tier the booking fully spans, pays
 *  the full `tierTotal`. For the last tier (partial), pays pro-rata at
 *  `tierTotal / tierLength` × daysInTier. If the booking exceeds the last
 *  tier's maxDays, the overflow days are priced at the last tier's effective
 *  per-day rate — this gives operators a sensible default for over-runs
 *  without requiring an explicit open-ended tier.
 *
 *  Example (1-2 @ $500, 3-7 @ $1197, 8-14 @ $1080):
 *   - 14 days → $500 + $1197 + $1080 = $2,777 (all three tiers full)
 *   - 13 days → $500 + $1197 + (6 × $154.2857…) ≈ $2,622.71
 *
 *  Precondition: tiers are sorted by minDays ascending, contiguous, and
 *  the first tier starts at minDays=1. These invariants are enforced at
 *  the tRPC input layer — we do not re-validate here for performance. */
export function computeProgressiveTierTotal(
  tiers: PricingTier[],
  days: number,
): Prisma.Decimal {
  if (tiers.length === 0 || days <= 0) return aud(0);
  let total = aud(0);
  let remaining = days;
  for (const tier of tiers) {
    if (remaining <= 0) break;
    const tierLength = tier.maxDays - tier.minDays + 1;
    const daysInTier = Math.min(remaining, tierLength);
    if (daysInTier >= tierLength) {
      total = sum(total, aud(tier.tierTotal));
    } else {
      const perDay = divide(tier.tierTotal, tierLength);
      total = sum(total, times(perDay, daysInTier));
    }
    remaining -= daysInTier;
  }
  if (remaining > 0) {
    const last = tiers[tiers.length - 1]!;
    const lastLength = last.maxDays - last.minDays + 1;
    const lastPerDay = divide(last.tierTotal, lastLength);
    total = sum(total, times(lastPerDay, remaining));
  }
  return total;
}

// Phase A1 — number of days that count as "one billing period" for a given
// frequency. Used both to compute the first-period portion of the total and
// to derive the number of recurring charges.
export function periodLengthDays(frequency: BillingFrequency): number {
  switch (frequency) {
    case "WEEKLY":
      return 7;
    case "FORTNIGHTLY":
      return 14;
    case "MONTHLY":
      return 30;
  }
}

// Phase A2 — given a booking's pickup time and a frequency, return the
// Date at which the *next* recurring charge should fire. Always one period
// after the pickup because the first period is prepaid online.
export function nextChargeAfter(pickup: Date, frequency: BillingFrequency): Date {
  const days = periodLengthDays(frequency);
  return new Date(pickup.getTime() + days * 24 * 60 * 60 * 1000);
}

// Phase A1 — translate the category strategy into an upfront AUD amount.
// `totalAmount` here is GST-inclusive (the full rental total, excl. bond).
// Returns the amount to capture online; the remainder stays on balanceDue.
export function computePayOnlineAmount(args: {
  strategy: OnlinePaymentStrategy;
  totalAmount: Prisma.Decimal;
  bookingFeeFlat: Prisma.Decimal | null;
  bookingFeePercent: Prisma.Decimal | null;
}): Prisma.Decimal {
  switch (args.strategy) {
    case "FULL":
      return roundCents(args.totalAmount);
    case "ZERO":
      return aud(0);
    case "FLAT": {
      const fee = args.bookingFeeFlat ?? aud(0);
      // Booking fee cannot exceed the total — cap it.
      return roundCents(gt(fee, args.totalAmount) ? args.totalAmount : fee);
    }
    case "PERCENT": {
      const pct = args.bookingFeePercent ?? aud(0);
      const factor = divide(pct, 100);
      return roundCents(multiply(args.totalAmount, factor));
    }
  }
}

export async function quote(prisma: PrismaClient, input: PricingInput): Promise<PricingQuote> {
  const category = await prisma.vehicleCategory.findUniqueOrThrow({
    where: { id: input.categoryId },
  });
  const durationDays = calcDurationDays(input.pickupDateTime, input.returnDateTime);

  // Progressive tier ladder (if configured) replaces the legacy
  // daily/weekly/monthly + duration-discount cascade for the base subtotal.
  // Seasons, yield and code discounts still apply on top.
  const tiers = await resolvePricingTiers(prisma, input.categoryId, input.vehicleId);
  const pricingMethod: PricingMethod = tiers ? "TIERED" : "FLAT";
  const baseSubtotalDec = tiers
    ? computeProgressiveTierTotal(tiers, durationDays)
    : times(chooseBaseRateDecimal(category, durationDays), durationDays);
  const baseRateDec = tiers
    ? divide(baseSubtotalDec, durationDays)
    : chooseBaseRateDecimal(category, durationDays);

  const seasons = await prisma.season.findMany({
    where: {
      isActive: true,
      startDate: { lte: input.pickupDateTime },
      endDate: { gte: input.pickupDateTime },
    },
    orderBy: { multiplier: "desc" },
  });
  const seasonMultiplier = seasons[0] ? aud(seasons[0].multiplier) : aud(1);
  const seasonedDec = multiply(baseSubtotalDec, seasonMultiplier);

  const flags = await readPricingFlags(prisma);

  let yieldMultiplier = aud(1);
  if (flags.yieldEnabled && input.pickupDepotId) {
    try {
      yieldMultiplier = aud(
        await lookupOrComputeMultiplier(prisma, {
          depotId: input.pickupDepotId,
          categoryId: input.categoryId,
          targetDate: input.pickupDateTime,
        }),
      );
    } catch {
      yieldMultiplier = aud(1);
    }
  }
  const afterYieldDec = multiply(seasonedDec, yieldMultiplier);

  // Tiers replace the legacy duration-discount ladder — when a tier ladder
  // is configured for this scope we zero out durationDiscountPct so the
  // two mechanisms don't stack. The operator can also globally disable the
  // legacy ladder via the `pricing.durationDiscountEnabled` SystemSetting.
  const durDiscPct =
    tiers || !flags.durationDiscountEnabled ? 0 : durationDiscountPct(durationDays);
  const afterDurationDiscountDec = applyPercentage(afterYieldDec, durDiscPct);

  let codeDiscountDec = aud(0);
  if (input.discountCode) {
    const d = await prisma.discount.findUnique({ where: { code: input.discountCode } });
    if (d && d.isActive) {
      if (d.type === "PERCENTAGE") {
        codeDiscountDec = multiply(afterDurationDiscountDec, divide(d.value, 100));
      } else if (d.type === "FIXED") {
        codeDiscountDec = aud(d.value);
      }
    }
  }

  let addonTotalDec = aud(0);
  // Tracked separately so the long-term recurring split below can pull
  // flat (one-time) addons fully into the first period instead of
  // amortising them across every weekly charge.
  let flatAddonTotalDec = aud(0);
  const addonLines: PricingLineItem[] = [];
  if (input.addons?.length) {
    const addons = await prisma.addon.findMany({
      where: { id: { in: input.addons.map((a) => a.addonId) } },
    });
    for (const sel of input.addons) {
      const a = addons.find((x) => x.id === sel.addonId);
      if (!a) continue;
      const unit = a.isPerDay ? aud(a.dailyRate ?? 0) : aud(a.flatRate ?? 0);
      const amount = a.isPerDay
        ? times(times(unit, durationDays), sel.quantity)
        : times(unit, sel.quantity);
      addonTotalDec = sum(addonTotalDec, amount);
      if (!a.isPerDay) flatAddonTotalDec = sum(flatAddonTotalDec, amount);
      addonLines.push({
        label: a.name,
        amount: toNumber(amount),
        qty: sel.quantity,
        unit: toNumber(unit),
      });
    }
  }

  let insuranceTotalDec = aud(0);
  let insurance: InsuranceOption | null = null;
  if (input.insuranceOptionId) {
    insurance = await prisma.insuranceOption.findUnique({
      where: { id: input.insuranceOptionId },
    });
    if (insurance) insuranceTotalDec = times(insurance.dailyRate, durationDays);
  }

  const deliveryFeeDec = aud(input.deliveryFee ?? 0);

  let oneWayFeeDec = aud(0);
  let oneWayFeeLabel: string | null = null;
  if (
    input.pickupDepotId &&
    input.returnDepotId &&
    input.pickupDepotId !== input.returnDepotId
  ) {
    const pair = await prisma.oneWayFee.findUnique({
      where: {
        fromDepotId_toDepotId: {
          fromDepotId: input.pickupDepotId,
          toDepotId: input.returnDepotId,
        },
      },
      include: { fromDepot: true, toDepot: true },
    });
    if (pair && !pair.allowed) {
      throw new OneWayDisallowedError(pair.fromDepot.name, pair.toDepot.name);
    }
    if (pair) {
      oneWayFeeDec = aud(pair.feeAmount);
      oneWayFeeLabel = `One-way fee (${pair.fromDepot.name} → ${pair.toDepot.name})`;
    }
  }

  const netBaseDec = max(aud(0), afterDurationDiscountDec.minus(codeDiscountDec));
  const totalDec = roundCents(
    sum(netBaseDec, addonTotalDec, insuranceTotalDec, deliveryFeeDec, oneWayFeeDec),
  );
  const gstDec = gstFromInclusive(totalDec);
  const subtotalExGstDec = subExGstDecimal(totalDec);

  const baseLineLabel =
    pricingMethod === "TIERED"
      ? `${category.name} × ${durationDays} day${durationDays > 1 ? "s" : ""} (tiered)`
      : `${category.name} × ${durationDays} day${durationDays > 1 ? "s" : ""}`;
  const lineItems: PricingLineItem[] = [
    {
      label: baseLineLabel,
      amount: toNumber(baseSubtotalDec),
      qty: durationDays,
      unit: toNumber(baseRateDec),
    },
  ];
  if (!seasonMultiplier.equals(1)) {
    lineItems.push({
      label: `Seasonal adjustment (×${seasonMultiplier.toString()})`,
      amount: toNumber(seasonedDec.minus(baseSubtotalDec)),
    });
  }
  if (!yieldMultiplier.equals(1)) {
    lineItems.push({
      label: `Demand adjustment (×${yieldMultiplier.toString()})`,
      amount: toNumber(afterYieldDec.minus(seasonedDec)),
    });
  }
  if (durDiscPct > 0) {
    lineItems.push({
      label: `Duration discount (${Math.round(durDiscPct * 100)}%)`,
      amount: -toNumber(times(afterYieldDec, durDiscPct)),
    });
  }
  if (gt(codeDiscountDec, 0)) {
    lineItems.push({ label: `Discount code`, amount: -toNumber(codeDiscountDec) });
  }
  lineItems.push(...addonLines);
  if (insurance) {
    lineItems.push({
      label: `${insurance.name} insurance × ${durationDays} days`,
      amount: toNumber(insuranceTotalDec),
    });
  }
  if (gt(deliveryFeeDec, 0)) {
    lineItems.push({ label: "Delivery", amount: toNumber(deliveryFeeDec) });
  }
  if (gt(oneWayFeeDec, 0) && oneWayFeeLabel) {
    lineItems.push({ label: oneWayFeeLabel, amount: toNumber(oneWayFeeDec) });
  }

  // Phase A1 — per-category online payment strategy.
  const strategy = category.onlinePaymentStrategy;
  const strategyPayOnlineDec = computePayOnlineAmount({
    strategy,
    totalAmount: totalDec,
    bookingFeeFlat: category.bookingFeeFlat as Prisma.Decimal | null,
    bookingFeePercent: category.bookingFeePercent as Prisma.Decimal | null,
  });

  // Phase A2 — progressive billing plan (long-term hires).
  const longTermMinDays = category.longTermMinDays;
  const isLongTerm =
    longTermMinDays !== null &&
    longTermMinDays !== undefined &&
    durationDays >= longTermMinDays;

  let recurringFrequency: BillingFrequency | null = null;
  let recurringAmountDec = aud(0);
  let recurringPeriodsTotal = 0;
  let firstPeriodAmountDec = aud(0);
  let payOnlineDec = strategyPayOnlineDec;

  if (isLongTerm) {
    recurringFrequency = category.longTermDefaultFrequency;
    const periodDays = periodLengthDays(recurringFrequency);
    // Total number of whole periods in this booking. Any remainder days
    // (e.g. days 22–23 on a 23-day weekly hire) collapse into the first
    // period so the customer never sees a fractional final charge.
    const totalPeriods = Math.max(1, Math.floor(durationDays / periodDays));

    // Split totalDec into the per-day-billable portion (base rental +
    // per-day add-ons + per-day insurance) and the flat one-time fees
    // (delivery, one-way, and any non-isPerDay add-on like a flat-rate
    // pickup). Per-day components are spread evenly across each period;
    // flat fees land entirely in the first period because they are
    // one-time charges, not weekly subscriptions.
    const flatFeesDec = sum(deliveryFeeDec, oneWayFeeDec, flatAddonTotalDec);
    const perDayPortionDec = max(aud(0), totalDec.minus(flatFeesDec));
    // True per-day rate across the whole booking (post all multipliers
    // and discounts). We multiply by periodDays to get a clean "7-day
    // equivalent" for each recurring charge.
    const perDayRateDec = divide(perDayPortionDec, durationDays);
    recurringAmountDec = roundCents(times(perDayRateDec, periodDays));
    // First period absorbs flat fees + remainder-day spillover + any
    // rounding residual so the sum (firstPeriod + recurring × N) always
    // reconciles back to totalDec exactly.
    const recurringSubtotalDec = times(recurringAmountDec, totalPeriods - 1);
    firstPeriodAmountDec = roundCents(totalDec.minus(recurringSubtotalDec));
    recurringPeriodsTotal = totalPeriods - 1;

    // Long-term billing replaces the category's online payment strategy
    // entirely. The customer pays exactly the first period (which already
    // includes any one-time fees + remainder-day spillover) up-front; the
    // bond is held separately on top, and the remaining periods are
    // billed progressively against the saved card. Otherwise a category
    // with the default `FULL` strategy would force the customer to pay
    // the entire booking up-front, defeating the whole point of
    // progressive billing.
    payOnlineDec = firstPeriodAmountDec;
  }
  // For long-term hires the remainder is collected automatically via the
  // recurring billing plan, NOT at pickup — so suppress the "due at pickup"
  // figure to avoid implying the customer owes that amount on day one.
  const remainderDec = isLongTerm
    ? aud(0)
    : roundCents(max(aud(0), totalDec.minus(payOnlineDec)));

  return {
    durationDays,
    baseRate: toNumber(baseRateDec),
    baseSubtotal: toNumber(baseSubtotalDec),
    seasonMultiplier: seasonMultiplier.toNumber(),
    yieldMultiplier: yieldMultiplier.toNumber(),
    durationDiscountPct: durDiscPct,
    pricingMethod,
    discountAmount: toNumber(codeDiscountDec),
    addonTotal: toNumber(addonTotalDec),
    insuranceTotal: toNumber(insuranceTotalDec),
    deliveryFee: toNumber(deliveryFeeDec),
    oneWayFee: toNumber(oneWayFeeDec),
    subtotalExGst: toNumber(subtotalExGstDec),
    gstAmount: toNumber(gstDec),
    totalAmount: toNumber(totalDec),
    bondAmount: aud(category.bondAmount).toNumber(),
    lineItems,
    onlinePaymentStrategy: strategy,
    payOnlineAmount: toNumber(payOnlineDec),
    remainderDueAtPickup: toNumber(remainderDec),
    isLongTerm,
    recurringFrequency,
    recurringAmount: toNumber(recurringAmountDec),
    recurringPeriodsTotal,
    firstPeriodAmount: toNumber(firstPeriodAmountDec),
  };
}

// keep GST constant referenced to avoid unused import warnings
void GST_RATE;

export type ExtensionQuoteInput = {
  categoryId: string;
  /** Optional: passed through so a vehicle-scoped PricingTier ladder (if
   *  configured) overrides the category-level ladder for this extension. */
  vehicleId?: string;
  oldReturnDateTime: Date;
  newReturnDateTime: Date;
  perDayAddons?: { unitPrice: number; quantity: number }[];
  perDayInsuranceRate?: number;
};

export type ExtensionQuote = {
  extensionDays: number;
  baseRate: number;
  baseSubtotal: number;
  seasonMultiplier: number;
  durationDiscountPct: number;
  pricingMethod: PricingMethod;
  addonExtension: number;
  insuranceExtension: number;
  subtotalExGst: number;
  gstAmount: number;
  totalAmount: number;
};

export async function quoteExtension(
  prisma: PrismaClient,
  input: ExtensionQuoteInput,
): Promise<ExtensionQuote> {
  if (input.newReturnDateTime.getTime() <= input.oldReturnDateTime.getTime()) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Extension must move the return date forward",
    });
  }
  const category = await prisma.vehicleCategory.findUniqueOrThrow({
    where: { id: input.categoryId },
  });
  const extensionDays = calcDurationDays(input.oldReturnDateTime, input.newReturnDateTime);

  // Mirror quote(): tier ladder (if any) replaces the legacy cascade for
  // the extension window too. Treat the extension as a standalone rental
  // priced by the tier ladder — consistent and easy to reason about.
  const tiers = await resolvePricingTiers(prisma, input.categoryId, input.vehicleId);
  const pricingMethod: PricingMethod = tiers ? "TIERED" : "FLAT";
  const baseSubtotalDec = tiers
    ? computeProgressiveTierTotal(tiers, extensionDays)
    : times(chooseBaseRateDecimal(category, extensionDays), extensionDays);
  const baseRateDec = tiers
    ? divide(baseSubtotalDec, extensionDays)
    : chooseBaseRateDecimal(category, extensionDays);

  const seasons = await prisma.season.findMany({
    where: {
      isActive: true,
      startDate: { lte: input.oldReturnDateTime },
      endDate: { gte: input.oldReturnDateTime },
    },
    orderBy: { multiplier: "desc" },
  });
  const seasonMultiplier = seasons[0] ? aud(seasons[0].multiplier) : aud(1);
  const seasonedDec = multiply(baseSubtotalDec, seasonMultiplier);

  const flags = await readPricingFlags(prisma);
  const durDiscPct =
    tiers || !flags.durationDiscountEnabled ? 0 : durationDiscountPct(extensionDays);
  const baseAfterDiscountDec = applyPercentage(seasonedDec, durDiscPct);

  const addonExtensionDec = (input.perDayAddons ?? []).reduce<Prisma.Decimal>(
    (acc, a) => acc.plus(times(times(a.unitPrice, a.quantity), extensionDays)),
    aud(0),
  );
  const insuranceExtensionDec = times(
    input.perDayInsuranceRate ?? 0,
    extensionDays,
  );

  const totalDec = roundCents(
    sum(baseAfterDiscountDec, addonExtensionDec, insuranceExtensionDec),
  );
  const gstDec = gstFromInclusive(totalDec);
  const subtotalExGstDec = subExGstDecimal(totalDec);

  return {
    extensionDays,
    baseRate: toNumber(baseRateDec),
    baseSubtotal: toNumber(baseSubtotalDec),
    seasonMultiplier: seasonMultiplier.toNumber(),
    durationDiscountPct: durDiscPct,
    pricingMethod,
    addonExtension: toNumber(addonExtensionDec),
    insuranceExtension: toNumber(insuranceExtensionDec),
    subtotalExGst: toNumber(subtotalExGstDec),
    gstAmount: toNumber(gstDec),
    totalAmount: toNumber(totalDec),
  };
}

export type SwapDeltaInput = {
  oldCategoryId: string;
  newCategoryId: string;
  /** Optional: vehicle-scoped PricingTier ladder (if any) overrides the old
   *  category's ladder for the pre-swap remainder. */
  oldVehicleId?: string;
  /** Optional: vehicle-scoped PricingTier ladder (if any) overrides the new
   *  category's ladder for the post-swap remainder. */
  newVehicleId?: string;
  swapAt: Date;
  returnDateTime: Date;
};

export type SwapDeltaQuote = {
  remainingDays: number;
  oldBaseRate: number;
  newBaseRate: number;
  seasonMultiplier: number;
  durationDiscountPct: number;
  pricingMethod: PricingMethod;
  oldRemainderAmount: number;
  newRemainderAmount: number;
  /** Signed: positive = customer pays, negative = customer refunded, zero = no change. */
  deltaAmount: number;
  gstAmount: number;
  direction: "NONE" | "CHARGE" | "REFUND";
};

/**
 * Quote the pro-rata price delta when a vehicle is swapped mid-rental.
 *
 * Computes what the remaining rental window would cost at today's rates
 * for the old and new category, and returns the signed difference.
 *
 * Addons and insurance are intentionally NOT re-quoted — v1 holds them
 * frozen to keep the flow simple. Base-rate and season multiplier only.
 * Duration-discount tier is derived from the remaining days; season
 * multiplier is looked up at the swap time (so a swap straddling a
 * season boundary uses the season active at swapAt).
 *
 * Callers decide whether to apply the delta (charge / refund) or zero it
 * out — `reason` lives in the mutation layer, not here. The `direction`
 * field is a convenience for UI rendering.
 */
export async function quoteSwapDelta(
  prisma: PrismaClient,
  input: SwapDeltaInput,
): Promise<SwapDeltaQuote> {
  if (input.returnDateTime.getTime() <= input.swapAt.getTime()) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Swap quote requires a return time after the swap time",
    });
  }

  const [oldCategory, newCategory, oldTiers, newTiers] = await Promise.all([
    prisma.vehicleCategory.findUniqueOrThrow({ where: { id: input.oldCategoryId } }),
    prisma.vehicleCategory.findUniqueOrThrow({ where: { id: input.newCategoryId } }),
    resolvePricingTiers(prisma, input.oldCategoryId, input.oldVehicleId),
    resolvePricingTiers(prisma, input.newCategoryId, input.newVehicleId),
  ]);

  const remainingDays = calcDurationDays(input.swapAt, input.returnDateTime);

  // If either side has tiers we mark the whole quote as TIERED. Duration
  // discount is zeroed for any side with tiers.
  const pricingMethod: PricingMethod = oldTiers || newTiers ? "TIERED" : "FLAT";

  const oldBaseSubtotalDec = oldTiers
    ? computeProgressiveTierTotal(oldTiers, remainingDays)
    : times(chooseBaseRateDecimal(oldCategory, remainingDays), remainingDays);
  const newBaseSubtotalDec = newTiers
    ? computeProgressiveTierTotal(newTiers, remainingDays)
    : times(chooseBaseRateDecimal(newCategory, remainingDays), remainingDays);
  const oldBaseRateDec = oldTiers
    ? divide(oldBaseSubtotalDec, remainingDays)
    : chooseBaseRateDecimal(oldCategory, remainingDays);
  const newBaseRateDec = newTiers
    ? divide(newBaseSubtotalDec, remainingDays)
    : chooseBaseRateDecimal(newCategory, remainingDays);

  const seasons = await prisma.season.findMany({
    where: {
      isActive: true,
      startDate: { lte: input.swapAt },
      endDate: { gte: input.swapAt },
    },
    orderBy: { multiplier: "desc" },
  });
  const seasonMultiplier = seasons[0] ? aud(seasons[0].multiplier) : aud(1);
  const flags = await readPricingFlags(prisma);
  const ladderOn = flags.durationDiscountEnabled;
  // Report the legacy discount only when BOTH sides are flat (no tiers) and
  // the operator has not globally disabled the legacy ladder.
  const durDiscPct =
    !oldTiers && !newTiers && ladderOn ? durationDiscountPct(remainingDays) : 0;
  const oldDurDiscPct = !oldTiers && ladderOn ? durationDiscountPct(remainingDays) : 0;
  const newDurDiscPct = !newTiers && ladderOn ? durationDiscountPct(remainingDays) : 0;

  const oldSeasonedDec = multiply(oldBaseSubtotalDec, seasonMultiplier);
  const oldAfterDiscountDec = roundCents(applyPercentage(oldSeasonedDec, oldDurDiscPct));

  const newSeasonedDec = multiply(newBaseSubtotalDec, seasonMultiplier);
  const newAfterDiscountDec = roundCents(applyPercentage(newSeasonedDec, newDurDiscPct));

  const deltaDec = newAfterDiscountDec.minus(oldAfterDiscountDec);
  const deltaNum = toNumber(deltaDec);
  const absDelta = Math.abs(deltaNum);
  // GST is 1/11 of the GST-inclusive delta magnitude — direction-agnostic.
  const gstNum = toNumber(gstFromInclusive(aud(absDelta)));

  const direction: SwapDeltaQuote["direction"] =
    absDelta < 0.005 ? "NONE" : deltaNum > 0 ? "CHARGE" : "REFUND";

  return {
    remainingDays,
    oldBaseRate: toNumber(oldBaseRateDec),
    newBaseRate: toNumber(newBaseRateDec),
    seasonMultiplier: seasonMultiplier.toNumber(),
    durationDiscountPct: durDiscPct,
    pricingMethod,
    oldRemainderAmount: toNumber(oldAfterDiscountDec),
    newRemainderAmount: toNumber(newAfterDiscountDec),
    deltaAmount: deltaNum,
    gstAmount: gstNum,
    direction,
  };
}
