import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { listBalanceTransactions, type StripeBalanceTransaction } from "@/lib/stripe";
import { getSecret, setSecret } from "@/lib/integration-config";
import { getQueue, monitorCron, registerWorker } from "./queue";

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

export async function runStripeReconcile(
  opts: {
    lookbackDays?: number;
    /** Reconcile an explicit window instead of the checkpoint→now range. */
    windowStart?: Date;
    windowEnd?: Date;
    /**
     * Whether to advance the saved checkpoint. Defaults to true for the normal
     * nightly run, false for an explicit-window run (so an on-demand UI refresh
     * doesn't disturb the nightly cadence).
     */
    advanceCheckpoint?: boolean;
  } = {},
): Promise<ReconcileResult> {
  const lookbackDays = opts.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  const explicitWindow = opts.windowStart != null && opts.windowEnd != null;
  const advanceCheckpoint = opts.advanceCheckpoint ?? !explicitWindow;

  let createdGte: number;
  let createdLte: number;
  if (explicitWindow) {
    createdGte = Math.floor(opts.windowStart!.getTime() / 1000);
    createdLte = Math.floor(opts.windowEnd!.getTime() / 1000);
  } else {
    const checkpointRaw = await getSecret(CHECKPOINT_KEY, "RECONCILE_LAST_CHECKPOINT");
    const defaultStart = Math.floor(Date.now() / 1000) - lookbackDays * 24 * 60 * 60;
    createdGte = checkpointRaw ? parseInt(checkpointRaw, 10) || defaultStart : defaultStart;
    createdLte = Math.floor(Date.now() / 1000) - 600; // 10-minute lag
  }

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

  // Step 5 — save checkpoint if we made progress (skipped for explicit-window runs)
  if (advanceCheckpoint && result.balanceTxnsProcessed > 0 && maxCreated > createdGte) {
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
        stripePaymentIntentId: txn.paymentIntent ?? null,
        feeType: txn.type === "charge" ? "stripe_fee" : "refund_fee",
        feeAmountCents: Math.abs(txn.fee),
        netAmountCents: txn.net,
        currency: txn.currency,
        balanceTxnCreatedAt: new Date(txn.created * 1000),
      },
      update: {
        netAmountCents: txn.net,
        // Backfill the PI if a later txn (e.g. refund) carries it and the
        // original charge row didn't.
        ...(txn.paymentIntent ? { stripePaymentIntentId: txn.paymentIntent } : {}),
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
      } else {
        // A previously-flagged system-ledger discrepancy that now reconciles
        // (fee-ledger row arrived late) closes itself — SYSTEM_LEDGER rows
        // used to have no auto-resolution path and accumulated forever.
        await resolveUnmatched("SYSTEM_LEDGER", p.stripeChargeId!);
      }
    }
  }

  // Stripe → system-ledger: charge rows in the fee ledger (i.e. seen in Stripe
  // balance_transactions) within the window with no matching Payment row. A
  // Payment matches by charge id OR by payment-intent — the latter covers
  // Payments whose charge id wasn't backfilled by the webhook; when matched
  // only by PI we backfill the charge id so future runs match directly.
  const chargeLedgerInWindow = await prisma.stripeFeeLedger.findMany({
    where: { balanceTxnCreatedAt: { gte: start, lte: end }, feeType: "stripe_fee" },
    select: {
      stripeChargeId: true,
      stripePaymentIntentId: true,
      netAmountCents: true,
      feeAmountCents: true,
      balanceTxnCreatedAt: true,
    },
  });
  if (chargeLedgerInWindow.length > 0) {
    const chargeIds = chargeLedgerInWindow.map((l) => l.stripeChargeId);
    const pis = chargeLedgerInWindow
      .map((l) => l.stripePaymentIntentId)
      .filter((p): p is string => !!p);
    const candidatePayments = await prisma.payment.findMany({
      where: {
        OR: [
          { stripeChargeId: { in: chargeIds } },
          ...(pis.length ? [{ stripePaymentIntentId: { in: pis } }] : []),
        ],
      },
      select: { id: true, stripeChargeId: true, stripePaymentIntentId: true },
    });
    const byChargeId = new Set(
      candidatePayments.map((p) => p.stripeChargeId).filter((c): c is string => !!c),
    );
    const paymentByPi = new Map(
      candidatePayments
        .filter((p) => p.stripePaymentIntentId)
        .map((p) => [p.stripePaymentIntentId!, p]),
    );
    for (const l of chargeLedgerInWindow) {
      if (byChargeId.has(l.stripeChargeId)) {
        await resolveUnmatched("STRIPE_CHARGE", l.stripeChargeId);
        continue;
      }
      const piMatch = l.stripePaymentIntentId
        ? paymentByPi.get(l.stripePaymentIntentId)
        : undefined;
      if (piMatch) {
        // Backfill the charge id the webhook never set, then clear any stale
        // discrepancy — the rows now reconcile on charge id.
        if (!piMatch.stripeChargeId) {
          await prisma.payment.update({
            where: { id: piMatch.id },
            data: { stripeChargeId: l.stripeChargeId },
          });
        }
        await resolveUnmatched("STRIPE_CHARGE", l.stripeChargeId);
        continue;
      }
      await upsertUnmatched({
        source: "STRIPE_CHARGE",
        externalId: l.stripeChargeId,
        // Gross = net + fee for a charge row.
        amountCents: l.netAmountCents + l.feeAmountCents,
        occurredAt: l.balanceTxnCreatedAt,
        reason: "Stripe charge seen in balance_transactions but no matching Payment row",
        payload: { stripeChargeId: l.stripeChargeId },
      });
      result.unmatchedStripeCharges += 1;
    }
  }
}

/** Mark a previously-recorded discrepancy resolved once it reconciles. */
async function resolveUnmatched(
  source: "SYSTEM_LEDGER" | "STRIPE_CHARGE" | "STRIPE_PAYOUT" | "BANK_STATEMENT",
  externalId: string,
): Promise<void> {
  await prisma.unmatchedTransaction.updateMany({
    where: { source, externalId, resolvedAt: null },
    data: { resolvedAt: new Date(), resolvedNote: "Auto-resolved: charge now reconciles" },
  });
}

async function upsertUnmatched(args: {
  source: "SYSTEM_LEDGER" | "STRIPE_CHARGE" | "STRIPE_PAYOUT" | "BANK_STATEMENT";
  externalId: string;
  amountCents: number;
  occurredAt: Date;
  reason: string;
  payload: Prisma.InputJsonValue;
}): Promise<void> {
  const existing = await prisma.unmatchedTransaction.findUnique({
    where: {
      source_externalId: { source: args.source, externalId: args.externalId },
    },
    select: { id: true },
  });
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
  // A discrepancy that nobody hears about is a silent leakage queue: fire
  // the (previously never-called) metric and page the managers ONCE per
  // discrepancy, on first open only — the nightly re-run re-upserting the
  // same row must not re-page.
  if (!existing) {
    try {
      const { unmatchedTransactionOpened } = await import(
        "@/server/services/metrics"
      );
      unmatchedTransactionOpened(args.source);
    } catch {
      // metrics are best-effort
    }
    try {
      const { sendNotification } = await import(
        "@/server/services/notification-sender"
      );
      const managers = await prisma.user.findMany({
        where: { role: { in: ["MANAGER", "ADMIN", "SUPER_ADMIN"] }, status: "ACTIVE" },
        select: { id: true },
        take: 5,
      });
      const amountAud = (args.amountCents / 100).toFixed(2);
      for (const m of managers) {
        await sendNotification({
          userId: m.id,
          type: "INCIDENT_REPORTED",
          channels: ["IN_APP", "EMAIL"],
          subject: `Reconciliation discrepancy — ${args.source} A$${amountAud}`,
          title: "Money doesn't reconcile",
          body:
            `${args.reason} (source ${args.source}, A$${amountAud}, ref ${args.externalId}). ` +
            `Review in Admin → Finance → Reconciliation and resolve it with a note once explained.`,
          data: { source: args.source, externalId: args.externalId, amountCents: args.amountCents },
          dedupKey: `unmatched-txn:${args.source}:${args.externalId}`,
        });
      }
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), source: args.source },
        "stripe-reconcile: unmatched-transaction alert failed",
      );
    }
  }
}

export function startStripeReconcileScheduler() {
  registerWorker(QUEUE, async () => runStripeReconcile());
  monitorCron(QUEUE, "30 2 * * *");
  const q = getQueue(QUEUE);
  if (!q) return;
  // Nightly at 02:30 Brisbane, after bond-auto-release + revenue-reconcile.
  q.add(
    "nightly",
    {},
    { repeat: { pattern: "30 2 * * *", tz: "Australia/Brisbane" }, jobId: "repeat-nightly" },
  );
}
