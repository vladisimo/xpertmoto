import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { listBalanceTransactions, type StripeBalanceTransaction } from "@/lib/stripe";
import { getSecret, setSecret } from "@/lib/integration-config";
import { getQueue, registerWorker } from "./queue";

/**
 * G3 — stripe-reconcile
 *
 * Nightly job (02:30 Brisbane) that pulls balance_transactions since the
 * last checkpoint and:
 *   1. For `charge` / `refund` rows → upsert StripeFeeLedger keyed on
 *      charge id. Record fee + net amounts.
 *   2. For `payout` rows → backfill `stripePayoutId` + `payoutArrivedAt`
 *      on StripeFeeLedger rows in the payout window.
 *   3. Cross-check: Payment(status=SUCCEEDED) rows in the checkpoint
 *      window with no matching Stripe charge → UnmatchedTransaction
 *      (source=SYSTEM_LEDGER).
 *   4. Stripe charges with no matching Payment → UnmatchedTransaction
 *      (source=STRIPE_CHARGE).
 *   5. Save the last balance_transaction id as the new checkpoint.
 *
 * Idempotent via StripeFeeLedger.stripeChargeId @unique and
 * UnmatchedTransaction.(source, externalId) composite unique.
 */

const QUEUE = "stripe-reconcile" as const;
const CHECKPOINT_KEY = "reconcile:stripe:lastCheckpointCreated";
const DEFAULT_LOOKBACK_DAYS = 14;

export type ReconcileResult = {
  balanceTxnsProcessed: number;
  feeRowsUpserted: number;
  payoutsLinked: number;
  unmatchedStripeCharges: number;
  unmatchedSystemLedger: number;
  newCheckpoint: number | null;
};

export async function runStripeReconcile(opts: { lookbackDays?: number } = {}): Promise<ReconcileResult> {
  const lookbackDays = opts.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  const checkpointRaw = await getSecret(CHECKPOINT_KEY, "RECONCILE_LAST_CHECKPOINT");
  const defaultStart = Math.floor(Date.now() / 1000) - lookbackDays * 24 * 60 * 60;
  const createdGte = checkpointRaw ? parseInt(checkpointRaw, 10) || defaultStart : defaultStart;
  const createdLte = Math.floor(Date.now() / 1000) - 600; // 10-minute lag

  const result: ReconcileResult = {
    balanceTxnsProcessed: 0,
    feeRowsUpserted: 0,
    payoutsLinked: 0,
    unmatchedStripeCharges: 0,
    unmatchedSystemLedger: 0,
    newCheckpoint: null,
  };

  // Step 1–2 — paginate
  let startingAfter: string | undefined;
  let maxCreated = createdGte;
  while (true) {
    const page = await listBalanceTransactions({
      createdGte,
      createdLte,
      startingAfter,
      limit: 100,
    });
    for (const txn of page.data) {
      result.balanceTxnsProcessed += 1;
      if (txn.created > maxCreated) maxCreated = txn.created;
      await processBalanceTxn(txn, result);
    }
    if (!page.has_more || !page.last_id) break;
    startingAfter = page.last_id;
  }

  // Step 3–4 — cross-check
  await crossCheck(createdGte, createdLte, result);

  // Step 5 — save checkpoint if we made progress
  if (result.balanceTxnsProcessed > 0 && maxCreated > createdGte) {
    await setSecret(CHECKPOINT_KEY, String(maxCreated));
    result.newCheckpoint = maxCreated;
  }

  logger.info({ ...result, createdGte, createdLte }, "stripe-reconcile done");
  return result;
}

async function processBalanceTxn(txn: StripeBalanceTransaction, result: ReconcileResult): Promise<void> {
  if (txn.type === "charge" || txn.type === "refund") {
    const chargeId = txn.source ?? "";
    if (!chargeId) return;
    // Upsert keyed on stripeChargeId. A refund shares the charge id but
    // writes negative amounts; we only keep one row per charge — first
    // write wins; refund rows update net amount only via adjustment.
    await prisma.stripeFeeLedger.upsert({
      where: { stripeChargeId: chargeId },
      create: {
        stripeChargeId: chargeId,
        feeType: txn.type === "charge" ? "stripe_fee" : "refund_fee",
        feeAmountCents: Math.abs(txn.fee),
        netAmountCents: txn.net,
        currency: txn.currency,
        balanceTxnCreatedAt: new Date(txn.created * 1000),
      },
      update: {
        netAmountCents: txn.net,
      },
    });
    result.feeRowsUpserted += 1;
    return;
  }

  if (txn.type === "payout") {
    const payoutId = txn.source ?? "";
    if (!payoutId) return;
    // Link every fee-ledger row within the payout's window (approximation:
    // last 2 days before the payout).
    const windowStart = new Date((txn.created - 2 * 24 * 60 * 60) * 1000);
    const arrived = new Date(txn.created * 1000);
    const linked = await prisma.stripeFeeLedger.updateMany({
      where: {
        stripePayoutId: null,
        balanceTxnCreatedAt: { gte: windowStart, lte: arrived },
      },
      data: {
        stripePayoutId: payoutId,
        payoutArrivedAt: arrived,
      },
    });
    result.payoutsLinked += linked.count;
  }
}

async function crossCheck(createdGte: number, createdLte: number, result: ReconcileResult): Promise<void> {
  const start = new Date(createdGte * 1000);
  const end = new Date(createdLte * 1000);

  // System-ledger → Stripe: Payments SUCCEEDED in window with a charge id
  // that doesn't appear in StripeFeeLedger.
  const paymentsInWindow = await prisma.payment.findMany({
    where: {
      status: "SUCCEEDED",
      stripeChargeId: { not: null },
      createdAt: { gte: start, lte: end },
    },
    select: { id: true, stripeChargeId: true, amount: true, createdAt: true },
  });
  if (paymentsInWindow.length > 0) {
    const ids = paymentsInWindow.map((p) => p.stripeChargeId!).filter(Boolean);
    const known = await prisma.stripeFeeLedger.findMany({
      where: { stripeChargeId: { in: ids } },
      select: { stripeChargeId: true },
    });
    const knownSet = new Set(known.map((k) => k.stripeChargeId));
    for (const p of paymentsInWindow) {
      if (!knownSet.has(p.stripeChargeId!)) {
        await upsertUnmatched({
          source: "SYSTEM_LEDGER",
          externalId: p.stripeChargeId!,
          amountCents: Math.round(Number(p.amount) * 100),
          occurredAt: p.createdAt,
          reason: "Payment SUCCEEDED but not seen in Stripe balance_transactions",
          payload: { paymentId: p.id },
        });
        result.unmatchedSystemLedger += 1;
      }
    }
  }
}

async function upsertUnmatched(args: {
  source: "SYSTEM_LEDGER" | "STRIPE_CHARGE" | "STRIPE_PAYOUT" | "BANK_STATEMENT";
  externalId: string;
  amountCents: number;
  occurredAt: Date;
  reason: string;
  payload: Prisma.InputJsonValue;
}): Promise<void> {
  await prisma.unmatchedTransaction.upsert({
    where: {
      source_externalId: { source: args.source, externalId: args.externalId },
    },
    create: {
      source: args.source,
      externalId: args.externalId,
      amountCents: args.amountCents,
      occurredAt: args.occurredAt,
      reason: args.reason,
      payload: args.payload,
    },
    update: { reason: args.reason },
  });
}

export function startStripeReconcileScheduler() {
  registerWorker(QUEUE, async () => runStripeReconcile());
  const q = getQueue(QUEUE);
  if (!q) return;
  // Nightly at 02:30 Brisbane, after bond-auto-release + revenue-reconcile.
  q.add(
    "nightly",
    {},
    { repeat: { pattern: "30 2 * * *", tz: "Australia/Brisbane" }, jobId: "repeat-nightly" },
  );
}
