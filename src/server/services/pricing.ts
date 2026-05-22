import type {
  PrismaClient,
  VehicleCategory,
  VehicleModel,
  Vehicle,
  InsuranceOption,
  BillingFrequency,
  OnlinePaymentStrategy,
  PricingTier,
  BasePeriodHours,
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
  /** Optional small-text formula shown under the line item in the UI,
   *  e.g. "$70.86/day × 11 days" for the base rental or "$12/day × 11
   *  days" for insurance. Lets the customer see exactly how each row was
   *  computed without having to re-derive the math. */
  detail?: string;
};

/** Single line in the "Pay now" breakdown surfaced under the deposit
 *  callout. Lets the customer see exactly what the upfront charge is
 *  composed of — deposit slice, long-term first-period rental, any
 *  one-time fees folded in — without re-deriving the math from the line
 *  items above. */
export type PayOnlineBreakdownItem = {
  label: string;
  amount: number;
  /** Optional formula / arithmetic shown in small text under the label,
   *  e.g. "50% × $496.00 (first week)". */
  detail?: string;
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
  /** Itemised breakdown explaining what payOnlineAmount is composed of.
   *  Always at least one row. The bond is NOT in this list — it's
   *  authorised separately and surfaced as its own panel in the UI. */
  payOnlineBreakdown: PayOnlineBreakdownItem[];

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

/** Thrown when a 48-hour-base vehicle is quoted for a single-day rental.
 *  The xpertmoto model uses a 48 h minimum for premium bikes — a 1-day
 *  booking would otherwise either over- or under-charge; surfacing it as a
 *  validation error keeps the cascade honest. */
export class MinimumRentalPeriodError extends Error {
  readonly code = "MIN_RENTAL_PERIOD";
  constructor(public readonly minDays: number) {
    super(
      `This vehicle has a ${minDays}-day minimum rental. Choose a return date at least ${minDays} day${minDays > 1 ? "s" : ""} after pickup.`,
    );
    this.name = "MinimumRentalPeriodError";
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

/** Vehicle → model → category cascade for the per-rental base rate.
 *
 *  When the resolved scope sets `basePeriodHours = H48`, the resolved rate
 *  is a *minimum charge* covering days 1–2: any 1- or 2-day booking pays
 *  exactly `baseRate`, and 1-day bookings throw `MinimumRentalPeriodError`
 *  (the xpertmoto premium bikes do not rent for a single day).
 *
 *  Returns the GST-inclusive subtotal for the base rental and the per-day
 *  rate exposed in the quote summary. */
type ModelLite = Pick<VehicleModel, "baseRate" | "basePeriodHours"> | null;
type VehicleLite = Pick<Vehicle, "baseRateOverride" | "basePeriodHoursOverride"> | null;

function resolveBasePeriodHours(
  vehicle: VehicleLite,
  model: ModelLite,
): BasePeriodHours {
  return (
    vehicle?.basePeriodHoursOverride ??
    model?.basePeriodHours ??
    "H24"
  );
}

function resolveBaseRateDecimal(
  vehicle: VehicleLite,
  model: ModelLite,
): Prisma.Decimal | null {
  if (vehicle?.baseRateOverride != null) return aud(vehicle.baseRateOverride);
  if (model?.baseRate != null) return aud(model.baseRate);
  return null;
}

/** Compute the flat-rate base subtotal for a booking, honouring per-vehicle
 *  and per-model overrides on top of the category daily/weekly/monthly
 *  cascade. Falls back to the category cascade when no override is set.
 *
 *  Throws `MinimumRentalPeriodError` if the resolved scope sets `H48` and
 *  the booking is shorter than 2 days. */
export function computeFlatBaseSubtotal(args: {
  category: VehicleCategory;
  model: ModelLite;
  vehicle: VehicleLite;
  days: number;
}): { baseSubtotal: Prisma.Decimal; baseRate: Prisma.Decimal } {
  const { category, model, vehicle, days } = args;
  const override = resolveBaseRateDecimal(vehicle, model);
  if (override != null) {
    const period = resolveBasePeriodHours(vehicle, model);
    if (period === "H48" && days < 2) {
      throw new MinimumRentalPeriodError(2);
    }
    // H48: rate is the minimum charge for any 1-2 day rental (`days < 2`
    // is rejected above); from day 2 onward each additional day costs
    // baseRate / 2 to keep day-over-day pricing continuous.
    if (period === "H48") {
      const perDay = divide(override, 2);
      return { baseSubtotal: times(perDay, days), baseRate: perDay };
    }
    return { baseSubtotal: times(override, days), baseRate: override };
  }
  const rate = chooseBaseRateDecimal(category, days);
  return { baseSubtotal: times(rate, days), baseRate: rate };
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
type DepositBasis = "TOTAL" | "WEEK1";

type PricingFlags = {
  yieldEnabled: boolean;
  durationDiscountEnabled: boolean;
  /**
   * Controls how the PERCENT `OnlinePaymentStrategy` interprets the
   * deposit-percent setting on a category:
   *   - `TOTAL` (default): deposit = bookingFeePercent × totalAmount
   *   - `WEEK1`: deposit = bookingFeePercent × min(7-day, total) base
   *     subtotal. Matches xpertmoto.com.au's "50% of the first week +
   *     bond on top" convention.
   * FULL / ZERO / FLAT strategies ignore this — they don't reference
   * totalAmount × percent.
   */
  depositBasis: DepositBasis;
};

async function readPricingFlags(prisma: PrismaClient): Promise<PricingFlags> {
  try {
    const rows = await prisma.systemSetting.findMany({
      where: {
        key: {
          in: [
            "pricing.yieldEnabled",
            "pricing.durationDiscountEnabled",
            "pricing.depositBasis",
          ],
        },
      },
    });
    const byKey = new Map(rows.map((r) => [r.key, r.value as unknown]));
    const yieldEnabled = byKey.get("pricing.yieldEnabled");
    const durationDiscountEnabled = byKey.get("pricing.durationDiscountEnabled");
    const depositBasisRaw = byKey.get("pricing.depositBasis");
    const depositBasis: DepositBasis = depositBasisRaw === "WEEK1" ? "WEEK1" : "TOTAL";
    return {
      yieldEnabled: typeof yieldEnabled === "boolean" ? yieldEnabled : true,
      durationDiscountEnabled:
        typeof durationDiscountEnabled === "boolean" ? durationDiscountEnabled : true,
      depositBasis,
    };
  } catch {
    return { yieldEnabled: true, durationDiscountEnabled: true, depositBasis: "TOTAL" };
  }
}

/** Look up the active PricingTier ladder for a booking. Resolution order:
 *  vehicle → model → category. Returns null when no scope has any active
 *  tiers — the caller falls back to the legacy daily/weekly/monthly +
 *  durationDiscountPct cascade. */
export async function resolvePricingTiers(
  prisma: PrismaClient,
  categoryId: string,
  vehicleId?: string,
  modelId?: string | null,
): Promise<PricingTier[] | null> {
  if (vehicleId) {
    const vehicleTiers = await prisma.pricingTier.findMany({
      where: { vehicleId, isActive: true },
      orderBy: { minDays: "asc" },
    });
    if (vehicleTiers.length > 0) return vehicleTiers;
  }
  if (modelId) {
    const modelTiers = await prisma.pricingTier.findMany({
      where: { modelId, isActive: true },
      orderBy: { minDays: "asc" },
    });
    if (modelTiers.length > 0) return modelTiers;
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

  // PER_WEEK ladders use pro-rata-within-tier semantics: the tier that
  // contains the whole booking sets the per-week rate, billed as
  // `pricePerWeek × days / 7`. This is smooth across whole-week
  // boundaries (CB125F 14-day = $152 × 14/7 = $304, R1250GS 28-day =
  // $960 × 28/7 = $3,840) but avoids the abrupt $/wk jump that
  // round-up-by-week produced (11 days no longer mysteriously costs
  // the same as 14). PROGRESSIVE ladders use the existing tax-bracket
  // accumulator. We don't mix modes within a single ladder — pick the
  // row whose [minDays, maxDays] contains `days`, or the last row when
  // `days` overshoots.
  const perWeekTier = tiers.find(
    (t) => t.tierMode === "PER_WEEK" && days >= t.minDays && days <= t.maxDays,
  );
  if (perWeekTier && perWeekTier.pricePerWeek != null) {
    return divide(times(perWeekTier.pricePerWeek, days), 7);
  }
  // Overshoot path: when `days` exceeds the last PER_WEEK tier's maxDays,
  // bill at the last tier's per-week rate. Lets operators set "12+ weeks"
  // open-endedly without a separate sentinel.
  const lastTier = tiers[tiers.length - 1]!;
  if (lastTier.tierMode === "PER_WEEK" && lastTier.pricePerWeek != null && days > lastTier.maxDays) {
    return divide(times(lastTier.pricePerWeek, days), 7);
  }

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
  /**
   * Optional alternate base for the PERCENT strategy. When set, the
   * percentage multiplies against this amount instead of `totalAmount`.
   * Used by the `pricing.depositBasis = WEEK1` SystemSetting so xpertmoto-
   * style "50% of the first week + bond on top" can be expressed without
   * a new enum value. Capped at `totalAmount` so the deposit never
   * exceeds what's actually owed.
   */
  percentBaseAmount?: Prisma.Decimal;
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
      const base = args.percentBaseAmount ?? args.totalAmount;
      const deposit = roundCents(multiply(base, factor));
      // Never deposit more than the actual total (short rentals where
      // 50% × week1 > total would otherwise look wrong).
      return gt(deposit, args.totalAmount) ? roundCents(args.totalAmount) : deposit;
    }
  }
}

/** Build the itemised "Pay now" breakdown the customer sees under the
 *  deposit callout. Each row maps to one of the strategy outcomes
 *  computed by `computePayOnlineAmount` — long-term hires get their own
 *  "first period" framing because the strategy is bypassed in that path. */
function buildPayOnlineBreakdown(args: {
  strategy: OnlinePaymentStrategy;
  isLongTerm: boolean;
  recurringFrequency: BillingFrequency | null;
  payOnlineDec: Prisma.Decimal;
  totalDec: Prisma.Decimal;
  percentBaseDec: Prisma.Decimal | undefined;
  week1DepositDec: Prisma.Decimal | undefined;
  addonLines: PricingLineItem[];
  insuranceLabel: string | null;
  insuranceAmount: Prisma.Decimal;
  deliveryAmount: Prisma.Decimal;
  oneWayLabel: string | null;
  oneWayAmount: Prisma.Decimal;
  depositBasis: DepositBasis;
  bookingFeePercent: Prisma.Decimal | null;
  bookingFeeFlat: Prisma.Decimal | null;
}): PayOnlineBreakdownItem[] {
  const amount = toNumber(roundCents(args.payOnlineDec));

  if (args.isLongTerm) {
    const word =
      args.recurringFrequency === "WEEKLY"
        ? "weekly"
        : args.recurringFrequency === "FORTNIGHTLY"
          ? "fortnightly"
          : args.recurringFrequency === "MONTHLY"
            ? "monthly"
            : "first";
    return [
      {
        label: `First ${word.replace(/ly$/, "")} period`,
        amount,
        detail: "Covers rental, per-day add-ons, and any one-time fees (delivery, one-way). Recurring charges follow on the saved card.",
      },
    ];
  }

  // WEEK1 deposit path: composed of the week-1 rental slice + 100% of
  // add-ons / insurance / delivery / one-way. Render each as its own
  // row so the customer can see exactly what they're being charged for.
  if (args.week1DepositDec !== undefined) {
    const items: PayOnlineBreakdownItem[] = [];
    const pct = toNumber(args.bookingFeePercent ?? aud(0));
    const baseAmount = toNumber(roundCents(args.percentBaseDec ?? aud(0)));
    items.push({
      label: `Deposit (${pct}% of first week)`,
      amount: toNumber(roundCents(args.week1DepositDec)),
      detail: `${pct}% × $${baseAmount.toFixed(2)} first-week rental`,
    });
    for (const a of args.addonLines) {
      items.push({ label: a.label, amount: a.amount });
    }
    if (toNumber(args.insuranceAmount) > 0 && args.insuranceLabel) {
      items.push({
        label: args.insuranceLabel,
        amount: toNumber(roundCents(args.insuranceAmount)),
      });
    }
    if (toNumber(args.deliveryAmount) > 0) {
      items.push({
        label: "Delivery",
        amount: toNumber(roundCents(args.deliveryAmount)),
      });
    }
    if (toNumber(args.oneWayAmount) > 0 && args.oneWayLabel) {
      items.push({
        label: args.oneWayLabel,
        amount: toNumber(roundCents(args.oneWayAmount)),
      });
    }
    // Final cap reconciliation: if the deposit was capped at totalDec
    // (very short rentals) the rows above may overshoot — surface a
    // single explanatory note rather than over-itemising.
    const itemSum = items.reduce((acc, it) => acc + it.amount, 0);
    if (Math.abs(itemSum - amount) > 0.01) {
      return [
        {
          label: "Deposit (capped at rental total)",
          amount,
          detail: `${pct}% × first-week rental + extras exceeded the rental total — capped at $${amount.toFixed(2)}.`,
        },
      ];
    }
    return items;
  }

  switch (args.strategy) {
    case "FULL":
      return [
        {
          label: "Full rental total",
          amount,
          detail: "Rental + add-ons + insurance + delivery (GST incl).",
        },
      ];
    case "ZERO":
      return [
        {
          label: "No deposit",
          amount: 0,
          detail: "All charges collected at pickup.",
        },
      ];
    case "FLAT": {
      const fee = toNumber(args.bookingFeeFlat ?? aud(0));
      return [
        {
          label: "Booking fee",
          amount,
          detail: `Flat fee of $${fee.toFixed(2)} (capped at the rental total).`,
        },
      ];
    }
    case "PERCENT": {
      const pct = toNumber(args.bookingFeePercent ?? aud(0));
      const baseDec = args.percentBaseDec ?? args.totalDec;
      const baseAmount = toNumber(roundCents(baseDec));
      const basisLabel =
        args.depositBasis === "WEEK1"
          ? "of first-week rental"
          : "of rental total";
      const detail = `${pct}% × $${baseAmount.toFixed(2)} ${args.depositBasis === "WEEK1" ? "(first week's rental)" : "(rental total)"}`;
      return [
        {
          label: `Deposit (${pct}% ${basisLabel})`,
          amount,
          detail,
        },
      ];
    }
  }
}

export async function quote(prisma: PrismaClient, input: PricingInput): Promise<PricingQuote> {
  const category = await prisma.vehicleCategory.findUniqueOrThrow({
    where: { id: input.categoryId },
  });
  const durationDays = calcDurationDays(input.pickupDateTime, input.returnDateTime);

  // Per-vehicle + per-model context for the base-rate cascade.
  // `vehicle.modelId` ties a Vehicle to its catalogue VehicleModel; we look
  // both up in one round-trip when a vehicle is known. When the wizard only
  // knows the category (allocation happens at check-out) both stay null and
  // the cascade falls back to category-level rates.
  let vehicle: VehicleLite = null;
  let model: ModelLite = null;
  let modelId: string | null = null;
  // `vehicleLabel` overrides the line-item label when set — shows the
  // actual bike the customer picked (e.g. "Ducati Monster 659") instead
  // of the generic category name ("Unrestricted Motorcycle").
  let vehicleLabel: string | null = null;
  if (input.vehicleId) {
    const v = await prisma.vehicle.findUnique({
      where: { id: input.vehicleId },
      select: {
        make: true,
        model: true,
        baseRateOverride: true,
        basePeriodHoursOverride: true,
        modelId: true,
        catalogueModel: { select: { baseRate: true, basePeriodHours: true } },
      },
    });
    if (v) {
      vehicle = { baseRateOverride: v.baseRateOverride, basePeriodHoursOverride: v.basePeriodHoursOverride } as VehicleLite;
      model = v.catalogueModel;
      modelId = v.modelId;
      vehicleLabel = `${v.make} ${v.model}`;
    }
  }

  // Progressive tier ladder (if configured) replaces the legacy
  // daily/weekly/monthly + duration-discount cascade for the base subtotal.
  // Seasons, yield and code discounts still apply on top. When the rental
  // is shorter than the first tier's minDays (e.g. a 3-day rental against
  // a 7+ days PER_WEEK ladder), fall back to the flat per-day rate —
  // tiers anchored at a week shouldn't quietly bill $0 for sub-week
  // rentals.
  const rawTiers = await resolvePricingTiers(prisma, input.categoryId, input.vehicleId, modelId);
  const tiers = rawTiers && rawTiers[0] && durationDays >= rawTiers[0].minDays ? rawTiers : null;
  const pricingMethod: PricingMethod = tiers ? "TIERED" : "FLAT";
  let baseSubtotalDec: Prisma.Decimal;
  let baseRateDec: Prisma.Decimal;
  if (tiers) {
    baseSubtotalDec = computeProgressiveTierTotal(tiers, durationDays);
    baseRateDec = divide(baseSubtotalDec, durationDays);
  } else {
    const flat = computeFlatBaseSubtotal({
      category,
      model,
      vehicle,
      days: durationDays,
    });
    baseSubtotalDec = flat.baseSubtotal;
    baseRateDec = flat.baseRate;
  }

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
      const detail = a.isPerDay
        ? `$${toNumber(unit).toFixed(2)}/day × ${durationDays} day${durationDays > 1 ? "s" : ""}${sel.quantity > 1 ? ` × ${sel.quantity}` : ""}`
        : sel.quantity > 1
          ? `$${toNumber(unit).toFixed(2)} × ${sel.quantity}`
          : undefined;
      addonLines.push({
        label: a.name,
        amount: toNumber(amount),
        qty: sel.quantity,
        unit: toNumber(unit),
        ...(detail ? { detail } : {}),
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

  const baseEntity = vehicleLabel ?? category.name;
  const baseLineLabel =
    pricingMethod === "TIERED"
      ? `${baseEntity} × ${durationDays} day${durationDays > 1 ? "s" : ""} (tiered)`
      : `${baseEntity} × ${durationDays} day${durationDays > 1 ? "s" : ""}`;
  // For TIERED PER_WEEK rentals, surface the $/wk source so the customer
  // can tie the line back to the rate card ("$496/wk × 11/7 days").
  // For FLAT (no tier ladder) the formula is "$X/day × N days".
  let baseDetail: string | undefined;
  if (tiers) {
    const perWeekTier = tiers.find(
      (t) => t.tierMode === "PER_WEEK" && durationDays >= t.minDays && durationDays <= t.maxDays,
    );
    const fallbackTier =
      tiers[tiers.length - 1] &&
      tiers[tiers.length - 1]!.tierMode === "PER_WEEK" &&
      durationDays > tiers[tiers.length - 1]!.maxDays
        ? tiers[tiers.length - 1]
        : null;
    const activeTier = perWeekTier ?? fallbackTier;
    if (activeTier?.pricePerWeek != null) {
      baseDetail = `$${Number(activeTier.pricePerWeek).toFixed(0)}/wk × ${durationDays}/7 days = $${toNumber(baseSubtotalDec).toFixed(2)}`;
    } else {
      // PROGRESSIVE ladder — show the effective per-day rate.
      baseDetail = `$${toNumber(baseRateDec).toFixed(2)}/day × ${durationDays} days (progressive tiers)`;
    }
  } else {
    const period = resolveBasePeriodHours(vehicle, model);
    if (period === "H48") {
      baseDetail = `$${toNumber(baseRateDec).toFixed(2)}/day × ${durationDays} days (48 h base period)`;
    } else {
      baseDetail = `$${toNumber(baseRateDec).toFixed(2)}/day × ${durationDays} days`;
    }
  }
  const lineItems: PricingLineItem[] = [
    {
      label: baseLineLabel,
      amount: toNumber(baseSubtotalDec),
      qty: durationDays,
      unit: toNumber(baseRateDec),
      detail: baseDetail,
    },
  ];
  if (!seasonMultiplier.equals(1)) {
    lineItems.push({
      label: `Seasonal adjustment (×${seasonMultiplier.toString()})`,
      amount: toNumber(seasonedDec.minus(baseSubtotalDec)),
      detail: `Rental base $${toNumber(baseSubtotalDec).toFixed(2)} × (${seasonMultiplier.toString()} − 1)`,
    });
  }
  if (!yieldMultiplier.equals(1)) {
    lineItems.push({
      label: `Demand adjustment (×${yieldMultiplier.toString()})`,
      amount: toNumber(afterYieldDec.minus(seasonedDec)),
      detail: `Post-season $${toNumber(seasonedDec).toFixed(2)} × (${yieldMultiplier.toString()} − 1)`,
    });
  }
  if (durDiscPct > 0) {
    lineItems.push({
      label: `Duration discount (${Math.round(durDiscPct * 100)}%)`,
      amount: -toNumber(times(afterYieldDec, durDiscPct)),
      detail: `${Math.round(durDiscPct * 100)}% off $${toNumber(afterYieldDec).toFixed(2)}`,
    });
  }
  if (gt(codeDiscountDec, 0)) {
    lineItems.push({
      label: `Discount code`,
      amount: -toNumber(codeDiscountDec),
      detail: input.discountCode ? `Code ${input.discountCode}` : undefined,
    });
  }
  lineItems.push(...addonLines);
  if (insurance) {
    lineItems.push({
      label: `${insurance.name} insurance × ${durationDays} days`,
      amount: toNumber(insuranceTotalDec),
      detail: `$${Number(insurance.dailyRate).toFixed(2)}/day × ${durationDays} day${durationDays > 1 ? "s" : ""}`,
    });
  }
  if (gt(deliveryFeeDec, 0)) {
    lineItems.push({
      label: "Delivery",
      amount: toNumber(deliveryFeeDec),
      detail: "Flat fee, one-time charge",
    });
  }
  if (gt(oneWayFeeDec, 0) && oneWayFeeLabel) {
    lineItems.push({
      label: oneWayFeeLabel,
      amount: toNumber(oneWayFeeDec),
      detail: "Flat fee, one-time charge",
    });
  }

  // Phase A1 — per-category online payment strategy. When the operator
  // has opted into the WEEK1 deposit basis, the deposit is composed of:
  //   - bookingFeePercent × first-week base rental (post-multipliers)
  //   - 100% of any add-ons, insurance, delivery and one-way fees
  // Bond is on top of all of this (held separately, not captured here).
  // This matches xpertmoto.com.au's "50% of the first week of bike hire
  // + extras + bond on top" convention. Rentals shorter than a week
  // collapse the week-1 slice to the actual booked days; the deposit is
  // always capped at totalDec so it can't exceed what's owed.
  const strategy = category.onlinePaymentStrategy;
  let percentBaseDec: Prisma.Decimal | undefined;
  let week1DepositDec: Prisma.Decimal | undefined;
  if (
    strategy === "PERCENT" &&
    flags.depositBasis === "WEEK1" &&
    durationDays > 0
  ) {
    const weekDays = Math.min(durationDays, 7);
    // For PER_WEEK ladders whose first tier starts at day 7+, a sub-tier
    // week-1 slice (e.g. weekDays < firstTier.minDays) must use the flat
    // rate too — otherwise the deposit basis silently lands at $0.
    const weekTiers =
      tiers && tiers[0] && weekDays >= tiers[0].minDays ? tiers : null;
    const weekRawBaseDec = weekTiers
      ? computeProgressiveTierTotal(weekTiers, weekDays)
      : computeFlatBaseSubtotal({ category, model, vehicle, days: weekDays }).baseSubtotal;
    // Apply the same season + yield + duration-discount multipliers to
    // the week-1 slice so the deposit basis is consistent with how the
    // total is computed. Code discounts and per-day add-ons are NOT
    // applied — the deposit anchors on the rental rate alone.
    let weekDec = multiply(weekRawBaseDec, seasonMultiplier);
    weekDec = multiply(weekDec, yieldMultiplier);
    if (durDiscPct > 0) {
      weekDec = applyPercentage(weekDec, durDiscPct);
    }
    percentBaseDec = roundCents(weekDec);
    // bookingFeePercent × week-1 base — the rental slice of the deposit.
    const pct = category.bookingFeePercent ?? aud(0);
    const factor = divide(pct, 100);
    week1DepositDec = roundCents(multiply(percentBaseDec, factor));
  }
  const strategyPayOnlineDec =
    week1DepositDec !== undefined
      ? roundCents(
          // Deposit slice + 100% of every extra. Cap at the total so we
          // never collect more than the customer owes (very short
          // rentals where week-1 deposit + extras > total).
          (() => {
            const dep = sum(
              week1DepositDec,
              addonTotalDec,
              insuranceTotalDec,
              deliveryFeeDec,
              oneWayFeeDec,
            );
            return gt(dep, totalDec) ? totalDec : dep;
          })(),
        )
      : computePayOnlineAmount({
          strategy,
          totalAmount: totalDec,
          bookingFeeFlat: category.bookingFeeFlat as Prisma.Decimal | null,
          bookingFeePercent: category.bookingFeePercent as Prisma.Decimal | null,
          percentBaseAmount: percentBaseDec,
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

  const payOnlineBreakdown = buildPayOnlineBreakdown({
    strategy,
    isLongTerm,
    recurringFrequency,
    payOnlineDec,
    totalDec,
    percentBaseDec,
    week1DepositDec,
    addonLines,
    insuranceLabel: insurance
      ? `${insurance.name} insurance × ${durationDays} day${durationDays > 1 ? "s" : ""}`
      : null,
    insuranceAmount: insuranceTotalDec,
    deliveryAmount: deliveryFeeDec,
    oneWayLabel: oneWayFeeLabel,
    oneWayAmount: oneWayFeeDec,
    depositBasis: flags.depositBasis,
    bookingFeePercent: category.bookingFeePercent as Prisma.Decimal | null,
    bookingFeeFlat: category.bookingFeeFlat as Prisma.Decimal | null,
  });

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
    payOnlineBreakdown,
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

  // Per-vehicle + per-model cascade context — see `quote()` for the rules.
  let vehicle: VehicleLite = null;
  let model: ModelLite = null;
  let modelId: string | null = null;
  if (input.vehicleId) {
    const v = await prisma.vehicle.findUnique({
      where: { id: input.vehicleId },
      select: {
        baseRateOverride: true,
        basePeriodHoursOverride: true,
        modelId: true,
        catalogueModel: { select: { baseRate: true, basePeriodHours: true } },
      },
    });
    if (v) {
      vehicle = { baseRateOverride: v.baseRateOverride, basePeriodHoursOverride: v.basePeriodHoursOverride } as VehicleLite;
      model = v.catalogueModel;
      modelId = v.modelId;
    }
  }

  // Mirror quote(): tier ladder (if any) replaces the legacy cascade for
  // the extension window too. Sub-tier-minimum windows fall back to the
  // flat per-day rate (same rule as quote()) so a 2-day extension on a
  // 7+ days PER_WEEK ladder is priced sensibly.
  const rawTiers = await resolvePricingTiers(prisma, input.categoryId, input.vehicleId, modelId);
  const tiers = rawTiers && rawTiers[0] && extensionDays >= rawTiers[0].minDays ? rawTiers : null;
  const pricingMethod: PricingMethod = tiers ? "TIERED" : "FLAT";
  let baseSubtotalDec: Prisma.Decimal;
  let baseRateDec: Prisma.Decimal;
  if (tiers) {
    baseSubtotalDec = computeProgressiveTierTotal(tiers, extensionDays);
    baseRateDec = divide(baseSubtotalDec, extensionDays);
  } else {
    const flat = computeFlatBaseSubtotal({
      category,
      model,
      vehicle,
      days: extensionDays,
    });
    baseSubtotalDec = flat.baseSubtotal;
    baseRateDec = flat.baseRate;
  }

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

  async function loadVehicleCtx(vehicleId?: string) {
    if (!vehicleId) return { vehicle: null as VehicleLite, model: null as ModelLite, modelId: null as string | null };
    const v = await prisma.vehicle.findUnique({
      where: { id: vehicleId },
      select: {
        baseRateOverride: true,
        basePeriodHoursOverride: true,
        modelId: true,
        catalogueModel: { select: { baseRate: true, basePeriodHours: true } },
      },
    });
    if (!v) return { vehicle: null as VehicleLite, model: null as ModelLite, modelId: null as string | null };
    return {
      vehicle: { baseRateOverride: v.baseRateOverride, basePeriodHoursOverride: v.basePeriodHoursOverride } as VehicleLite,
      model: v.catalogueModel as ModelLite,
      modelId: v.modelId,
    };
  }

  const [oldCategory, newCategory, oldCtx, newCtx] = await Promise.all([
    prisma.vehicleCategory.findUniqueOrThrow({ where: { id: input.oldCategoryId } }),
    prisma.vehicleCategory.findUniqueOrThrow({ where: { id: input.newCategoryId } }),
    loadVehicleCtx(input.oldVehicleId),
    loadVehicleCtx(input.newVehicleId),
  ]);

  const [rawOldTiers, rawNewTiers] = await Promise.all([
    resolvePricingTiers(prisma, input.oldCategoryId, input.oldVehicleId, oldCtx.modelId),
    resolvePricingTiers(prisma, input.newCategoryId, input.newVehicleId, newCtx.modelId),
  ]);

  const remainingDays = calcDurationDays(input.swapAt, input.returnDateTime);

  // Same sub-tier-minimum fallback as quote() — a tier ladder that starts
  // at day 7 shouldn't return 0 for a 3-day swap window.
  const oldTiers =
    rawOldTiers && rawOldTiers[0] && remainingDays >= rawOldTiers[0].minDays ? rawOldTiers : null;
  const newTiers =
    rawNewTiers && rawNewTiers[0] && remainingDays >= rawNewTiers[0].minDays ? rawNewTiers : null;

  // If either side has tiers we mark the whole quote as TIERED. Duration
  // discount is zeroed for any side with tiers.
  const pricingMethod: PricingMethod = oldTiers || newTiers ? "TIERED" : "FLAT";

  const oldBaseSubtotalDec = oldTiers
    ? computeProgressiveTierTotal(oldTiers, remainingDays)
    : computeFlatBaseSubtotal({
        category: oldCategory,
        model: oldCtx.model,
        vehicle: oldCtx.vehicle,
        days: remainingDays,
      }).baseSubtotal;
  const newBaseSubtotalDec = newTiers
    ? computeProgressiveTierTotal(newTiers, remainingDays)
    : computeFlatBaseSubtotal({
        category: newCategory,
        model: newCtx.model,
        vehicle: newCtx.vehicle,
        days: remainingDays,
      }).baseSubtotal;
  const oldBaseRateDec = oldTiers
    ? divide(oldBaseSubtotalDec, remainingDays)
    : computeFlatBaseSubtotal({
        category: oldCategory,
        model: oldCtx.model,
        vehicle: oldCtx.vehicle,
        days: remainingDays,
      }).baseRate;
  const newBaseRateDec = newTiers
    ? divide(newBaseSubtotalDec, remainingDays)
    : computeFlatBaseSubtotal({
        category: newCategory,
        model: newCtx.model,
        vehicle: newCtx.vehicle,
        days: remainingDays,
      }).baseRate;

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
