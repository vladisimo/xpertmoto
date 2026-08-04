import type { PrismaClient } from "@prisma/client";
import * as Sentry from "@sentry/nextjs";
import { prisma as defaultPrisma } from "@/lib/prisma";

// Accepts either the raw PrismaClient or the extended `@/lib/prisma`
// client. Same rationale as the AuditablePrisma widening in
// audit-payment.ts.
type PrismaLike = PrismaClient | typeof defaultPrisma;
import {
  attachDefaultPaymentMethod,
  chargeOffSession as stripeChargeOffSession,
  createSetupIntent as stripeCreateSetupIntent,
  createStripeCustomer,
  retrievePaymentMethod,
  setCustomerDefaultPaymentMethod,
  type OffSessionChargeResult,
} from "@/lib/stripe";
import { logger } from "@/lib/logger";
import { writePaymentAudit } from "./audit-payment";

/**
 * G6 — Stripe Customer + stored payment method service.
 *
 * Idempotent: `ensureStripeCustomer` is safe to call repeatedly; it returns
 * the existing id if already populated. Off-session `chargeOffSession` is
 * used by the capture-pending-payments job (G5) to charge delayed
 * recoveries against the stored default PM.
 *
 * The service does NOT write Payment rows itself — that is the job's
 * responsibility. It only manages Customer / PM state on CustomerProfile
 * and dispatches the Stripe API calls.
 */

/**
 * Stub-mode sentinel. Returned by `createStripeCustomer` when the Stripe
 * SDK isn't configured (dev before real keys are wired). These ids won't
 * exist in any real Stripe account — passing them on to setup_intents /
 * payment_intents yields `resource_missing - customer` errors once real
 * keys are configured. Treat them as "no stored customer" so the next
 * call mints a real one.
 */
function isStubCustomerId(id: string | null): boolean {
  return !!id && id.startsWith("cus_stub_");
}

export async function ensureStripeCustomer(
  userId: string,
  options: { prisma?: PrismaLike } = {},
): Promise<string> {
  const client = options.prisma ?? defaultPrisma;
  const profile = await client.customerProfile.findUnique({
    where: { userId },
    select: {
      stripeCustomerId: true,
      user: { select: { email: true, firstName: true, lastName: true, phone: true } },
    },
  });
  if (!profile) {
    throw new Error(`CustomerProfile not found for user ${userId}`);
  }
  if (profile.stripeCustomerId && !isStubCustomerId(profile.stripeCustomerId)) {
    return profile.stripeCustomerId;
  }

  const hadStub = isStubCustomerId(profile.stripeCustomerId);
  const customer = await createStripeCustomer({
    userId,
    email: profile.user.email,
    name: [profile.user.firstName, profile.user.lastName].filter(Boolean).join(" ") || null,
    phone: profile.user.phone ?? null,
  });
  await client.customerProfile.update({
    where: { userId },
    // Clear stale payment-method metadata when replacing a stub customer
    // — the stored PM id was also minted in stub mode and won't resolve
    // in Stripe either.
    data: hadStub
      ? {
          stripeCustomerId: customer.id,
          defaultStripePaymentMethodId: null,
          stripePaymentMethodBrand: null,
          stripePaymentMethodLast4: null,
          stripePaymentMethodExpMonth: null,
          stripePaymentMethodExpYear: null,
        }
      : { stripeCustomerId: customer.id },
  });
  await writePaymentAudit(client, {
    action: hadStub ? "stripe_customer.replaced_stub" : "stripe_customer.created",
    entity: "Payment",
    entityId: customer.id,
    userId,
    status: "SUCCESS",
    newData: { stripeCustomerId: customer.id, replacedStub: hadStub },
  });
  return customer.id;
}

export async function createSetupIntentForUser(
  userId: string,
  options: { prisma?: PrismaLike } = {},
): Promise<{ setupIntentId: string; clientSecret: string }> {
  const client = options.prisma ?? defaultPrisma;
  const customerId = await ensureStripeCustomer(userId, { prisma: client });
  const si = await stripeCreateSetupIntent({
    customerId,
    usage: "off_session",
    metadata: { userId },
  });
  return { setupIntentId: si.id, clientSecret: si.clientSecret };
}

export async function persistDefaultPaymentMethod(
  userId: string,
  paymentMethodId: string,
  options: { prisma?: PrismaLike } = {},
): Promise<void> {
  const client = options.prisma ?? defaultPrisma;
  const customerId = await ensureStripeCustomer(userId, { prisma: client });
  const pm = await attachDefaultPaymentMethod({ customerId, paymentMethodId });
  await client.customerProfile.update({
    where: { userId },
    data: {
      defaultStripePaymentMethodId: pm.id,
      stripePaymentMethodBrand: pm.brand ?? null,
      stripePaymentMethodLast4: pm.last4 ?? null,
      stripePaymentMethodExpMonth: pm.expMonth ?? null,
      stripePaymentMethodExpYear: pm.expYear ?? null,
    },
  });
  await writePaymentAudit(client, {
    action: "stripe_payment_method.attached",
    entity: "Payment",
    entityId: pm.id,
    userId,
    status: "SUCCESS",
    newData: { brand: pm.brand, last4: pm.last4 },
  });
  // A fresh card is the cue to re-attempt everything that died on the old
  // one — otherwise the customer fixes their card and nothing ever charges
  // it. Best-effort: a failure here must not break the card save.
  try {
    await reactivateFailedChargesForUser(userId, { prisma: client });
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), userId },
      "persistDefaultPaymentMethod: failed-charge reactivation failed (non-blocking)",
    );
  }
}

/**
 * Put a customer's dead collection attempts back in front of the capture
 * sweep after they save a NEW default card:
 *   - FAILED balance-affecting rows → PENDING with the PI pointer cleared
 *     (the sweep only scans `stripePaymentIntentId: null`).
 *   - PENDING rows stuck on a requires_action PI from the OLD card → cancel
 *     that PI first (a stale portal tab must not be able to confirm it after
 *     the new attempt fires — that would double-charge), then clear the
 *     pointer the same way.
 *
 * The sweep re-attempts within ~5 minutes using the new default PM. A reused
 * idempotency key with different params errors at Stripe and falls through
 * to the capture-retry queue, whose attempt-suffixed keys complete the
 * charge — no double-charge window either way.
 */
export async function reactivateFailedChargesForUser(
  userId: string,
  options: { prisma?: PrismaLike } = {},
): Promise<{ reactivated: number }> {
  const client = options.prisma ?? defaultPrisma;
  const { BALANCE_AFFECTING_CHARGE_TYPES } = await import("./balance-due");
  const rows = await client.payment.findMany({
    where: {
      customerId: userId,
      type: { in: [...BALANCE_AFFECTING_CHARGE_TYPES] },
      OR: [
        { status: "FAILED" },
        { status: "PENDING", stripePaymentIntentId: { not: null } },
      ],
    },
    select: { id: true, status: true, stripePaymentIntentId: true },
  });
  if (rows.length === 0) return { reactivated: 0 };

  const { cancelPaymentIntent } = await import("@/lib/stripe");
  let reactivated = 0;
  for (const row of rows) {
    if (row.status === "PENDING" && row.stripePaymentIntentId) {
      try {
        await cancelPaymentIntent(row.stripePaymentIntentId);
      } catch (err) {
        // Already-succeeded/canceled PIs reject the cancel — skip this row
        // entirely rather than risk a parallel live PI.
        logger.warn(
          { err: err instanceof Error ? err.message : String(err), paymentId: row.id },
          "reactivateFailedCharges: could not cancel stale PI; leaving row untouched",
        );
        continue;
      }
    }
    const res = await client.payment.updateMany({
      // CAS on the observed status so a concurrent capture/webhook flip wins.
      where: { id: row.id, status: row.status },
      data: { status: "PENDING", stripePaymentIntentId: null },
    });
    reactivated += res.count;
  }
  if (reactivated > 0) {
    await writePaymentAudit(client, {
      action: "payment.reactivated_on_new_card",
      entity: "Payment",
      entityId: `customer:${userId}`,
      userId,
      status: "SUCCESS",
      newData: { reactivated },
    });
  }
  return { reactivated };
}

/**
 * KEYSTONE for off-session automation: persist the PaymentMethod a succeeded
 * checkout PI was paid with as the customer's default. The checkout deposit
 * PI carries `setup_future_usage: "off_session"`, so the PM is already
 * attached to the Stripe Customer — but nothing used to write the DB pointer
 * (`defaultStripePaymentMethodId`), which `chargeOffSessionForUser` requires.
 * Result: nearly every automated collection skipped with "no stored PM".
 *
 * Deliberately does NOT call `paymentMethods.attach` (re-attaching a PM that
 * `setup_future_usage` already attached errors) — it only sets the Stripe
 * default via `setCustomerDefaultPaymentMethod` and caches display fields.
 *
 * No-ops when the profile already has a default PM (the customer's explicit
 * choice from the portal wins). Best-effort by contract: callers wrap in
 * try/catch — a failure here must never break a booking confirmation.
 */
export async function persistDefaultPaymentMethodFromIntent(
  userId: string,
  paymentMethodId: string,
  options: { prisma?: PrismaLike } = {},
): Promise<{ persisted: boolean }> {
  const client = options.prisma ?? defaultPrisma;
  const profile = await client.customerProfile.findUnique({
    where: { userId },
    select: { stripeCustomerId: true, defaultStripePaymentMethodId: true },
  });
  if (!profile?.stripeCustomerId || isStubCustomerId(profile.stripeCustomerId)) {
    return { persisted: false };
  }
  if (profile.defaultStripePaymentMethodId) return { persisted: false };

  await setCustomerDefaultPaymentMethod({
    customerId: profile.stripeCustomerId,
    paymentMethodId,
  });
  const pm = await retrievePaymentMethod(paymentMethodId);
  await client.customerProfile.update({
    where: { userId },
    data: {
      defaultStripePaymentMethodId: paymentMethodId,
      stripePaymentMethodBrand: pm?.brand ?? null,
      stripePaymentMethodLast4: pm?.last4 ?? null,
      stripePaymentMethodExpMonth: pm?.expMonth ?? null,
      stripePaymentMethodExpYear: pm?.expYear ?? null,
    },
  });
  await writePaymentAudit(client, {
    action: "stripe_payment_method.backfilled_from_pi",
    entity: "Payment",
    entityId: paymentMethodId,
    userId,
    status: "SUCCESS",
    newData: { brand: pm?.brand, last4: pm?.last4 },
  });
  return { persisted: true };
}

export type ChargeOffSessionResult = OffSessionChargeResult & {
  customerId: string;
  paymentMethodId: string;
};

/**
 * Charge the user's stored default payment method. Returns the Stripe
 * PaymentIntent id + status so the caller (typically the G5 job) can
 * record it on the Payment row and branch on outcome:
 *   - `succeeded`    → mark Payment SUCCEEDED, set stripeChargeId
 *   - `requires_action` → leave Payment PENDING, email customer for 3DS
 *   - `requires_payment_method` / `failed` → mark Payment FAILED, alert
 *
 * The caller supplies `idempotencyKey` (typically the Payment.id) so
 * retries don't double-charge.
 */
export async function chargeOffSessionForUser(args: {
  userId: string;
  amount: number;
  description: string;
  idempotencyKey: string;
  metadata?: Record<string, string>;
  prisma?: PrismaLike;
}): Promise<ChargeOffSessionResult | null> {
  // Child span so the off-session Stripe round-trip (the slowest external hop
  // on every recurring/ancillary charge) is visible under the request or job
  // transaction. No forceTransaction — it must nest, not split the trace.
  return Sentry.startSpan(
    { name: "stripe.charge_offsession", op: "stripe.capture", attributes: { amountAud: args.amount } },
    () => chargeOffSessionForUserImpl(args),
  );
}

async function chargeOffSessionForUserImpl(args: {
  userId: string;
  amount: number;
  description: string;
  idempotencyKey: string;
  metadata?: Record<string, string>;
  prisma?: PrismaLike;
}): Promise<ChargeOffSessionResult | null> {
  const client = args.prisma ?? defaultPrisma;
  const profile = await client.customerProfile.findUnique({
    where: { userId: args.userId },
    select: { stripeCustomerId: true, defaultStripePaymentMethodId: true },
  });
  if (
    !profile?.stripeCustomerId ||
    !profile.defaultStripePaymentMethodId ||
    isStubCustomerId(profile.stripeCustomerId)
  ) {
    logger.info(
      { userId: args.userId, idempotencyKey: args.idempotencyKey },
      "chargeOffSessionForUser: user has no usable stored PM — skipping",
    );
    return null;
  }
  const result = await stripeChargeOffSession({
    customerId: profile.stripeCustomerId,
    paymentMethodId: profile.defaultStripePaymentMethodId,
    amount: args.amount,
    description: args.description,
    idempotencyKey: args.idempotencyKey,
    metadata: { ...(args.metadata ?? {}), userId: args.userId },
  });
  return {
    ...result,
    customerId: profile.stripeCustomerId,
    paymentMethodId: profile.defaultStripePaymentMethodId,
  };
}
