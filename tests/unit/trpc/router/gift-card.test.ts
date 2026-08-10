import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

/**
 * Mirror test for src/server/trpc/router/gift-card.ts.
 *
 * Scope is the ROUTER layer: input validation, auth gating, service
 * invocation, transaction composition and response shaping. The gift-card
 * *service* is stubbed — its own money rules (code generation, balance CAS,
 * activation idempotency) are covered by
 * tests/unit/server/services/gift-card.test.ts — so these specs can assert
 * exactly what the router hands the service and what it does with the result.
 *
 * Money invariants asserted here:
 *  - purchase forwards the face value to Stripe unsplit (a voucher sale is
 *    not a taxable supply — GST attaches on redemption), to the exact cent;
 *  - redemption debits the card and credits the booking inside ONE
 *    transaction, keyed by a deterministic reference (single-claim), and is
 *    booked as the non-cash payment type GIFT_CARD_REDEMPTION;
 *  - a redemption can never push the booking balance negative.
 */

const rateLimitMock = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: (...args: unknown[]) => rateLimitMock(...args),
}));

vi.mock("@/server/services/audit", () => ({
  writeAudit: (...args: unknown[]) => writeAuditMock(...args),
  writeAuditAsync: vi.fn(),
  skipAutoAudit: vi.fn(),
  captureBookingId: vi.fn(),
  readCapturedBookingId: vi.fn(),
  captureCustomerId: vi.fn(),
  readCapturedCustomerId: vi.fn(),
}));

vi.mock("@/lib/branding", () => ({
  getBranding: vi.fn().mockResolvedValue({
    siteName: "XPERT Moto",
    legalName: "XPERT Moto Group Pty Ltd",
    abn: "72 629 456 408",
  }),
}));

vi.mock("@/lib/stripe", () => ({
  createPaymentIntent: (...args: unknown[]) => createPaymentIntentMock(...args),
}));

vi.mock("@/server/services/gift-card", () => ({
  issueGiftCard: (...args: unknown[]) => issueGiftCardMock(...args),
  activateGiftCardOnPayment: (...args: unknown[]) => activateMock(...args),
  deliverGiftCardEmail: (...args: unknown[]) => deliverMock(...args),
  getActiveBalance: (...args: unknown[]) => getActiveBalanceMock(...args),
  redeemGiftCardTx: (...args: unknown[]) => redeemGiftCardTxMock(...args),
}));

const writeAuditMock = vi.fn();
const createPaymentIntentMock = vi.fn();
const issueGiftCardMock = vi.fn();
const activateMock = vi.fn();
const deliverMock = vi.fn();
const getActiveBalanceMock = vi.fn();
const redeemGiftCardTxMock = vi.fn();

import { giftCardRouter } from "@/server/trpc/router/gift-card";

type Row = Record<string, unknown>;

const CARD = { id: "gc_1", code: "SCOOT-ABCDEFGHJKLMNP" };

interface Over {
  anon?: boolean;
  role?: "CUSTOMER" | "STAFF" | "MANAGER" | "ADMIN" | "SUPER_ADMIN";
  userId?: string;
  email?: string | null;
  /** giftCard.findUnique — the `lookup` row. */
  card?: Row | null;
  /** booking.findUniqueOrThrow — the booking being paid down. */
  booking?: Row;
  /** Rejection for booking.findUniqueOrThrow (unknown booking id). */
  bookingError?: Error;
  /** booking.updateMany result — count 0 means the balanceDue CAS lost. */
  bookingCasCount?: number;
  /** Rejection for payment.create (e.g. the P2002 idempotency collision). */
  paymentError?: Error;
  /** giftCard.findMany — `listMine` rows. */
  mine?: Row[];
}

function makeCtx(over: Over = {}) {
  const giftCard = {
    findUnique: vi.fn().mockResolvedValue("card" in over ? over.card : null),
    findMany: vi.fn().mockResolvedValue(over.mine ?? []),
    update: vi
      .fn()
      .mockImplementation(({ where, data }: { where: Row; data: Row }) =>
        Promise.resolve({ id: where.id, ...data }),
      ),
  };
  const payment = {
    create: over.paymentError
      ? vi.fn().mockRejectedValue(over.paymentError)
      : vi.fn().mockResolvedValue({ id: "pay_1" }),
  };
  const booking = {
    findUniqueOrThrow: over.bookingError
      ? vi.fn().mockRejectedValue(over.bookingError)
      : vi.fn().mockResolvedValue(
          over.booking ?? { id: "bk_1", customerId: "u1", balanceDue: 200, amountPaid: 0 },
        ),
    updateMany: vi.fn().mockResolvedValue({ count: over.bookingCasCount ?? 1 }),
  };

  // One tx client shared with the top-level prisma stub so writes made inside
  // the transaction are observable, and so a spec can assert the service was
  // handed the *tx* client rather than the connection (that's what makes the
  // debit roll back with the rest of the redemption).
  const tx = { giftCard, payment, booking };
  let rolledBack = false;
  const $transaction = vi.fn(async (fn: (client: typeof tx) => unknown) => {
    try {
      return await fn(tx);
    } catch (err) {
      rolledBack = true;
      throw err;
    }
  });

  const prisma = { giftCard, payment, booking, $transaction };

  const sessionUser = {
    id: over.userId ?? "u1",
    role: over.role ?? "CUSTOMER",
    email: "email" in over ? over.email : "rider@example.com",
  };
  const ctx = {
    prisma,
    session: over.anon ? null : { user: sessionUser },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    reqId: "r1",
  };

  return {
    ctx,
    prisma,
    tx,
    giftCard,
    payment,
    booking,
    $transaction,
    didRollBack: () => rolledBack,
    caller: giftCardRouter.createCaller(ctx as never),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  rateLimitMock.mockResolvedValue({ ok: true, remaining: 2, resetAt: 0 });
  writeAuditMock.mockResolvedValue(undefined);
  issueGiftCardMock.mockResolvedValue({ ...CARD });
  createPaymentIntentMock.mockResolvedValue({
    id: "pi_live_1",
    clientSecret: "cs_live_1",
    status: "requires_confirmation",
  });
  activateMock.mockResolvedValue({ activated: true });
  deliverMock.mockResolvedValue(undefined);
  getActiveBalanceMock.mockResolvedValue(50);
  redeemGiftCardTxMock.mockResolvedValue({
    id: CARD.id,
    code: CARD.code,
    balance: new Prisma.Decimal("57.65"),
    status: "ACTIVE",
  });
});

const PURCHASE = {
  amount: 125.55,
  purchaserEmail: "gifter@example.com",
  recipientEmail: "rider@example.com",
};

describe("giftCard.purchase", () => {
  it("issues a PENDING card for an anonymous purchaser and returns the PI client secret", async () => {
    const { caller, prisma } = makeCtx({ anon: true });

    const result = await caller.purchase({
      ...PURCHASE,
      recipientName: "Rider",
      personalMessage: "Ride safe",
    });

    expect(issueGiftCardMock).toHaveBeenCalledWith(prisma, {
      amount: 125.55,
      purchasedById: null,
      purchaserEmail: "gifter@example.com",
      recipientEmail: "rider@example.com",
      recipientName: "Rider",
      personalMessage: "Ride safe",
      scheduledDeliveryAt: undefined,
    });
    expect(result).toEqual({
      giftCardId: "gc_1",
      code: CARD.code,
      paymentClientSecret: "cs_live_1",
      paymentIntentId: "pi_live_1",
    });
  });

  it("charges the face value to the exact cent, unsplit — voucher sale carries no GST line", async () => {
    const { caller } = makeCtx({ anon: true });

    await caller.purchase({ ...PURCHASE, amount: 199.95 });

    expect(createPaymentIntentMock).toHaveBeenCalledTimes(1);
    const args = createPaymentIntentMock.mock.calls[0]?.[0];
    expect(args).toMatchObject({
      amount: 199.95,
      bookingId: "GIFT-gc_1",
      customerEmail: "gifter@example.com",
      metadata: { giftCardId: "gc_1" },
    });
    // Branding-driven description — never a hardcoded trading name.
    expect(args.description).toBe(`XPERT Moto gift card purchase (${CARD.code})`);
  });

  it("attributes the purchase to the signed-in user and audits under their id", async () => {
    const { caller, prisma } = makeCtx({ userId: "u9" });

    await caller.purchase(PURCHASE);

    expect(issueGiftCardMock).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ purchasedById: "u9" }),
    );
    expect(writeAuditMock).toHaveBeenCalledWith(prisma, {
      userId: "u9",
      action: "GIFT_CARD_PURCHASED",
      entity: "GiftCard",
      entityId: "gc_1",
      newData: {
        code: CARD.code,
        amount: 125.55,
        recipientEmail: "rider@example.com",
      },
    });
  });

  it("correlates the card with its PaymentIntent so the webhook can find it", async () => {
    const { caller, giftCard } = makeCtx({ anon: true });

    await caller.purchase(PURCHASE);

    expect(giftCard.update).toHaveBeenCalledWith({
      where: { id: "gc_1" },
      data: { stripePaymentIntentId: "pi_live_1" },
    });
  });

  it("leaves activation to the webhook for a real PaymentIntent", async () => {
    const { caller } = makeCtx({ anon: true });

    await caller.purchase(PURCHASE);

    expect(activateMock).not.toHaveBeenCalled();
    expect(deliverMock).not.toHaveBeenCalled();
  });

  it("activates and delivers inline in stub-Stripe mode (no webhook will arrive)", async () => {
    createPaymentIntentMock.mockResolvedValue({
      id: "pi_stub_GIFT-gc_1",
      clientSecret: "cs_stub_GIFT-gc_1",
      status: "succeeded",
    });
    const { caller, prisma } = makeCtx({ anon: true });

    await caller.purchase(PURCHASE);

    expect(activateMock).toHaveBeenCalledWith(prisma, {
      giftCardId: "gc_1",
      stripePaymentIntentId: "pi_stub_GIFT-gc_1",
    });
    expect(deliverMock).toHaveBeenCalledWith(prisma, "gc_1");
  });

  it("skips the recipient email when the stub activation was a no-op (already ACTIVE)", async () => {
    createPaymentIntentMock.mockResolvedValue({
      id: "pi_stub_GIFT-gc_1",
      clientSecret: "cs_stub_GIFT-gc_1",
      status: "succeeded",
    });
    activateMock.mockResolvedValue({ activated: false });
    const { caller } = makeCtx({ anon: true });

    await caller.purchase(PURCHASE);

    expect(activateMock).toHaveBeenCalledTimes(1);
    expect(deliverMock).not.toHaveBeenCalled();
  });

  it("coerces a scheduled delivery date string into a Date for the service", async () => {
    const { caller } = makeCtx({ anon: true });

    // Cast: over the wire this field arrives as a string; z.coerce.date()
    // is what turns it into a Date, and that is the behaviour under test.
    await caller.purchase({
      ...PURCHASE,
      scheduledDeliveryAt: "2026-12-24T09:00:00.000Z",
    } as never);

    const args = issueGiftCardMock.mock.calls[0]?.[1];
    expect(args.scheduledDeliveryAt).toBeInstanceOf(Date);
    expect(args.scheduledDeliveryAt.toISOString()).toBe("2026-12-24T09:00:00.000Z");
  });

  it.each([
    ["below the A$25 floor", { amount: 24.99 }],
    ["zero", { amount: 0 }],
    ["negative", { amount: -100 }],
    ["above the A$2000 cap", { amount: 2000.01 }],
    ["a malformed purchaser email", { purchaserEmail: "not-an-email" }],
    ["a malformed recipient email", { recipientEmail: "rider@" }],
    ["an over-long personal message", { personalMessage: "x".repeat(501) }],
  ])("rejects %s before issuing anything", async (_label, patch) => {
    const { caller } = makeCtx({ anon: true });

    await expect(caller.purchase({ ...PURCHASE, ...patch } as never)).rejects.toThrow();
    expect(issueGiftCardMock).not.toHaveBeenCalled();
    expect(createPaymentIntentMock).not.toHaveBeenCalled();
  });

  it("rate-limits purchases at 3/hour — by IP only, the per-email bucket never engages", async () => {
    const { caller } = makeCtx({ anon: true });

    await caller.purchase(PURCHASE);

    expect(rateLimitMock).toHaveBeenCalledWith("gift:purchase:ip:unknown", 3, 3600);
    // Documents current behaviour: the middleware is composed with `.use()`
    // BEFORE `.input()`, so tRPC has not run the parser yet and the
    // middleware's `input` is undefined — `identifier: input?.purchaserEmail`
    // resolves to undefined and no second (per-email) bucket is checked.
    // See the note in the PR description.
    expect(rateLimitMock).toHaveBeenCalledTimes(1);
    expect(rateLimitMock).not.toHaveBeenCalledWith(
      "gift:purchase:id:gifter@example.com",
      3,
      3600,
    );
  });

  it("returns TOO_MANY_REQUESTS without issuing a card once the bucket is spent", async () => {
    rateLimitMock.mockResolvedValue({ ok: false, remaining: 0, resetAt: 0 });
    const { caller } = makeCtx({ anon: true });

    await expect(caller.purchase(PURCHASE)).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
    });
    expect(issueGiftCardMock).not.toHaveBeenCalled();
  });
});

describe("giftCard.lookup", () => {
  const CARD_ROW = {
    code: CARD.code,
    initialAmount: new Prisma.Decimal("100.00"),
    balance: new Prisma.Decimal("50.00"),
    status: "ACTIVE",
    expiresAt: new Date("2029-01-01T00:00:00.000Z"),
    recipientName: "Rider",
  };

  it("returns the public card fields plus the spendable balance to an anonymous visitor", async () => {
    const { caller, giftCard, prisma } = makeCtx({ anon: true, card: CARD_ROW });

    const result = await caller.lookup({ code: CARD.code });

    expect(result).toMatchObject({ code: CARD.code, status: "ACTIVE", activeBalance: 50 });
    expect(getActiveBalanceMock).toHaveBeenCalledWith(prisma, CARD.code);
    // Only non-sensitive columns leave the router — no purchaser email,
    // personal message or Stripe ids on this public endpoint.
    expect(giftCard.findUnique).toHaveBeenCalledWith({
      where: { code: CARD.code },
      select: {
        code: true,
        initialAmount: true,
        balance: true,
        status: true,
        expiresAt: true,
        recipientName: true,
      },
    });
  });

  it("reports a zero spendable balance for a card the service treats as unusable", async () => {
    // Expired / PENDING / VOIDED: the stored balance is still shown, but
    // activeBalance is what the booking flow may draw on.
    getActiveBalanceMock.mockResolvedValue(0);
    const { caller } = makeCtx({
      anon: true,
      card: { ...CARD_ROW, status: "EXPIRED" },
    });

    const result = await caller.lookup({ code: CARD.code });

    expect(result.activeBalance).toBe(0);
    expect(Number(result.balance)).toBe(50);
  });

  it("throws NOT_FOUND for an unknown code", async () => {
    const { caller } = makeCtx({ anon: true, card: null });

    await expect(caller.lookup({ code: "SCOOT-NOPE" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("rejects a code shorter than 6 characters without touching the DB", async () => {
    const { caller, giftCard } = makeCtx({ anon: true });

    await expect(caller.lookup({ code: "SCOOT" })).rejects.toThrow();
    expect(getActiveBalanceMock).not.toHaveBeenCalled();
    expect(giftCard.findUnique).not.toHaveBeenCalled();
  });
});

describe("giftCard.redeem", () => {
  const REDEEM = { code: CARD.code, bookingId: "bk_1", amount: 42.35 };

  it("debits the card and credits the booking in one transaction, returning the new balance", async () => {
    const { caller, tx, payment, booking, $transaction } = makeCtx();

    const result = await caller.redeem(REDEEM);

    expect($transaction).toHaveBeenCalledTimes(1);
    // The service gets the *tx* client, not the connection — that is what
    // makes the debit roll back if any write below fails.
    expect(redeemGiftCardTxMock).toHaveBeenCalledWith(tx, {
      code: CARD.code,
      amount: 42.35,
      bookingId: "bk_1",
    });
    expect(payment.create).toHaveBeenCalledWith({
      data: {
        reference: `GC-REDEEM-bk_1-${CARD.id}`,
        customerId: "u1",
        bookingId: "bk_1",
        type: "GIFT_CARD_REDEMPTION",
        method: "CARD",
        amount: -42.35,
        status: "SUCCEEDED",
        notes: `Gift card ${CARD.code}`,
        processedAt: expect.any(Date),
      },
    });
    expect(booking.updateMany).toHaveBeenCalledWith({
      where: { id: "bk_1", balanceDue: { gte: 42.35 } },
      data: {
        amountPaid: { increment: 42.35 },
        balanceDue: { decrement: 42.35 },
      },
    });
    expect(result).toEqual({ newBalance: 57.65 });
  });

  it("books the redemption under the non-cash GIFT_CARD_REDEMPTION type as a negative amount", async () => {
    const { caller, payment } = makeCtx();

    await caller.redeem({ ...REDEEM, amount: 100 });

    const data = payment.create.mock.calls[0]?.[0].data;
    expect(data.type).toBe("GIFT_CARD_REDEMPTION");
    expect(data.amount).toBe(-100);
  });

  it("keys the Payment row deterministically so a double-submit collides instead of double-debiting", async () => {
    const { caller, payment } = makeCtx();

    await caller.redeem(REDEEM);
    const first = payment.create.mock.calls[0]?.[0].data.reference;
    await caller.redeem(REDEEM);
    const second = payment.create.mock.calls[1]?.[0].data.reference;

    expect(first).toBe(second);
  });

  it("maps the unique-constraint collision to 'already applied to this booking'", async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed on the fields: (`reference`)",
      { code: "P2002", clientVersion: "5.22.0" },
    );
    const { caller, didRollBack } = makeCtx({ paymentError: p2002 });

    await expect(caller.redeem(REDEEM)).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "This gift card has already been applied to this booking",
    });
    // The debit was inside the failed transaction, so it never lands.
    expect(didRollBack()).toBe(true);
  });

  it("refuses to over-redeem past the booking's remaining balance (CAS loses)", async () => {
    const { caller, didRollBack } = makeCtx({ bookingCasCount: 0 });

    await expect(caller.redeem({ ...REDEEM, amount: 500 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Redemption exceeds the booking's remaining balance",
    });
    expect(didRollBack()).toBe(true);
  });

  it("propagates the service's NOT_FOUND for an unknown card code", async () => {
    const { TRPCError } = await import("@trpc/server");
    redeemGiftCardTxMock.mockRejectedValue(
      new TRPCError({ code: "NOT_FOUND", message: "Gift card not found" }),
    );
    const { caller, payment } = makeCtx();

    await expect(caller.redeem(REDEEM)).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Gift card not found",
    });
    expect(payment.create).not.toHaveBeenCalled();
  });

  it("surfaces a non-tRPC service failure as BAD_REQUEST with its message", async () => {
    redeemGiftCardTxMock.mockRejectedValue(new Error("card ledger unavailable"));
    const { caller } = makeCtx();

    await expect(caller.redeem(REDEEM)).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "card ledger unavailable",
    });
  });

  it("forbids redeeming against somebody else's booking", async () => {
    const { caller, $transaction } = makeCtx({
      booking: { id: "bk_1", customerId: "someone-else", balanceDue: 200 },
    });

    await expect(caller.redeem(REDEEM)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect($transaction).not.toHaveBeenCalled();
    expect(redeemGiftCardTxMock).not.toHaveBeenCalled();
  });

  it("rejects an anonymous caller (protectedProcedure)", async () => {
    const { caller, booking } = makeCtx({ anon: true });

    await expect(caller.redeem(REDEEM)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(booking.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it.each([
    ["zero", 0],
    ["negative", -25],
  ])("rejects a %s redemption amount before opening a transaction", async (_label, amount) => {
    const { caller, $transaction } = makeCtx();

    await expect(caller.redeem({ ...REDEEM, amount })).rejects.toThrow();
    expect($transaction).not.toHaveBeenCalled();
  });

  it("surfaces an unknown booking id as a 500 (findUniqueOrThrow is outside the guard)", async () => {
    // Documents current behaviour — see the note in the PR description.
    const { caller } = makeCtx({ bookingError: new Error("No Booking found") });

    await expect(caller.redeem(REDEEM)).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
  });
});

describe("giftCard.void", () => {
  it("marks the card VOIDED and records the reason as a ledger entry (admin)", async () => {
    const { caller, giftCard } = makeCtx({ role: "ADMIN" });

    const result = await caller.void({ id: "gc_1", reason: "Fraudulent purchase" });

    expect(giftCard.update).toHaveBeenCalledWith({
      where: { id: "gc_1" },
      data: {
        status: "VOIDED",
        transactions: {
          create: {
            direction: "DEBIT",
            amount: 0,
            balanceAfter: 0,
            notes: "Voided: Fraudulent purchase",
          },
        },
      },
    });
    expect(result).toMatchObject({ id: "gc_1", status: "VOIDED" });
  });

  it("allows SUPER_ADMIN", async () => {
    const { caller, giftCard } = makeCtx({ role: "SUPER_ADMIN" });

    await caller.void({ id: "gc_1", reason: "Duplicate issue" });

    expect(giftCard.update).toHaveBeenCalledTimes(1);
  });

  it.each(["CUSTOMER", "STAFF", "MANAGER"] as const)(
    "forbids %s from voiding a card",
    async (role) => {
      const { caller, giftCard } = makeCtx({ role });

      await expect(caller.void({ id: "gc_1", reason: "nope" })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(giftCard.update).not.toHaveBeenCalled();
    },
  );

  it("rejects an anonymous caller (adminProcedure inherits the auth gate)", async () => {
    const { caller, giftCard } = makeCtx({ anon: true });

    await expect(caller.void({ id: "gc_1", reason: "nope" })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(giftCard.update).not.toHaveBeenCalled();
  });

  it("rejects a void with no reason supplied", async () => {
    const { caller, giftCard } = makeCtx({ role: "ADMIN" });

    await expect(caller.void({ id: "gc_1" } as never)).rejects.toThrow();
    expect(giftCard.update).not.toHaveBeenCalled();
  });
});

describe("giftCard.listMine", () => {
  const PURCHASED = {
    id: "gc_1",
    code: "SCOOT-PURCHASEDAAAAAA",
    initialAmount: new Prisma.Decimal("250.00"),
    balance: new Prisma.Decimal("125.55"),
    status: "ACTIVE",
    expiresAt: new Date("2029-01-01T00:00:00.000Z"),
    purchasedById: "u1",
  };
  const RECEIVED = {
    id: "gc_2",
    code: "SCOOT-RECEIVEDBBBBBB",
    initialAmount: new Prisma.Decimal("100.00"),
    balance: new Prisma.Decimal("0.00"),
    status: "REDEEMED",
    expiresAt: new Date("2029-01-01T00:00:00.000Z"),
    purchasedById: "someone-else",
  };

  it("returns cards the caller bought or received, newest first, tagged by role", async () => {
    const { caller, giftCard } = makeCtx({ mine: [PURCHASED, RECEIVED] });

    const result = await caller.listMine();

    expect(giftCard.findMany).toHaveBeenCalledWith({
      where: {
        OR: [{ purchasedById: "u1" }, { recipientEmail: "rider@example.com" }],
      },
      orderBy: { createdAt: "desc" },
    });
    expect(result).toEqual([
      {
        id: "gc_1",
        code: PURCHASED.code,
        initialAmount: 250,
        balance: 125.55,
        status: "ACTIVE",
        expiresAt: PURCHASED.expiresAt,
        role: "PURCHASED",
      },
      {
        id: "gc_2",
        code: RECEIVED.code,
        initialAmount: 100,
        balance: 0,
        status: "REDEEMED",
        expiresAt: RECEIVED.expiresAt,
        role: "RECEIVED",
      },
    ]);
  });

  it("serialises Decimal balances to exact-cent numbers", async () => {
    const { caller } = makeCtx({
      mine: [{ ...PURCHASED, balance: new Prisma.Decimal("19.05") }],
    });

    const [card] = await caller.listMine();

    expect(card?.balance).toBe(19.05);
  });

  it("cannot be matched by email when the session user has none", async () => {
    const { caller, giftCard } = makeCtx({ email: null });

    await caller.listMine();

    expect(giftCard.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ purchasedById: "u1" }, { recipientEmail: "__no_email__" }] },
      }),
    );
  });

  it("rejects an anonymous caller (protectedProcedure)", async () => {
    const { caller, giftCard } = makeCtx({ anon: true });

    await expect(caller.listMine()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(giftCard.findMany).not.toHaveBeenCalled();
  });
});
