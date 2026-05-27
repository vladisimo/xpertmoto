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
