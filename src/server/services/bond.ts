import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import {
  cancelPaymentIntent,
  createBondHoldOffSession,
  retrievePaymentIntent,
} from "@/lib/stripe";
import { logger } from "@/lib/logger";
import { writePaymentAudit } from "./audit-payment";

type PrismaLike = PrismaClient | typeof defaultPrisma;

/**
 * Bond authorisation lifecycle. A bond is a manual-capture Stripe
 * PaymentIntent whose card-network authorisation silently expires — ~7 days
 * on Visa, ~30 on Mastercard/Amex. Stripe cannot extend an auth, so keeping
 * a long hire protected means replacing the expiring PI with a fresh
 * off-session one (the card was saved at checkout via setup_future_usage).
 *
 * `ensureFreshBondHold` is the single entry point, shared by:
 *   - staff check-out (customer present — 3DS fallback possible),
 *   - the rolling re-hold job (bond-auth-expiry-check),
 *   - walk-in bond setup.
 */

/** Card-network authorisation TTLs by brand (days). Conservative defaults. */
export const BRAND_AUTH_DAYS: Record<string, number> = {
  visa: 7,
  mastercard: 30,
  amex: 30,
  discover: 30,
  jcb: 30,
  unionpay: 7,
  diners: 14,
};
export const DEFAULT_AUTH_DAYS = 7;

export function bondAuthHorizonDays(brand: string | null | undefined): number {
  return BRAND_AUTH_DAYS[(brand ?? "").toLowerCase()] ?? DEFAULT_AUTH_DAYS;
}

export type EnsureFreshBondHoldResult =
  | { ok: true; action: "fresh" | "reauthorized" | "created" | "no_bond" }
  | { ok: false; action: "requires_action"; clientSecret: string; paymentIntentId: string }
  | { ok: false; action: "failed" | "no_pm"; errorCode?: string; errorMessage?: string };

/**
 * Guarantee the booking's bond hold is live and has at least
 * `minRemainingDays` left on its brand auth horizon; re-authorise
 * off-session from the saved card when it isn't. Creates the initial hold
 * (+ ledger row) when the booking carries a bondAmount but no ledger yet
 * (walk-ins, ZERO-strategy rescues).
 *
 * Ordering on re-auth: the NEW hold is confirmed BEFORE the old PI is
 * cancelled, so there is never a coverage gap; a cancel failure on an
 * already-expired PI is swallowed (the hold is gone either way).
 */
export async function ensureFreshBondHold(
  prisma: PrismaLike,
  args: {
    bookingId: string;
    actorUserId?: string | null;
    minRemainingDays?: number;
    reason: "check-out" | "rolling-reauth" | "walk-in" | "theft-suspected";
  },
): Promise<EnsureFreshBondHoldResult> {
  const minRemainingDays = args.minRemainingDays ?? 2;
  const booking = await prisma.booking.findUniqueOrThrow({
    where: { id: args.bookingId },
    select: {
      id: true,
      bookingReference: true,
      customerId: true,
      bondAmount: true,
      bondLedger: {
        select: {
          id: true,
          status: true,
          heldAmount: true,
          capturedAmount: true,
          releasedAmount: true,
          stripePaymentIntentId: true,
          authorizedAt: true,
          reauthCount: true,
          authHistory: true,
          createdAt: true,
        },
      },
      customer: {
        select: {
          customerProfile: {
            select: {
              stripeCustomerId: true,
              defaultStripePaymentMethodId: true,
              stripePaymentMethodBrand: true,
            },
          },
        },
      },
    },
  });

  const ledger = booking.bondLedger;
  const bondAmount = Number(booking.bondAmount);

  if (!ledger && bondAmount <= 0) return { ok: true, action: "no_bond" };
  if (ledger && ledger.status !== "HELD") return { ok: true, action: "no_bond" };

  const profile = booking.customer?.customerProfile;
  const stripeCustomerId = profile?.stripeCustomerId;
  const paymentMethodId = profile?.defaultStripePaymentMethodId;
  const remainingHeld = ledger
    ? Math.max(
        0,
        Number(ledger.heldAmount) -
          Number(ledger.capturedAmount) -
          Number(ledger.releasedAmount),
      )
    : bondAmount;
  // A pre-pickup category amendment can change booking.bondAmount after the
  // initial hold was authorised. While the hold is still untouched (nothing
  // captured or released), the booking's CURRENT bondAmount is authoritative:
  // an undersized hold must not silently survive to check-out, and an
  // oversized one should shrink. Such a hold is treated as stale below and
  // re-authorised at the new amount.
  const resizeTarget =
    ledger &&
    Number(ledger.capturedAmount) === 0 &&
    Number(ledger.releasedAmount) === 0 &&
    bondAmount > 0 &&
    Math.abs(Number(ledger.heldAmount) - bondAmount) >= 0.005
      ? bondAmount
      : null;
  const holdAmount = resizeTarget ?? remainingHeld;
  if (holdAmount <= 0) return { ok: true, action: "no_bond" };

  // Freshness check for an existing hold. A live, young hold at a stale
  // amount (resizeTarget set) is NOT fresh — it re-authorises below.
  if (ledger?.stripePaymentIntentId) {
    const pi = await retrievePaymentIntent(ledger.stripePaymentIntentId);
    if (pi === null) {
      // Stub mode / dev — treat as fresh so local flows don't spin.
      return { ok: true, action: "fresh" };
    }
    const horizon = bondAuthHorizonDays(profile?.stripePaymentMethodBrand);
    const authorizedAt = ledger.authorizedAt ?? ledger.createdAt;
    const ageDays = (Date.now() - authorizedAt.getTime()) / 86_400_000;
    const live = pi.status === "requires_capture";
    if (live && horizon - ageDays > minRemainingDays && resizeTarget === null) {
      return { ok: true, action: "fresh" };
    }
  }

  if (!stripeCustomerId || stripeCustomerId.startsWith("cus_stub_") || !paymentMethodId) {
    return { ok: false, action: "no_pm" };
  }

  const idempotencyKey = ledger
    ? `bond-reauth-${ledger.id}-${ledger.reauthCount + 1}`
    : `bond-create-${booking.id}`;
  const hold = await createBondHoldOffSession({
    customerId: stripeCustomerId,
    paymentMethodId,
    amount: holdAmount,
    bookingId: booking.id,
    description: booking.bookingReference,
    idempotencyKey,
  });

  if (hold.status === "requires_action") {
    return {
      ok: false,
      action: "requires_action",
      clientSecret: hold.clientSecret ?? "",
      paymentIntentId: hold.id,
    };
  }
  if (hold.status !== "requires_capture") {
    logger.warn(
      {
        bookingId: booking.id,
        reason: args.reason,
        status: hold.status,
        errorCode: hold.errorCode,
      },
      "bond: off-session hold failed",
    );
    return {
      ok: false,
      action: "failed",
      errorCode: hold.errorCode,
      errorMessage: hold.errorMessage,
    };
  }

  // New hold is live — retire the old PI (never before), then move the
  // ledger pointer. Cancel failures on dead auths are expected and logged.
  if (ledger?.stripePaymentIntentId && ledger.stripePaymentIntentId !== hold.id) {
    try {
      await cancelPaymentIntent(ledger.stripePaymentIntentId);
    } catch (err) {
      logger.warn(
        {
          err: err instanceof Error ? err.message : String(err),
          bookingId: booking.id,
          oldPaymentIntentId: ledger.stripePaymentIntentId,
        },
        "bond: cancelling superseded hold failed (usually already expired) — continuing",
      );
    }
  }

  if (ledger) {
    const history = Array.isArray(ledger.authHistory)
      ? [...(ledger.authHistory as Array<Record<string, unknown>>)]
      : [];
    if (ledger.stripePaymentIntentId && ledger.stripePaymentIntentId !== hold.id) {
      history.push({
        paymentIntentId: ledger.stripePaymentIntentId,
        authorizedAt: (ledger.authorizedAt ?? ledger.createdAt).toISOString(),
        canceledAt: new Date().toISOString(),
        reason: args.reason,
      });
    }
    await prisma.bondLedger.update({
      where: { id: ledger.id },
      data: {
        stripePaymentIntentId: hold.id,
        authorizedAt: new Date(),
        reauthCount: { increment: 1 },
        authHistory: history as Prisma.InputJsonValue,
        // Resize (category amendment changed booking.bondAmount): the new
        // PI was authorised for the new amount, so the ledger follows it.
        ...(resizeTarget !== null ? { heldAmount: holdAmount } : {}),
      },
    });
  } else {
    await prisma.bondLedger.create({
      data: {
        bookingId: booking.id,
        customerId: booking.customerId,
        heldAmount: bondAmount,
        status: "HELD",
        stripePaymentIntentId: hold.id,
        authorizedAt: new Date(),
      },
    });
  }

  await writePaymentAudit(prisma, {
    action: ledger ? "bond.reauthorized" : "bond.created",
    entity: "Payment",
    entityId: hold.id,
    userId: args.actorUserId ?? booking.customerId,
    status: "SUCCESS",
    newData: {
      bookingId: booking.id,
      bookingReference: booking.bookingReference,
      amountAud: holdAmount,
      reason: args.reason,
      supersededPaymentIntentId: ledger?.stripePaymentIntentId ?? null,
    },
  });

  return { ok: true, action: ledger ? "reauthorized" : "created" };
}
