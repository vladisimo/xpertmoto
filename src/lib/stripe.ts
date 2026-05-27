import { getSecret } from "@/lib/integration-config";

export type CreatePaymentIntentArgs = {
  amount: number;
  bookingId: string;
  customerEmail: string;
  description: string;
  // Stripe Customer id the PI should attach the PaymentMethod to. Required
  // whenever a bond hold follows this PI — without it, the PM is
  // single-use and reusing it for the bond authorisation raises
  // "PaymentMethod was previously used with a PaymentIntent without
  // Customer attachment". Callers pass `null` for one-off charges with no
  // reuse (currently unused — always pass a real id).
  customerId?: string | null;
};

export type PaymentIntentResult = {
  id: string;
  clientSecret: string;
  status: "requires_confirmation" | "succeeded";
};

async function getSecretKey(): Promise<string | null> {
  return getSecret("integration:stripe:secretKey", "STRIPE_SECRET_KEY");
}

export async function stripeEnabled(): Promise<boolean> {
  return !!(await getSecretKey());
}

/**
 * G19 — production stub-mode guard.
 *
 * In development / test, an unconfigured Stripe returns deterministic stub
 * ids (`pi_stub_…`) so the app works without a Stripe account. That same
 * behaviour in production would silently "process" payments while moving
 * no money. This guard throws when NODE_ENV === "production" AND neither
 * a SystemSetting secret nor an env var is set, so the app fails loud at
 * first request rather than weeks later at reconciliation.
 *
 * Tests can opt out by setting `ALLOW_STUB_STRIPE=1`.
 */
function assertNotStubbedInProduction(): void {
  if (process.env.NODE_ENV !== "production") return;
  if (process.env.ALLOW_STUB_STRIPE === "1") return;
  throw new Error(
    "Stripe is unconfigured in production (no STRIPE_SECRET_KEY and no integration:stripe:secretKey in SystemSetting). " +
      "Refusing to fall back to stub mode — configure Stripe before accepting payments.",
  );
}

export async function stripeWebhookEnabled(): Promise<boolean> {
  return !!(await getSecret("integration:stripe:webhookSecret", "STRIPE_WEBHOOK_SECRET"));
}

// Hide the stripe require from webpack so the SDK stays optional.
async function getStripeClient(): Promise<unknown | null> {
  const key = await getSecretKey();
  if (!key) return null;
  try {
    const req = eval("require") as NodeRequire;
    const Stripe = req("stripe");
    const Ctor = Stripe.default ?? Stripe;
    return new Ctor(key, { apiVersion: "2024-09-30.acacia" });
  } catch {
    return null;
  }
}

export async function createPaymentIntent(args: CreatePaymentIntentArgs): Promise<PaymentIntentResult> {
  const stripe = (await getStripeClient()) as
    | { paymentIntents: { create: (params: Record<string, unknown>) => Promise<{ id: string; client_secret: string | null; status: string }> } }
    | null;
  if (!stripe) {
    assertNotStubbedInProduction();
    return {
      id: `pi_stub_${args.bookingId}`,
      clientSecret: `cs_stub_${args.bookingId}`,
      status: "succeeded",
    };
  }
  const pi = await stripe.paymentIntents.create({
    amount: Math.round(args.amount * 100),
    currency: "aud",
    description: args.description,
    receipt_email: args.customerEmail,
    metadata: { bookingId: args.bookingId },
    // Card-only. The booking flow takes a bond hold (manual-capture PI)
    // immediately after this charge confirms, and confirmCardPayment only
    // accepts card-type PaymentMethods. Link/wallet types would silently
    // break the bond step.
    payment_method_types: ["card"],
    // Attach the PM to the Stripe Customer + save for future off-session
    // use. Without this pair of params the PM is single-use and the bond
    // hold can't reuse the card the customer just entered — Stripe
    // rejects with "PaymentMethod was previously used with a PaymentIntent
    // without Customer attachment".
    ...(args.customerId ? { customer: args.customerId } : {}),
    setup_future_usage: "off_session",
    // G11 — Let Stripe negotiate 3DS based on issuer + risk. AU cards
    // rarely trigger a challenge, but EU/UK cards do and our client is
    // wired to handle requires_action.
    payment_method_options: { card: { request_three_d_secure: "automatic" } },
  });
  return {
    id: pi.id,
    clientSecret: pi.client_secret ?? "",
    status: pi.status === "succeeded" ? "succeeded" : "requires_confirmation",
  };
}

/**
 * Cancel an uncaptured PaymentIntent — used for bond holds that need to
 * be released before auto-expiry (e.g. customer cancels their booking
 * before pickup). Returns true when Stripe acknowledged the cancel, false
 * when Stripe isn't configured (stub mode) or the intent id looks like
 * a stub — caller still updates the ledger in that case.
 */
export async function cancelPaymentIntent(paymentIntentId: string | null | undefined): Promise<boolean> {
  if (!paymentIntentId || paymentIntentId.startsWith("pi_stub_") || paymentIntentId.startsWith("pi_bond_stub_")) {
    return false;
  }
  const stripe = (await getStripeClient()) as
    | { paymentIntents: { cancel: (id: string) => Promise<{ id: string; status: string }> } }
    | null;
  if (!stripe) return false;
  await stripe.paymentIntents.cancel(paymentIntentId);
  return true;
}

/**
 * Retrieve a PaymentIntent's status from Stripe. Used by the server to
 * verify a client-confirmed PaymentIntent actually succeeded before we
 * mark the booking CONFIRMED. Returns `null` when Stripe isn't configured
 * (stub mode) or the id has a stub prefix — caller should treat that as
 * "trust the client" (dev behaviour).
 *
 * For a normal rental charge expect status === "succeeded". For a bond
 * hold (manual capture) expect status === "requires_capture" after a
 * successful confirm.
 */
export async function retrievePaymentIntent(
  paymentIntentId: string | null | undefined,
): Promise<{
  id: string;
  status: string;
  amountCents: number;
  latestChargeId: string | null;
} | null> {
  if (
    !paymentIntentId ||
    paymentIntentId.startsWith("pi_stub_") ||
    paymentIntentId.startsWith("pi_bond_stub_")
  ) {
    return null;
  }
  const stripe = (await getStripeClient()) as
    | {
        paymentIntents: {
          retrieve: (id: string) => Promise<{
            id: string;
            status: string;
            amount: number;
            latest_charge: string | null;
          }>;
        };
      }
    | null;
  if (!stripe) return null;
  const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
  return {
    id: pi.id,
    status: pi.status,
    amountCents: pi.amount,
    latestChargeId: pi.latest_charge,
  };
}

// Phase E — hosted Stripe Checkout for "Pay now" links. Given an
// amount and a list of Payment ids to mark SUCCEEDED on completion,
// returns a redirect URL the customer hits in their browser. Stripe
// hosts the card entry + 3DS flow, then our success webhook (or the
// return_url handler) flips the Payment rows to SUCCEEDED.
export type CreateCheckoutSessionArgs = {
  amount: number;
  customerEmail: string;
  description: string;
  metadata?: Record<string, string>;
  successUrl: string;
  cancelUrl: string;
  customerId?: string | null;
};

export type CheckoutSessionResult = {
  id: string;
  url: string;
};

export async function createCheckoutSession(
  args: CreateCheckoutSessionArgs,
): Promise<CheckoutSessionResult> {
  const stripe = (await getStripeClient()) as
    | {
        checkout: {
          sessions: {
            create: (params: Record<string, unknown>) => Promise<{ id: string; url: string | null }>;
          };
        };
      }
    | null;
  if (!stripe) {
    assertNotStubbedInProduction();
    // Stub returns a URL that bounces straight back to successUrl so the
    // customer portal "Pay now" flow exercises end-to-end in dev.
    const id = `cs_stub_${Date.now()}`;
    return { id, url: `${args.successUrl}${args.successUrl.includes("?") ? "&" : "?"}stub=${id}` };
  }
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    line_items: [
      {
        price_data: {
          currency: "aud",
          unit_amount: Math.round(args.amount * 100),
          product_data: { name: args.description },
        },
        quantity: 1,
      },
    ],
    customer: args.customerId ?? undefined,
    customer_email: args.customerId ? undefined : args.customerEmail,
    metadata: args.metadata ?? {},
    success_url: args.successUrl,
    cancel_url: args.cancelUrl,
  });
  return { id: session.id, url: session.url ?? args.successUrl };
}

// Phase C — refund processing. Given an existing Stripe charge or
// PaymentIntent, refund `amount` cents (full refund when amount is null).
// Returns the Stripe refund id on success; `null` in stub mode. Errors
// propagate so callers can mark the Payment row FAILED and surface a
// message to staff.
export type RefundChargeArgs = {
  // Prefer paymentIntentId (the XPERT Moto Payment row stores both; we
  // fall back to chargeId when only that is known).
  paymentIntentId?: string | null;
  chargeId?: string | null;
  amountCents: number; // pass 0 to refund the whole original charge
  reason?: "duplicate" | "fraudulent" | "requested_by_customer";
  metadata?: Record<string, string>;
  idempotencyKey?: string;
};

export type RefundChargeResult = {
  id: string;
  status: "succeeded" | "pending" | "failed" | "canceled";
  amountCents: number;
};

export async function refundCharge(args: RefundChargeArgs): Promise<RefundChargeResult> {
  const isStub =
    (args.paymentIntentId?.startsWith("pi_stub_") ||
      args.paymentIntentId?.startsWith("pi_bond_stub_") ||
      args.paymentIntentId?.startsWith("pi_offsession_stub_") ||
      args.chargeId?.startsWith("ch_stub_")) ??
    false;

  const stripe = (await getStripeClient()) as
    | {
        refunds: {
          create: (
            params: Record<string, unknown>,
            opts?: { idempotencyKey?: string },
          ) => Promise<{ id: string; status: string; amount: number }>;
        };
      }
    | null;

  if (!stripe || isStub) {
    assertNotStubbedInProduction();
    // Stub: mimic a successful refund so the caller can exercise the
    // post-refund path (Payment row → SUCCEEDED + status update).
    return {
      id: `re_stub_${Date.now()}`,
      status: "succeeded",
      amountCents: args.amountCents,
    };
  }

  if (!args.paymentIntentId && !args.chargeId) {
    throw new Error("refundCharge requires either paymentIntentId or chargeId");
  }

  const params: Record<string, unknown> = {
    metadata: args.metadata ?? {},
  };
  if (args.paymentIntentId) params.payment_intent = args.paymentIntentId;
  else if (args.chargeId) params.charge = args.chargeId;
  if (args.amountCents > 0) params.amount = args.amountCents;
  if (args.reason) params.reason = args.reason;

  const refund = await stripe.refunds.create(params, {
    idempotencyKey: args.idempotencyKey,
  });
  return {
    id: refund.id,
    status: refund.status as RefundChargeResult["status"],
    amountCents: refund.amount,
  };
}

export async function createBondHold(args: CreatePaymentIntentArgs): Promise<PaymentIntentResult> {
  const stripe = (await getStripeClient()) as
    | { paymentIntents: { create: (params: Record<string, unknown>) => Promise<{ id: string; client_secret: string | null; status: string }> } }
    | null;
  if (!stripe) {
    assertNotStubbedInProduction();
    return {
      id: `pi_bond_stub_${args.bookingId}`,
      clientSecret: `cs_bond_stub_${args.bookingId}`,
      status: "succeeded",
    };
  }
  const pi = await stripe.paymentIntents.create({
    amount: Math.round(args.amount * 100),
    currency: "aud",
    capture_method: "manual",
    description: `Bond hold — ${args.description}`,
    metadata: { bookingId: args.bookingId, type: "bond" },
    // Card-only — manual-capture PIs must use card-type PMs, and we
    // reuse the card from the rental charge to confirm this one.
    payment_method_types: ["card"],
    // Attach to the Stripe Customer so the rental-charge PM (saved via
    // setup_future_usage) is resolvable here.
    ...(args.customerId ? { customer: args.customerId } : {}),
    // G11 — bond holds get the same automatic 3DS treatment.
    payment_method_options: { card: { request_three_d_secure: "automatic" } },
  });
  return {
    id: pi.id,
    clientSecret: pi.client_secret ?? "",
    status: pi.status === "succeeded" ? "succeeded" : "requires_confirmation",
  };
}

// ============================================================================
// G6 — Stripe Customer + Setup Intent + off-session charge primitives.
//
// Enables delayed capture via stored payment methods. Every function is
// null-safe in stub mode (no STRIPE_SECRET_KEY) so local dev and tests
// without Stripe still get deterministic shapes back.
// ============================================================================

export type StripeCustomerStub = { id: string };

/**
 * Create a Stripe Customer object, storing our userId in metadata. Called
 * once per user on first booking / first stored-PM attempt. The caller
 * persists the returned id on CustomerProfile.stripeCustomerId.
 */
export async function createStripeCustomer(args: {
  userId: string;
  email: string;
  name?: string | null;
  phone?: string | null;
}): Promise<StripeCustomerStub> {
  const stripe = (await getStripeClient()) as
    | { customers: { create: (params: Record<string, unknown>) => Promise<{ id: string }> } }
    | null;
  if (!stripe) {
    assertNotStubbedInProduction();
    return { id: `cus_stub_${args.userId}` };
  }
  const customer = await stripe.customers.create({
    email: args.email,
    name: args.name ?? undefined,
    phone: args.phone ?? undefined,
    metadata: { userId: args.userId },
  });
  return { id: customer.id };
}

export type SetupIntentResult = {
  id: string;
  clientSecret: string;
};

/**
 * Create a SetupIntent for collecting and saving a card without charging.
 * The client confirms it via Stripe Elements; on success Stripe fires
 * `setup_intent.succeeded` (we poll on confirmSetupIntent from the tRPC
 * layer rather than subscribing — fewer moving parts for P0).
 */
export async function createSetupIntent(args: {
  customerId: string;
  usage?: "off_session" | "on_session";
  metadata?: Record<string, string>;
}): Promise<SetupIntentResult> {
  const stripe = (await getStripeClient()) as
    | { setupIntents: { create: (params: Record<string, unknown>) => Promise<{ id: string; client_secret: string | null }> } }
    | null;
  if (!stripe) {
    assertNotStubbedInProduction();
    return { id: `seti_stub_${args.customerId}`, clientSecret: `cs_seti_stub_${args.customerId}` };
  }
  const si = await stripe.setupIntents.create({
    customer: args.customerId,
    usage: args.usage ?? "off_session",
    payment_method_types: ["card"],
    metadata: args.metadata ?? {},
  });
  return { id: si.id, clientSecret: si.client_secret ?? "" };
}

export type StripePaymentMethodInfo = {
  id: string;
  brand?: string | null;
  last4?: string | null;
  expMonth?: number | null;
  expYear?: number | null;
};

/**
 * Typed error thrown when Stripe rejects an attach / default-PM call.
 * Callers (tRPC procedures, jobs) can map `code` to a user-facing response
 * without having to duck-type the raw Stripe SDK error.
 *
 * `code` is Stripe's machine-readable code when available (e.g.
 * `resource_missing`, `payment_method_unexpected_state`) — falls back to a
 * local sentinel for unexpected throws.
 */
export class StripePaymentMethodError extends Error {
  readonly code: string;
  readonly stripeType?: string;
  readonly stripeRequestId?: string;
  readonly userMessage: string;
  constructor(args: {
    code: string;
    message: string;
    userMessage: string;
    stripeType?: string;
    stripeRequestId?: string;
  }) {
    super(args.message);
    this.name = "StripePaymentMethodError";
    this.code = args.code;
    this.stripeType = args.stripeType;
    this.stripeRequestId = args.stripeRequestId;
    this.userMessage = args.userMessage;
  }
}

/**
 * Turn a thrown value from the Stripe SDK into the fields we care about —
 * `code`, `type`, `message`, `requestId` — without leaking PAN/CVV.
 */
function describeStripeError(err: unknown): {
  code: string;
  type?: string;
  message: string;
  requestId?: string;
} {
  const anyErr = err as {
    code?: string;
    type?: string;
    message?: string;
    requestId?: string;
    raw?: { code?: string; type?: string; message?: string; request_log_url?: string };
  };
  return {
    code: anyErr.code ?? anyErr.raw?.code ?? "stripe_unknown_error",
    type: anyErr.type ?? anyErr.raw?.type,
    message: (anyErr.message ?? anyErr.raw?.message ?? "Stripe request failed").slice(0, 256),
    requestId: anyErr.requestId,
  };
}

/**
 * Stripe error code → short user-facing message. Everything not listed
 * falls through to a generic "we couldn't save your card" string.
 */
function paymentMethodUserMessage(code: string): string {
  switch (code) {
    case "resource_missing":
      return "That payment method could not be found — please try adding the card again.";
    case "payment_method_unexpected_state":
    case "customer_mismatch":
      return "This card is already linked to a different account. Remove it from the other account or use a different card.";
    case "card_declined":
      return "Your bank declined this card. Try another card or contact your bank.";
    case "incorrect_cvc":
    case "invalid_cvc":
      return "The CVC on this card looks wrong. Double-check the number on the back of the card.";
    case "expired_card":
      return "This card has expired. Please use a different card.";
    case "api_key_expired":
    case "authentication_required":
      return "We couldn't reach our payment provider. Please try again in a moment.";
    default:
      return "We couldn't save your payment method. Please try again or use a different card.";
  }
}

/**
 * Retrieve a PaymentMethod, attach it to the customer, and mark it default.
 * Called after the client confirms the SetupIntent. Returns cached display
 * fields (brand, last4, expiry) — not PAN or CVV.
 *
 * Throws `StripePaymentMethodError` on Stripe rejection so callers can map
 * the code to a user-facing TRPCError rather than surfacing INTERNAL_SERVER_ERROR.
 */
export async function attachDefaultPaymentMethod(args: {
  customerId: string;
  paymentMethodId: string;
}): Promise<StripePaymentMethodInfo> {
  const stripe = (await getStripeClient()) as
    | {
        paymentMethods: {
          attach: (id: string, params: Record<string, unknown>) => Promise<{
            id: string;
            card?: { brand?: string; last4?: string; exp_month?: number; exp_year?: number } | null;
          }>;
        };
        customers: {
          update: (id: string, params: Record<string, unknown>) => Promise<{ id: string }>;
        };
      }
    | null;
  if (!stripe) {
    return { id: args.paymentMethodId };
  }
  let pm: Awaited<ReturnType<typeof stripe.paymentMethods.attach>>;
  try {
    pm = await stripe.paymentMethods.attach(args.paymentMethodId, { customer: args.customerId });
  } catch (err) {
    const d = describeStripeError(err);
    throw new StripePaymentMethodError({
      code: d.code,
      message: `Stripe attach failed: ${d.message}`,
      userMessage: paymentMethodUserMessage(d.code),
      stripeType: d.type,
      stripeRequestId: d.requestId,
    });
  }
  try {
    await stripe.customers.update(args.customerId, {
      invoice_settings: { default_payment_method: args.paymentMethodId },
    });
  } catch (err) {
    const d = describeStripeError(err);
    throw new StripePaymentMethodError({
      code: d.code,
      message: `Stripe customers.update failed: ${d.message}`,
      userMessage: paymentMethodUserMessage(d.code),
      stripeType: d.type,
      stripeRequestId: d.requestId,
    });
  }
  return {
    id: pm.id,
    brand: pm.card?.brand ?? null,
    last4: pm.card?.last4 ?? null,
    expMonth: pm.card?.exp_month ?? null,
    expYear: pm.card?.exp_year ?? null,
  };
}

export type OffSessionChargeArgs = {
  customerId: string;
  paymentMethodId: string;
  amount: number; // AUD major units
  description: string;
  metadata?: Record<string, string>;
  idempotencyKey?: string;
};

export type OffSessionChargeResult = {
  id: string;
  status: "succeeded" | "requires_action" | "requires_payment_method" | "failed";
  errorCode?: string;
  errorMessage?: string;
  chargeId?: string | null;
};

/**
 * Off-session PaymentIntent — used by the capture-pending-payments job (G5)
 * to charge a stored PM for delayed recoveries. The `off_session: true` +
 * `confirm: true` combination skips 3DS challenge prompts; if the issuer
 * still mandates one, Stripe returns `requires_action` and the job enqueues
 * a customer email to complete authentication manually.
 *
 * Caller must pass a stable `idempotencyKey` (e.g. payment row id) so
 * retries don't double-charge.
 */
export async function chargeOffSession(args: OffSessionChargeArgs): Promise<OffSessionChargeResult> {
  const stripe = (await getStripeClient()) as
    | {
        paymentIntents: {
          create: (
            params: Record<string, unknown>,
            opts?: { idempotencyKey?: string },
          ) => Promise<{ id: string; status: string; latest_charge: string | null }>;
        };
      }
    | null;
  if (!stripe) {
    assertNotStubbedInProduction();
    return {
      id: `pi_offsession_stub_${args.idempotencyKey ?? Date.now()}`,
      status: "succeeded",
      chargeId: `ch_stub_${Date.now()}`,
    };
  }
  try {
    const pi = await stripe.paymentIntents.create(
      {
        amount: Math.round(args.amount * 100),
        currency: "aud",
        customer: args.customerId,
        payment_method: args.paymentMethodId,
        off_session: true,
        confirm: true,
        description: args.description,
        metadata: args.metadata ?? {},
      },
      args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : undefined,
    );
    const status =
      pi.status === "succeeded"
        ? ("succeeded" as const)
        : pi.status === "requires_action"
          ? ("requires_action" as const)
          : pi.status === "requires_payment_method"
            ? ("requires_payment_method" as const)
            : ("failed" as const);
    return { id: pi.id, status, chargeId: pi.latest_charge };
  } catch (err) {
    // Stripe throws for hard declines; extract code + message without PII.
    const anyErr = err as { code?: string; message?: string; raw?: { payment_intent?: { id?: string } } };
    return {
      id: anyErr.raw?.payment_intent?.id ?? "pi_unknown",
      status: "failed",
      errorCode: anyErr.code ?? "stripe_error",
      errorMessage: (anyErr.message ?? "Stripe charge failed").slice(0, 256),
    };
  }
}

// ============================================================================
// G3 — Reconciliation: paginate /v1/balance_transactions.
// ============================================================================

export type StripeBalanceTransaction = {
  id: string;
  type: string; // charge, refund, payout, stripe_fee, adjustment, ...
  amount: number; // cents, signed
  fee: number;
  net: number;
  currency: string;
  created: number; // unix seconds
  source?: string | null; // charge id etc.
  paymentIntent?: string | null; // payment-intent the charge belongs to (via data.source expand)
  reporting_category?: string | null;
};

/** Raw `source` after a `data.source` expand: a charge object or a bare id. */
type ExpandedSource =
  | string
  | null
  | { id?: string | null; payment_intent?: string | { id?: string | null } | null };

function extractSourceIds(source: ExpandedSource): {
  sourceId: string | null;
  paymentIntent: string | null;
} {
  if (!source) return { sourceId: null, paymentIntent: null };
  if (typeof source === "string") return { sourceId: source, paymentIntent: null };
  const pi = source.payment_intent;
  return {
    sourceId: source.id ?? null,
    paymentIntent: typeof pi === "string" ? pi : (pi?.id ?? null),
  };
}

export type StripePage<T> = {
  data: T[];
  has_more: boolean;
  last_id?: string;
};

export async function listBalanceTransactions(args: {
  createdGte?: number;
  createdLte?: number;
  startingAfter?: string;
  limit?: number;
}): Promise<StripePage<StripeBalanceTransaction>> {
  const stripe = (await getStripeClient()) as
    | {
        balanceTransactions: {
          list: (
            params: Record<string, unknown>,
          ) => Promise<{
            data: (Omit<StripeBalanceTransaction, "source"> & { source?: ExpandedSource })[];
            has_more: boolean;
          }>;
        };
      }
    | null;
  if (!stripe) return { data: [], has_more: false };
  const res = await stripe.balanceTransactions.list({
    limit: args.limit ?? 100,
    // Expand the charge behind each txn so we can record its payment-intent —
    // the join key for Payments whose charge id isn't backfilled yet. Same
    // request, no extra API calls.
    expand: ["data.source"],
    ...(args.startingAfter ? { starting_after: args.startingAfter } : {}),
    ...(args.createdGte || args.createdLte
      ? {
          created: {
            ...(args.createdGte ? { gte: args.createdGte } : {}),
            ...(args.createdLte ? { lte: args.createdLte } : {}),
          },
        }
      : {}),
  });
  const data: StripeBalanceTransaction[] = res.data.map((t) => {
    const { sourceId, paymentIntent } = extractSourceIds(t.source ?? null);
    return { ...t, source: sourceId, paymentIntent };
  });
  const last = data[data.length - 1];
  return { data, has_more: res.has_more, last_id: last?.id };
}

export type StripeWebhookEvent = {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
};

export async function constructWebhookEvent(
  rawBody: string,
  signature: string | null,
): Promise<StripeWebhookEvent | null> {
  if (!signature) return null;
  const secret = await getSecret("integration:stripe:webhookSecret", "STRIPE_WEBHOOK_SECRET");
  if (!secret) return null;
  const stripe = (await getStripeClient()) as
    | { webhooks: { constructEvent: (body: string, sig: string, secret: string) => StripeWebhookEvent } }
    | null;
  if (!stripe) return null;
  return stripe.webhooks.constructEvent(rawBody, signature, secret);
}
