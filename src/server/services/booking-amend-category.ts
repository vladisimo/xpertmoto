import { TRPCError } from "@trpc/server";
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  quote as quotePricing,
  OneWayDisallowedError,
  MinimumRentalPeriodError,
} from "./pricing";
import { acquireAllocationLock, countAvailable } from "./availability";
import { checkEligibility } from "./eligibility";
import { aud, gstFromInclusive, roundCents, toNumber } from "@/lib/money";
import { writeAudit, writeCustomerAuditAsync } from "./audit";
import { sendNotification } from "./notification-sender";
import { tryIssueAdjustmentForBooking } from "./invoice-lifecycle";
import { restoreGiftCardForBooking } from "./gift-card";
import { refundCharge } from "@/lib/stripe";
import { getBranding } from "@/lib/branding";
import { trackServer } from "@/lib/analytics";
import { logger } from "@/lib/logger";
import { formatCurrency } from "@/lib/utils";

/**
 * Counter / pre-pickup category change (Area 4). Modelled on
 * `booking-change.ts` (date/time change) — same preview/apply split, same
 * CAS commit, same INCREASE/DECREASE settlement — but the repricing lever is
 * the CATEGORY instead of the window:
 *
 *  - The whole hire is re-quoted at the NEW category over the SAME window,
 *    depots, add-ons and delivery. Insurance is NOT re-quoted — the
 *    BookingInsurance rows carry their own frozen pricing, so the booking's
 *    existing `insuranceTotal` is carried on top of the quote as-is.
 *  - Eligibility against the new category hard-blocks (staff-sighted mode:
 *    no image gate — physical sighting at handover substitutes), and
 *    availability for the new category over the window is checked inside the
 *    commit transaction under the allocation advisory lock.
 *  - Any pre-assigned vehicle is unassigned (allocation happens at
 *    check-out, per business rule #7).
 *  - Settlement: INCREASE raises a PENDING `AMEND-<bookingId>-<seq>` Payment
 *    (type EXTENSION — already in the capture sweep's balance-affecting set;
 *    no new PaymentType) with the balanceDue increment in the same guarded
 *    write; DECREASE reuses the booking-change refund ladder (gift-card
 *    slice restores first, >180d-old source charge falls back to a PENDING
 *    MANUAL_CREDIT, failures queue a retry + manager alert). The ATO §29-75
 *    adjustment note uses reason AMENDMENT.
 *  - Bond: `bondAmount` snaps to the new category's bond. An existing HELD
 *    bond PI is deliberately NOT resized here — the booking note records the
 *    variance and `ensureFreshBondHold` re-authorises at the new amount at
 *    check-out (its freshness predicate treats a hold whose amount no longer
 *    matches booking.bondAmount as stale).
 *  - A pre-signed (SIGNED) rental agreement is superseded so check-out
 *    forces a re-sign against the amended booking.
 *
 * Modes:
 *  - CHARGE_DELTA — settle the quoted delta. Staff may execute upgrades
 *    (delta >= 0); a downgrade refund requires a manager (the router gates,
 *    and `allowNegativeDelta` re-enforces here).
 *  - GOODWILL_FREE_UPGRADE — manager-only. Forces delta to 0: the customer
 *    keeps their price while moving up a category. Only valid when the new
 *    price >= old (otherwise it's a downgrade dressed as goodwill). Requires
 *    a reason (enum + free text) and writes a BOOKING_GOODWILL_UPGRADE audit
 *    row — goodwill is a first-class, reportable concept.
 *  - MANAGER_PRICE_OVERRIDE — manager-only custom delta with a reason.
 */

export const AMENDABLE_STATUSES = ["CONFIRMED"] as const;

export type CategoryAmendmentMode =
  | "CHARGE_DELTA"
  | "GOODWILL_FREE_UPGRADE"
  | "MANAGER_PRICE_OVERRIDE";

export type GoodwillUpgradeReason =
  | "SERVICE_RECOVERY"
  | "FLEET_REASSIGNMENT"
  | "RETENTION"
  | "OTHER";

const r2 = (x: number) => Math.round(x * 100) / 100;

export type PreviewCategoryAmendmentArgs = {
  bookingId: string;
  newCategoryId: string;
  mode: CategoryAmendmentMode;
  /** MANAGER_PRICE_OVERRIDE only: the delta the manager wants to charge
   *  (negative = refund). Ignored for other modes. */
  managerDelta?: number;
};

export type ApplyCategoryAmendmentArgs = PreviewCategoryAmendmentArgs & {
  actorId: string;
  /** Router-derived from the actor's role: whether a negative (refund)
   *  delta may be executed. Managers only. */
  allowNegativeDelta: boolean;
  goodwillReason?: GoodwillUpgradeReason;
  goodwillNote?: string;
  overrideReason?: string;
  reqId?: string;
};

export type CategoryAmendmentDirection = "INCREASE" | "DECREASE" | "NONE";

export type CategoryAmendmentPreview = {
  bookingId: string;
  bookingReference: string;
  mode: CategoryAmendmentMode;
  oldCategoryId: string;
  oldCategoryName: string;
  newCategoryId: string;
  newCategoryName: string;
  oldTotal: number;
  /** Quoted price of the whole hire at the new category (insurance carried). */
  newQuotedTotal: number;
  /** newQuotedTotal − oldTotal, before any mode adjustment. */
  quotedDelta: number;
  /** The delta that will actually settle (0 for goodwill, managerDelta for override). */
  delta: number;
  direction: CategoryAmendmentDirection;
  /** GST portion of |delta| (GST-inclusive). */
  deltaGst: number;
  /** Booking total after the amendment commits. */
  newTotal: number;
  newBalanceDue: number;
  /** Overpayment refunded through the ladder when a reduction exceeds the balance. */
  creditAmount: number;
  oldBondAmount: number;
  newBondAmount: number;
  /** A HELD bond authorisation exists — it is NOT resized by the amendment. */
  bondHeld: boolean;
  eligibility: { ok: boolean; message: string | null; warnings: string[] };
  availability: { ok: boolean; available: number; total: number };
  /** A pre-assigned vehicle will be unassigned (re-allocated at check-out). */
  vehicleWillUnassign: boolean;
  /** A SIGNED rental agreement exists and will be superseded (re-sign at check-out). */
  agreementWillSupersede: boolean;
};

async function loadBooking(prisma: PrismaClient, bookingId: string) {
  return prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      addons: { select: { addonId: true, quantity: true } },
      category: { select: { id: true, name: true, bondAmount: true } },
      customer: { select: { id: true, email: true, firstName: true, lastName: true } },
      billingPlan: { select: { id: true } },
      bondLedger: { select: { id: true, status: true, heldAmount: true } },
    },
  });
}

type LoadedBooking = NonNullable<Awaited<ReturnType<typeof loadBooking>>>;

function assertAmendable(
  booking: LoadedBooking,
  args: PreviewCategoryAmendmentArgs,
): void {
  if (!(AMENDABLE_STATUSES as readonly string[]).includes(booking.status)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `A booking in status ${booking.status} can't change category — only a CONFIRMED (not yet checked-out) booking can be amended.`,
    });
  }
  if (booking.extensionOfId || booking.subscriptionId || booking.billingPlan) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "This booking is part of a longer arrangement (extension / subscription / billing plan) — cancel and rebook to change the category.",
    });
  }
  // Mirrors booking-change: the discount code isn't stored on the booking
  // (only the resulting amount), so it can't be faithfully re-applied to the
  // new category's rates.
  if (Number(booking.discountAmount) > 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "This booking has a discount applied — the code can't be faithfully re-applied at the new category's rates. Cancel and rebook to change the category.",
    });
  }
  if (args.newCategoryId === booking.categoryId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "The booking is already on that category — choose a different one.",
    });
  }
  if (
    args.mode === "MANAGER_PRICE_OVERRIDE" &&
    (args.managerDelta === undefined || !Number.isFinite(args.managerDelta))
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "A price override needs the delta to charge (0 for no charge).",
    });
  }
}

type ComputedPreview = CategoryAmendmentPreview & {
  booking: LoadedBooking;
  newCategory: {
    id: string;
    name: string;
    bondAmount: Prisma.Decimal;
    licenceRequired: string;
    minAge: number;
  };
  /** Quote-derived component figures used by CHARGE_DELTA writes. */
  quotedBaseSubtotal: number;
  quotedAddonTotal: number;
};

async function computePreview(
  prisma: PrismaClient,
  args: PreviewCategoryAmendmentArgs,
): Promise<ComputedPreview> {
  const booking = await loadBooking(prisma, args.bookingId);
  if (!booking) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
  }
  assertAmendable(booking, args);

  const newCategory = await prisma.vehicleCategory.findUnique({
    where: { id: args.newCategoryId },
    select: {
      id: true,
      name: true,
      bondAmount: true,
      isActive: true,
      licenceRequired: true,
      minAge: true,
    },
  });
  if (!newCategory || !newCategory.isActive) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Category not found or inactive." });
  }

  // Whole-hire re-quote at the NEW category: same window, depots, add-ons
  // and delivery. No vehicleId (the vehicle is unassigned — allocation is a
  // check-out concern) and no insuranceOptionId (insurance pricing is frozen
  // on the BookingInsurance rows and carried as-is below).
  let quote;
  try {
    quote = await quotePricing(prisma, {
      categoryId: newCategory.id,
      pickupDateTime: booking.pickupDateTime,
      returnDateTime: booking.returnDateTime,
      pickupDepotId: booking.pickupDepotId,
      returnDepotId: booking.returnDepotId,
      addons: booking.addons.map((a) => ({ addonId: a.addonId, quantity: a.quantity })),
      deliveryFee: Number(booking.deliveryFee),
    });
  } catch (err) {
    if (err instanceof OneWayDisallowedError || err instanceof MinimumRentalPeriodError) {
      throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
    }
    throw err;
  }

  const oldTotal = Number(booking.totalAmount);
  const newQuotedTotal = toNumber(
    roundCents(aud(quote.totalAmount).plus(aud(booking.insuranceTotal))),
  );
  const quotedDelta = toNumber(roundCents(aud(newQuotedTotal).minus(aud(oldTotal))));

  if (args.mode === "GOODWILL_FREE_UPGRADE" && quotedDelta < -0.005) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "A goodwill free upgrade is only valid when the new category prices at or above the current one — use CHARGE_DELTA (manager) for a downgrade.",
    });
  }

  const delta =
    args.mode === "GOODWILL_FREE_UPGRADE"
      ? 0
      : args.mode === "MANAGER_PRICE_OVERRIDE"
        ? toNumber(roundCents(aud(args.managerDelta ?? 0)))
        : quotedDelta;
  const direction: CategoryAmendmentDirection =
    delta > 0 ? "INCREASE" : delta < 0 ? "DECREASE" : "NONE";
  const deltaGst = toNumber(roundCents(gstFromInclusive(aud(Math.abs(delta)))));

  const newTotal =
    args.mode === "GOODWILL_FREE_UPGRADE"
      ? oldTotal
      : Math.max(0, toNumber(roundCents(aud(oldTotal).plus(delta))));
  const newBalanceRaw = toNumber(roundCents(aud(Number(booking.balanceDue)).plus(delta)));
  const newBalanceDue = Math.max(0, newBalanceRaw);
  const creditAmount = newBalanceRaw < 0 ? r2(-newBalanceRaw) : 0;

  // Eligibility against the NEW category, staff-sighted mode (no
  // licenceType → the image gate is skipped; staff sight documents at
  // handover). Mirrors the checkOut re-verification call.
  const customer = await prisma.user.findUniqueOrThrow({
    where: { id: booking.customerId },
    select: {
      dateOfBirth: true,
      customerProfile: {
        select: {
          licenceClass: true,
          licenceExpiry: true,
          passportNumber: true,
          passportExpiry: true,
        },
      },
    },
  });
  const eligibility = checkEligibility({
    customer: {
      dateOfBirth: customer.dateOfBirth,
      licenceClass: customer.customerProfile?.licenceClass ?? null,
      licenceExpiry: customer.customerProfile?.licenceExpiry ?? null,
      passportNumber: customer.customerProfile?.passportNumber ?? null,
      passportExpiry: customer.customerProfile?.passportExpiry ?? null,
    },
    category: {
      name: newCategory.name,
      licenceRequired: newCategory.licenceRequired,
      minAge: newCategory.minAge,
    },
    pickupDate: booking.pickupDateTime,
  });

  // Advisory availability read for the preview panel; the commit re-checks
  // inside the transaction under the allocation lock.
  const avail = await countAvailable(prisma, {
    categoryId: newCategory.id,
    depotId: booking.pickupDepotId,
    pickup: booking.pickupDateTime,
    ret: booking.returnDateTime,
  });

  const agreementWillSupersede =
    (await prisma.rentalAgreement.count({
      where: { bookingId: booking.id, status: "SIGNED" },
    })) > 0;

  return {
    booking,
    newCategory,
    quotedBaseSubtotal: quote.baseSubtotal,
    quotedAddonTotal: quote.addonTotal,
    bookingId: booking.id,
    bookingReference: booking.bookingReference,
    mode: args.mode,
    oldCategoryId: booking.categoryId,
    oldCategoryName: booking.category.name,
    newCategoryId: newCategory.id,
    newCategoryName: newCategory.name,
    oldTotal,
    newQuotedTotal,
    quotedDelta,
    delta,
    direction,
    deltaGst,
    newTotal,
    newBalanceDue,
    creditAmount,
    oldBondAmount: Number(booking.bondAmount),
    newBondAmount: Number(newCategory.bondAmount),
    bondHeld: booking.bondLedger?.status === "HELD",
    eligibility: {
      ok: eligibility.failure === null,
      message: eligibility.failure?.message ?? null,
      warnings: eligibility.warnings.map((w) => w.message),
    },
    availability: {
      ok: avail.available > 0,
      available: avail.available,
      total: avail.total,
    },
    vehicleWillUnassign: booking.vehicleId !== null,
    agreementWillSupersede,
  };
}

/** Pure quote — never mutates. Backs the change-category dialog's preview. */
export async function previewCategoryAmendment(
  prisma: PrismaClient,
  args: PreviewCategoryAmendmentArgs,
): Promise<CategoryAmendmentPreview> {
  const { booking: _b, newCategory: _c, quotedBaseSubtotal: _s, quotedAddonTotal: _a, ...preview } =
    await computePreview(prisma, args);
  return preview;
}

export type ApplyCategoryAmendmentResult = {
  bookingId: string;
  bookingReference: string;
  customerId: string;
  mode: CategoryAmendmentMode;
  oldCategoryId: string;
  newCategoryId: string;
  delta: number;
  direction: CategoryAmendmentDirection;
  newTotal: number;
  newBalanceDue: number;
  creditAmount: number;
  newBondAmount: number;
  /** PENDING charge reference for an INCREASE, else null. */
  paymentReference: string | null;
  refundOutcome: "NONE" | "SUCCEEDED" | "PARTIAL" | "FAILED" | "MANUAL_CREDIT";
  agreementsSuperseded: number;
};

export async function applyCategoryAmendment(
  prisma: PrismaClient,
  args: ApplyCategoryAmendmentArgs,
): Promise<ApplyCategoryAmendmentResult> {
  if (args.mode === "GOODWILL_FREE_UPGRADE" && (!args.goodwillReason || !args.goodwillNote?.trim())) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "A goodwill upgrade needs a reason and a short note.",
    });
  }
  if (args.mode === "MANAGER_PRICE_OVERRIDE" && !args.overrideReason?.trim()) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "A price override needs a reason.",
    });
  }

  const preview = await computePreview(prisma, args);
  const { booking } = preview;

  // Hard blocks that the preview only reports.
  if (!preview.eligibility.ok) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: preview.eligibility.message ?? "Customer is not eligible for the new category.",
    });
  }
  if (!preview.availability.ok) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `No ${preview.newCategoryName} available at the pickup depot for this window.`,
    });
  }
  // Defence-in-depth behind the router's role gate: the delta is only known
  // here, so a sign flip between the router's preview and this apply can
  // never let staff execute a refund.
  if (preview.delta < 0 && !args.allowNegativeDelta) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "A category downgrade refund requires a manager.",
    });
  }

  // Money fields per mode. GOODWILL keeps the invoice exactly as-is (the
  // customer keeps their price); CHARGE_DELTA adopts the quote's component
  // split; OVERRIDE lets the base-rental component absorb the custom delta.
  const goodwill = args.mode === "GOODWILL_FREE_UPGRADE";
  const moneyData: {
    subtotal?: number;
    addonTotal?: number;
    gstAmount?: number;
    totalAmount?: number;
    balanceDue?: number;
  } = {};
  if (!goodwill && preview.direction !== "NONE") {
    moneyData.totalAmount = preview.newTotal;
    moneyData.gstAmount = toNumber(roundCents(gstFromInclusive(aud(preview.newTotal))));
    moneyData.balanceDue = preview.newBalanceDue;
    if (args.mode === "CHARGE_DELTA") {
      moneyData.subtotal = preview.quotedBaseSubtotal;
      moneyData.addonTotal = preview.quotedAddonTotal;
    } else {
      moneyData.subtotal = Math.max(
        0,
        toNumber(roundCents(aud(Number(booking.subtotal)).plus(preview.delta))),
      );
    }
  }

  const snap = (booking.pricingSnapshot ?? {}) as Record<string, unknown>;
  const amendments = Array.isArray(snap.amendments) ? [...(snap.amendments as unknown[])] : [];
  amendments.push({
    at: new Date().toISOString(),
    actorId: args.actorId,
    mode: args.mode,
    oldCategoryId: preview.oldCategoryId,
    newCategoryId: preview.newCategoryId,
    delta: preview.delta,
    ...(goodwill
      ? { goodwillReason: args.goodwillReason, goodwillNote: args.goodwillNote }
      : {}),
    ...(args.mode === "MANAGER_PRICE_OVERRIDE"
      ? { overrideReason: args.overrideReason, quotedDelta: preview.quotedDelta }
      : {}),
  });

  const moneyLine =
    preview.direction === "INCREASE"
      ? `Additional charge ${formatCurrency(preview.delta)} to the card on file.`
      : preview.direction === "DECREASE"
        ? `The total drops by ${formatCurrency(-preview.delta)}${
            preview.creditAmount > 0
              ? ` (${formatCurrency(preview.creditAmount)} refunded to the original payment method)`
              : ""
          }.`
        : goodwill
          ? "No charge — goodwill upgrade."
          : "No change to the price.";
  const bondLine =
    preview.newBondAmount !== preview.oldBondAmount
      ? ` Bond changes ${formatCurrency(preview.oldBondAmount)} → ${formatCurrency(preview.newBondAmount)}${
          preview.bondHeld
            ? " — the current bond hold is unchanged and will be re-authorised at the new amount at check-out"
            : ""
        }.`
      : "";
  const noteBody =
    `Category changed: ${preview.oldCategoryName} → ${preview.newCategoryName}. ` +
    `${moneyLine}${bondLine}` +
    (preview.vehicleWillUnassign
      ? " The previously assigned vehicle was released — a vehicle in the new category is allocated at check-out."
      : "");

  let paymentReference: string | null = null;
  const txResult = await prisma.$transaction(async (tx) => {
    // Serialise against concurrent allocations in the (depot, new category)
    // cell, then re-check availability inside the lock — the preview's read
    // ran without it.
    await acquireAllocationLock(tx, booking.pickupDepotId, preview.newCategoryId);
    const avail = await countAvailable(tx, {
      categoryId: preview.newCategoryId,
      depotId: booking.pickupDepotId,
      pickup: booking.pickupDateTime,
      ret: booking.returnDateTime,
    });
    if (avail.available <= 0) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `No ${preview.newCategoryName} available at the pickup depot for this window.`,
      });
    }

    // CAS keyed on the state the preview priced (status + category + total):
    // a double-click, second tab, or racing staff edit matches zero rows and
    // conflicts instead of double-settling.
    const guard = await tx.booking.updateMany({
      where: {
        id: booking.id,
        status: booking.status,
        categoryId: booking.categoryId,
        totalAmount: booking.totalAmount,
      },
      data: {
        categoryId: preview.newCategoryId,
        bondAmount: preview.newBondAmount,
        vehicleId: null,
        pricingSnapshot: { ...snap, amendments } as Prisma.InputJsonValue,
        ...moneyData,
      },
    });
    if (guard.count === 0) {
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "This booking changed while the amendment was in flight — review the new details and try again.",
      });
    }

    await tx.bookingNote.create({
      data: {
        bookingId: booking.id,
        userId: args.actorId,
        note: noteBody,
        isInternal: false,
      },
    });
    await tx.bookingStatusLog.create({
      data: {
        bookingId: booking.id,
        previousStatus: booking.status,
        newStatus: booking.status,
        changedById: args.actorId,
        reason: `Category change ${preview.oldCategoryName} → ${preview.newCategoryName} (${args.mode}) — delta ${formatCurrency(preview.delta)}`,
      },
    });

    // INCREASE: raise the delta as a PENDING row for the off-session capture
    // sweep (EXTENSION is in its eligible + balance-affecting set). The
    // balanceDue increment landed in the guarded write above — raise and
    // increment share the transaction per the balance-due contract. The
    // deterministic per-booking sequence is a second line of defence behind
    // the CAS (a duplicate collides on the unique reference).
    if (preview.direction === "INCREASE") {
      const priorAmendCharges = await tx.payment.count({
        where: { bookingId: booking.id, reference: { startsWith: `AMEND-${booking.id}-` } },
      });
      paymentReference = `AMEND-${booking.id}-${priorAmendCharges + 1}`;
      await tx.payment.create({
        data: {
          reference: paymentReference,
          customerId: booking.customerId,
          bookingId: booking.id,
          type: "EXTENSION" as const,
          method: "STRIPE" as const,
          amount: preview.delta,
          gstAmount: preview.deltaGst,
          status: "PENDING" as const,
          notes: `Category change ${preview.oldCategoryName} → ${preview.newCategoryName} — additional charge`,
        },
      });
    }

    // A pre-signed agreement no longer matches the hire — supersede it so
    // check-out's SIGNED-agreement gate forces a re-sign.
    const superseded = await tx.rentalAgreement.updateMany({
      where: { bookingId: booking.id, status: "SIGNED" },
      data: {
        status: "SUPERSEDED",
        supersededAt: new Date(),
        supersededReason: `Category amendment ${preview.oldCategoryName} → ${preview.newCategoryName} — agreement must be re-signed at check-out`,
      },
    });

    return { agreementsSuperseded: superseded.count };
  });

  // DECREASE overpayment: refund for real via the booking-change ladder.
  let refundOutcome: ApplyCategoryAmendmentResult["refundOutcome"] = "NONE";
  if (preview.direction === "DECREASE" && preview.creditAmount > 0) {
    refundOutcome = await refundAmendmentOverpayment(prisma, {
      booking,
      amount: preview.creditAmount,
      actorUserId: args.actorId,
    });
  }

  // ATO §29-75 adjustment note for the delta (skipped for a price-neutral
  // amendment — goodwill included: consideration is unchanged).
  if (preview.direction !== "NONE") {
    const magnitude = Math.abs(preview.delta);
    let paymentId: string | null = null;
    if (preview.direction === "INCREASE" && paymentReference) {
      const row = await prisma.payment.findFirst({
        where: { bookingId: booking.id, reference: paymentReference },
        select: { id: true },
      });
      paymentId = row?.id ?? null;
    }
    await tryIssueAdjustmentForBooking({
      bookingId: booking.id,
      type: preview.direction,
      reason: "AMENDMENT",
      description: `Category change ${preview.oldCategoryName} → ${preview.newCategoryName} — ${
        preview.direction === "INCREASE" ? "additional charge" : "reduction"
      }${args.mode === "MANAGER_PRICE_OVERRIDE" ? " (manager price override)" : ""}`,
      lineItems: [
        {
          description: `Category change — ${preview.oldCategoryName} → ${preview.newCategoryName}`,
          detail: `${booking.durationDays} day(s), same hire window`,
          quantity: 1,
          unitPrice: magnitude,
          totalPrice: magnitude,
          gstAmount: preview.deltaGst,
          gstIncluded: true,
        },
      ],
      paymentId,
      issuedById: args.actorId,
    });
  }

  await writeAudit(prisma, {
    userId: args.actorId,
    action: "BOOKING_CATEGORY_AMENDED",
    entity: "Booking",
    entityId: booking.id,
    previousData: {
      categoryId: preview.oldCategoryId,
      categoryName: preview.oldCategoryName,
      totalAmount: preview.oldTotal,
      bondAmount: preview.oldBondAmount,
      vehicleId: booking.vehicleId,
    },
    newData: {
      categoryId: preview.newCategoryId,
      categoryName: preview.newCategoryName,
      mode: args.mode,
      delta: preview.delta,
      quotedDelta: preview.quotedDelta,
      totalAmount: goodwill ? preview.oldTotal : preview.newTotal,
      bondAmount: preview.newBondAmount,
      creditAmount: preview.creditAmount,
      paymentReference,
      overrideReason: args.overrideReason ?? null,
    },
  });
  if (goodwill) {
    await writeAudit(prisma, {
      userId: args.actorId,
      action: "BOOKING_GOODWILL_UPGRADE",
      entity: "Booking",
      entityId: booking.id,
      newData: {
        oldCategoryId: preview.oldCategoryId,
        newCategoryId: preview.newCategoryId,
        quotedDelta: preview.quotedDelta,
        forgoneRevenue: Math.max(0, preview.quotedDelta),
        goodwillReason: args.goodwillReason,
        goodwillNote: args.goodwillNote,
      },
    });
  }
  writeCustomerAuditAsync(prisma, booking.customerId, {
    userId: args.actorId,
    action: "BOOKING_CATEGORY_AMENDED",
    reqId: args.reqId,
    previousData: { bookingId: booking.id, categoryId: preview.oldCategoryId },
    newData: {
      bookingId: booking.id,
      reference: booking.bookingReference,
      categoryId: preview.newCategoryId,
      mode: args.mode,
      delta: preview.delta,
    },
  });

  // The old category's capacity is freed and the new one's consumed — drop
  // cached availability for the window. Best-effort (TTL covers it).
  try {
    const { invalidateAvailability } = await import("@/server/services/availability-cache");
    await invalidateAvailability(
      booking.pickupDepotId,
      booking.pickupDateTime,
      booking.returnDateTime,
    );
  } catch {
    // non-fatal — TTL expiry covers it
  }

  const { siteName } = await getBranding();
  await sendNotification({
    userId: booking.customerId,
    type: "BOOKING_MODIFIED",
    channels: ["EMAIL", "SMS"],
    subject: `Booking updated — ${booking.bookingReference}`,
    title: "Booking updated",
    body:
      `Your ${siteName} booking ${booking.bookingReference} was updated to a different vehicle category.\n\n` +
      `New category: ${preview.newCategoryName} (was ${preview.oldCategoryName})\n` +
      `${moneyLine}${bondLine ? `\n${bondLine.trim()}` : ""}\n\n` +
      "Your dates and pickup location are unchanged.",
    bookingId: booking.id,
    sentById: args.actorId,
  }).catch((err) => {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), bookingId: booking.id },
      "booking-amend-category: customer notification failed; non-blocking",
    );
  });

  await trackServer({
    event: "booking.category_amended",
    distinctId: booking.customerId,
    properties: {
      bookingId: booking.id,
      reference: booking.bookingReference,
      mode: args.mode,
      oldCategoryId: preview.oldCategoryId,
      newCategoryId: preview.newCategoryId,
      deltaAud: preview.delta,
      quotedDeltaAud: preview.quotedDelta,
      goodwillReason: args.goodwillReason ?? null,
    },
  });

  logger.info(
    {
      bookingId: booking.id,
      mode: args.mode,
      oldCategoryId: preview.oldCategoryId,
      newCategoryId: preview.newCategoryId,
      delta: preview.delta,
      refundOutcome,
    },
    "booking category amended",
  );

  return {
    bookingId: booking.id,
    bookingReference: booking.bookingReference,
    customerId: booking.customerId,
    mode: args.mode,
    oldCategoryId: preview.oldCategoryId,
    newCategoryId: preview.newCategoryId,
    delta: preview.delta,
    direction: preview.direction,
    newTotal: goodwill ? preview.oldTotal : preview.newTotal,
    newBalanceDue: goodwill ? Number(booking.balanceDue) : preview.newBalanceDue,
    creditAmount: preview.creditAmount,
    newBondAmount: preview.newBondAmount,
    paymentReference,
    refundOutcome,
    agreementsSuperseded: txResult.agreementsSuperseded,
  };
}

/**
 * Refund an amendment DECREASE overpayment for real — the booking-change
 * ladder: the gift-card-funded slice restores to the funding card(s) first
 * (atomic with its Payment row + amountPaid decrement), the remainder goes
 * back to the card via Stripe. A source charge older than 180 days falls
 * back to a PENDING MANUAL_CREDIT row for finance; a failed Stripe refund is
 * left FAILED with a queued retry and a manager alert — never silently kept.
 */
async function refundAmendmentOverpayment(
  prisma: PrismaClient,
  args: { booking: LoadedBooking; amount: number; actorUserId: string },
): Promise<"SUCCEEDED" | "PARTIAL" | "FAILED" | "MANUAL_CREDIT"> {
  const { booking } = args;
  const seq =
    (await prisma.payment.count({
      where: { bookingId: booking.id, reference: { startsWith: `AMEND-REF-${booking.id}-` } },
    })) + 1;

  const giftAgg = await prisma.payment.aggregate({
    where: { bookingId: booking.id, type: "GIFT_CARD_REDEMPTION", status: "SUCCEEDED" },
    _sum: { amount: true },
  });
  // Redemption rows are stored negative; prior restores already reduce what
  // is restorable inside the gift-card helper.
  const giftPaid = Math.abs(Number(giftAgg._sum.amount ?? 0));
  const giftRefund = r2(Math.min(args.amount, giftPaid));
  const cardRefund = r2(args.amount - giftRefund);

  if (giftRefund > 0) {
    await prisma.$transaction(async (tx) => {
      const { restored } = await restoreGiftCardForBooking(tx, {
        bookingId: booking.id,
        amount: giftRefund,
        reason: `Refund — booking ${booking.bookingReference} category-change reduction`,
      });
      await tx.payment.create({
        data: {
          reference: `AMEND-REF-GC-${booking.id}-${seq}`,
          bookingId: booking.id,
          customerId: booking.customerId,
          type: "REFUND",
          method: "CARD",
          amount: giftRefund,
          gstAmount: gstFromInclusive(giftRefund),
          status: "SUCCEEDED",
          processedAt: new Date(),
          processedById: args.actorUserId,
          notes:
            restored >= giftRefund
              ? "Category-change reduction restored to gift card"
              : `Category-change reduction restored to gift card (A$${restored.toFixed(2)} of A$${giftRefund.toFixed(2)} — remainder needs manual follow-up)`,
        },
      });
      const fresh = await tx.booking.findUniqueOrThrow({
        where: { id: booking.id },
        select: { amountPaid: true },
      });
      await tx.booking.update({
        where: { id: booking.id },
        data: { amountPaid: Math.max(0, r2(Number(fresh.amountPaid) - giftRefund)) },
      });
    });
  }

  if (cardRefund <= 0) return "SUCCEEDED";

  const source = await prisma.payment.findFirst({
    where: {
      bookingId: booking.id,
      type: "BOOKING_PAYMENT",
      status: "SUCCEEDED",
      stripePaymentIntentId: { not: null },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      stripePaymentIntentId: true,
      stripeChargeId: true,
      processedAt: true,
      createdAt: true,
    },
  });

  // Source charge too old for a card refund — record intent as a PENDING
  // MANUAL_CREDIT for finance to settle by bank transfer.
  if (source) {
    const chargeAt = source.processedAt ?? source.createdAt;
    const daysSince = (Date.now() - chargeAt.getTime()) / 86_400_000;
    if (daysSince > 180) {
      await prisma.payment.create({
        data: {
          reference: `AMEND-CREDIT-${booking.id}-${seq}`,
          bookingId: booking.id,
          customerId: booking.customerId,
          type: "MANUAL_CREDIT",
          method: "BANK_TRANSFER",
          amount: cardRefund,
          gstAmount: gstFromInclusive(cardRefund),
          status: "PENDING",
          processedById: args.actorUserId,
          notes:
            "Category-change reduction >180d after source charge: needs manual reconcile via credit note / bank transfer.",
        },
      });
      return "MANUAL_CREDIT";
    }
  }

  let refundOk = false;
  let stripeRefundId: string | null = null;
  let failNote = "";
  const idempotencyKey = `amend-refund-${booking.id}-${seq}`;
  if (source) {
    try {
      const res = await refundCharge({
        paymentIntentId: source.stripePaymentIntentId,
        chargeId: source.stripeChargeId,
        amountCents: Math.round(cardRefund * 100),
        reason: "requested_by_customer",
        metadata: { bookingId: booking.id, kind: "category-change-reduction" },
        idempotencyKey,
      });
      stripeRefundId = res.id;
      refundOk = res.status === "succeeded" || res.status === "pending";
    } catch (err) {
      failNote = err instanceof Error ? err.message.slice(0, 160) : "Stripe refund failed";
      logger.error(
        { err: failNote, bookingId: booking.id, cardRefund },
        "category-change reduction refund failed at Stripe",
      );
    }
  } else {
    failNote = "no Stripe charge on file; manual refund required";
  }

  const row = await prisma.payment.create({
    data: {
      reference: `AMEND-REF-${booking.id}-${seq}`,
      bookingId: booking.id,
      customerId: booking.customerId,
      type: "REFUND",
      method: "STRIPE",
      amount: cardRefund,
      gstAmount: gstFromInclusive(cardRefund),
      status: refundOk ? "SUCCEEDED" : "FAILED",
      stripeChargeId: stripeRefundId,
      processedAt: refundOk ? new Date() : null,
      processedById: args.actorUserId,
      notes: refundOk
        ? "Category-change reduction refunded to card"
        : `Category-change reduction refund FAILED — ${failNote}`,
    },
  });

  if (refundOk) {
    const fresh = await prisma.booking.findUniqueOrThrow({
      where: { id: booking.id },
      select: { amountPaid: true },
    });
    await prisma.booking.update({
      where: { id: booking.id },
      data: { amountPaid: Math.max(0, r2(Number(fresh.amountPaid) - cardRefund)) },
    });
    return "SUCCEEDED";
  }

  // Recovery ladder: automated retry + manager alert. The retry job
  // decrements amountPaid when the refund eventually lands.
  if (source) {
    try {
      const { enqueueRefundRetry } = await import("@/server/jobs/refund-retry");
      await enqueueRefundRetry({
        paymentId: row.id,
        paymentIntentId: source.stripePaymentIntentId,
        chargeId: source.stripeChargeId,
        amountCents: Math.round(cardRefund * 100),
        idempotencyKey,
        attempt: 1,
      });
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), bookingId: booking.id },
        "category-change reduction: could not enqueue refund retry",
      );
    }
  }
  try {
    const managers = await prisma.user.findMany({
      where: { role: { in: ["MANAGER", "ADMIN", "SUPER_ADMIN"] }, status: "ACTIVE" },
      select: { id: true },
      take: 5,
    });
    for (const m of managers) {
      await sendNotification({
        userId: m.id,
        type: "INCIDENT_REPORTED",
        channels: ["IN_APP", "EMAIL"],
        subject: `Refund FAILED — ${booking.bookingReference}`,
        title: "Category-change reduction refund failed",
        body: `The A$${cardRefund.toFixed(2)} overpayment refund for booking ${booking.bookingReference} failed at Stripe (${failNote}). An automatic retry is queued; if it keeps failing, refund manually from the payment console.`,
        bookingId: booking.id,
        data: { refundPaymentId: row.id, amountAud: cardRefund },
      });
    }
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), bookingId: booking.id },
      "category-change reduction: manager alert failed",
    );
  }
  return giftRefund > 0 ? "PARTIAL" : "FAILED";
}
