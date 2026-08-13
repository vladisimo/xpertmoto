/**
 * One-shot reconciliation: swap money history (categoryId + totals ledger).
 *
 * Cause: `bookingSwap.confirmSwap` used to commit a mid-hire vehicle swap
 * WITHOUT updating the booking's money/category state:
 *   - `booking.categoryId` kept the original category, so late fees,
 *     extensions and any second swap priced off the wrong category;
 *   - CHARGE deltas raised `balanceDue` but never `totalAmount`/`gstAmount`;
 *   - REFUND deltas moved cash at Stripe without decrementing
 *     `totalAmount`/`gstAmount`/`amountPaid`.
 * The go-forward fix writes all of these at commit; this script corrects the
 * history. `balanceDue` is intentionally NOT retro-adjusted — the outstanding
 * debt at each historical swap instant is unknowable, so any imbalance shows
 * up in the drift report for a human instead.
 *
 * Four passes (per booking with >= 1 COMMITTED swap):
 *   1. categoryId backfill — bookings whose categoryId != the last committed
 *      swap's incoming vehicle category. Skipped when the vehicle was later
 *      moved by another mechanism (fleet-reassign etc.) — manual review.
 *   2. SUCCEEDED SWAP-REF-% cash refunds — retro-apply the missing
 *      `amountPaid` decrement. Idempotent: a "[RECONCILED:swap-refund]"
 *      marker is appended to the payment notes and marked rows are skipped
 *      on re-run (same pattern as reconcile-incident-charges).
 *   3. totalAmount/gstAmount reconstruction — expected = pricing-snapshot
 *      original + Σ(committed CHARGE deltas) − Σ(effective REFUND deltas).
 *      Applied ONLY when the current totals equal the pre-swap baseline
 *      exactly (the booking provably missed the swap increments and nothing
 *      else — extension, change-booking — moved them); anything else is
 *      reported as drift for manual review. Passes 2+3 apply in one
 *      transaction so a re-run can never double-count.
 *   4. Double-charge / free-swap-back detection — REPORT ONLY. Replays the
 *      swap chain to find swaps whose delta was quoted against the stale
 *      original category instead of the one actually held, printing the
 *      recorded delta next to re-estimates from `quoteSwapDelta` (at TODAY'S
 *      rates — indicative only). Never auto-refunds or auto-charges.
 *
 * No customer is charged, refunded or emailed. Dry-run by default.
 *
 * Usage:
 *   npx tsx scripts/reconcile-swap-money.ts                 # dry-run report
 *   npx tsx scripts/reconcile-swap-money.ts --apply         # write changes
 *   npx tsx scripts/reconcile-swap-money.ts --booking-id X  # one booking (id or reference)
 */
import { Prisma, PrismaClient } from "@prisma/client";

import { aud, roundCents, sum, toNumber } from "@/lib/money";
import { quoteSwapDelta } from "@/server/services/pricing";
import {
  reconstructSwapNet,
  replaySwapChain,
  SWAP_REFUND_RECONCILED_MARKER,
  type SwapNetRow,
} from "@/server/services/swap-reconciliation";

const p = new PrismaClient();

/** Mirrors the router's NO_DELTA_REASONS — these swaps are zero-by-policy,
 *  so a stale-category quote can't have mis-billed them. */
const NO_DELTA_REASONS = ["MECHANICAL_FAULT", "ACCIDENT_DAMAGE", "OPERATIONAL"] as const;

type Args = {
  apply: boolean;
  bookingId?: string;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { apply: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") args.apply = true;
    else if (a === "--booking-id") {
      const v = argv[++i];
      if (!v) throw new Error("--booking-id requires a value");
      args.bookingId = v;
    } else {
      throw new Error(`unknown argument: ${a}`);
    }
  }
  return args;
}

const money = (n: number | Prisma.Decimal) => `A$${aud(n).toFixed(2)}`;
const signed = (direction: string, amount: number | Prisma.Decimal) =>
  direction === "REFUND" ? `-${money(amount)}` : `+${money(amount)}`;

function snapshotTotals(
  snapshot: Prisma.JsonValue,
): { total: Prisma.Decimal; gst: Prisma.Decimal } | null {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  const rec = snapshot as Record<string, unknown>;
  if (typeof rec.totalAmount !== "number" || !Number.isFinite(rec.totalAmount)) return null;
  if (typeof rec.gstAmount !== "number" || !Number.isFinite(rec.gstAmount)) return null;
  return { total: roundCents(rec.totalAmount), gst: roundCents(rec.gstAmount) };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(
    `\nSwap money reconciliation — ${
      args.apply ? "APPLY (writing changes)" : "DRY RUN (no writes)"
    }\n`,
  );

  const bookings = await p.booking.findMany({
    where: {
      swaps: { some: { status: "COMMITTED", deletedAt: null } },
      ...(args.bookingId
        ? { OR: [{ id: args.bookingId }, { bookingReference: args.bookingId }] }
        : {}),
    },
    select: {
      id: true,
      bookingReference: true,
      status: true,
      categoryId: true,
      vehicleId: true,
      totalAmount: true,
      gstAmount: true,
      amountPaid: true,
      balanceDue: true,
      pricingSnapshot: true,
      returnDateTime: true,
      swaps: {
        where: { status: "COMMITTED", deletedAt: null },
        orderBy: { swappedAt: "asc" },
        select: {
          id: true,
          swappedAt: true,
          reason: true,
          priceAdjustmentAmount: true,
          priceAdjustmentGst: true,
          priceAdjustmentDirection: true,
          outgoingVehicleId: true,
          incomingVehicleId: true,
          outgoingVehicle: {
            select: { categoryId: true, internalCode: true, category: { select: { name: true } } },
          },
          incomingVehicle: {
            select: { categoryId: true, internalCode: true, category: { select: { name: true } } },
          },
          payment: {
            select: { id: true, reference: true, status: true, amount: true, notes: true },
          },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  if (bookings.length === 0) {
    console.log("No bookings with committed swaps — nothing to reconcile.\n");
    return;
  }

  let catFixed = 0;
  let catOk = 0;
  let catManual = 0;
  let totalsOk = 0;
  let totalsApplied = 0;
  let totalsDrift = 0;
  let totalsSkipped = 0;
  let totalsManual = 0;
  let cashHealed = 0;
  let cashHealedAud = aud(0);
  let chainSuspects = 0;

  for (const booking of bookings) {
    const ref = booking.bookingReference;
    const swaps = booking.swaps;
    const lastSwap = swaps[swaps.length - 1]!;

    // ---- Pass 1: categoryId backfill from the last committed swap ----------
    if (!lastSwap.incomingVehicleId || !lastSwap.incomingVehicle) {
      catManual++;
      console.log(`CAT-MANUAL ${ref}  last swap ${lastSwap.id} has no incoming vehicle — review manually`);
    } else if (booking.vehicleId !== lastSwap.incomingVehicleId) {
      catManual++;
      console.log(
        `CAT-MANUAL ${ref}  vehicle moved after the last swap (booking has ${booking.vehicleId ?? "none"}, ` +
          `swap put ${lastSwap.incomingVehicle.internalCode}) — category left untouched, review manually`,
      );
    } else if (booking.categoryId === lastSwap.incomingVehicle.categoryId) {
      catOk++;
    } else {
      catFixed++;
      console.log(
        `CAT   ${ref}  categoryId → ${lastSwap.incomingVehicle.category.name} ` +
          `(follows last swapped-in vehicle ${lastSwap.incomingVehicle.internalCode})`,
      );
      if (args.apply) {
        await p.booking.update({
          where: { id: booking.id },
          data: { categoryId: lastSwap.incomingVehicle.categoryId },
        });
      }
    }

    // ---- Passes 2 + 3: cash-refund ledger backfill + totals reconstruction -
    const netRows: SwapNetRow[] = swaps.map((s) => ({
      swapId: s.id,
      direction: s.priceAdjustmentDirection,
      amount: s.priceAdjustmentAmount,
      gst: s.priceAdjustmentGst,
      payment: s.payment
        ? {
            reference: s.payment.reference,
            status: s.payment.status,
            amount: s.payment.amount,
            notes: s.payment.notes,
          }
        : null,
    }));
    const net = reconstructSwapNet(netRows);
    const snap = snapshotTotals(booking.pricingSnapshot);
    const current = roundCents(booking.totalAmount);
    const currentGst = roundCents(booking.gstAmount);

    if (!snap) {
      totalsSkipped++;
      console.log(
        `SKIP  ${ref}  no reconstructable pricing snapshot — totals not verifiable, review manually`,
      );
    } else if (net.indeterminate.length > 0) {
      totalsManual++;
      console.log(`MANUAL ${ref}  swap ledger not provable — review manually:`);
      for (const reason of net.indeterminate) console.log(`      ${reason}`);
    } else {
      const expected = roundCents(snap.total.plus(net.chargeTotal).minus(net.refundTotal));
      const expectedGst = roundCents(snap.gst.plus(net.chargeGst).minus(net.refundGst));
      // What the booking looks like when it missed every swap increment and
      // only this script's previous marker-stamped heals have run.
      const baseline = roundCents(snap.total.minus(net.appliedRefundTotal));
      const baselineGst = roundCents(snap.gst.minus(net.appliedRefundGst));
      const cashTotal = roundCents(
        sum(...net.unappliedCashRefunds.map((r) => r.cash)),
      );

      if (current.equals(expected) && currentGst.equals(expectedGst)) {
        if (net.unappliedCashRefunds.length > 0) {
          totalsManual++;
          console.log(
            `MANUAL ${ref}  totals already consistent but ${net.unappliedCashRefunds.length} unmarked ` +
              `cash refund(s) (${money(cashTotal)}) — cannot prove whether amountPaid was decremented ` +
              `at commit (post-fix) or the deltas cancel out; review manually`,
          );
        } else {
          totalsOk++;
        }
      } else if (current.equals(baseline) && currentGst.equals(baselineGst)) {
        if (expected.lessThan(0) || expectedGst.lessThan(0)) {
          totalsManual++;
          console.log(
            `MANUAL ${ref}  reconstruction goes negative (expected ${money(expected)}) — review manually`,
          );
        } else if (cashTotal.greaterThan(0) && aud(booking.amountPaid).lessThan(cashTotal)) {
          totalsManual++;
          console.log(
            `MANUAL ${ref}  amountPaid ${money(booking.amountPaid)} < cash refunds ${money(cashTotal)} ` +
              `— decrement would go negative, review manually`,
          );
        } else {
          totalsApplied++;
          console.log(
            `TOTALS ${ref}  totalAmount ${money(current)} → ${money(expected)}, ` +
              `gstAmount ${money(currentGst)} → ${money(expectedGst)} ` +
              `(charges +${money(net.chargeTotal)}, refunds -${money(net.refundTotal)})`,
          );
          for (const r of net.unappliedCashRefunds) {
            console.log(
              `CASH  ${ref}  ${r.reference}  amountPaid -${money(r.cash)} (Stripe refund already sent, ledger never decremented)`,
            );
          }
          if (args.apply) {
            // Totals set + amountPaid decrement + idempotency markers in one
            // tx so a re-run can never double-apply any slice.
            await p.$transaction([
              p.booking.update({
                where: { id: booking.id },
                data: {
                  totalAmount: expected,
                  gstAmount: expectedGst,
                  ...(cashTotal.greaterThan(0)
                    ? { amountPaid: { decrement: toNumber(cashTotal) } }
                    : {}),
                },
              }),
              ...net.unappliedCashRefunds.map((r) => {
                const pay = swaps.find((s) => s.id === r.swapId)!.payment!;
                return p.payment.update({
                  where: { id: pay.id },
                  data: {
                    notes: `${pay.notes ? `${pay.notes} ` : ""}${SWAP_REFUND_RECONCILED_MARKER}`,
                  },
                });
              }),
            ]);
          }
          cashHealed += net.unappliedCashRefunds.length;
          cashHealedAud = sum(cashHealedAud, cashTotal);
        }
      } else {
        totalsDrift++;
        console.log(
          `DRIFT ${ref}  totalAmount ${money(current)} (gst ${money(currentGst)}) matches neither the ` +
            `pre-swap snapshot ${money(snap.total)} nor the reconstruction ${money(expected)} — something ` +
            `else (extension / change-booking / manual edit) moved it; review manually. Swap deltas:`,
        );
        for (const s of swaps) {
          console.log(
            `      ${s.id}  ${s.reason}  ${signed(s.priceAdjustmentDirection, s.priceAdjustmentAmount)}` +
              `${s.payment ? `  (${s.payment.reference} ${s.payment.status})` : ""}`,
          );
        }
      }
    }

    // ---- Pass 4: stale-category quote detection — REPORT ONLY --------------
    const chain = replaySwapChain(
      swaps.map((s) => ({
        swapId: s.id,
        reason: s.reason,
        direction: s.priceAdjustmentDirection,
        outgoingCategoryId: s.outgoingVehicle.categoryId,
        incomingCategoryId: s.incomingVehicle?.categoryId ?? null,
      })),
    );
    const categoryNames = new Map<string, string>();
    for (const s of swaps) {
      categoryNames.set(s.outgoingVehicle.categoryId, s.outgoingVehicle.category.name);
      if (s.incomingVehicle) {
        categoryNames.set(s.incomingVehicle.categoryId, s.incomingVehicle.category.name);
      }
    }
    const catName = (id: string) => categoryNames.get(id) ?? id;

    for (const step of chain) {
      if (!step.staleQuoteSuspect) continue;
      const swap = swaps.find((s) => s.id === step.swapId)!;
      if ((NO_DELTA_REASONS as readonly string[]).includes(step.reason)) {
        console.log(
          `CHAIN ${ref}  swap ${step.swapId} (${step.reason}) followed a category change but is ` +
            `zero-by-policy — no money exposure`,
        );
        continue;
      }
      chainSuspects++;
      const recorded =
        step.direction === "NONE"
          ? aud(0)
          : step.direction === "REFUND"
            ? aud(swap.priceAdjustmentAmount).neg()
            : aud(swap.priceAdjustmentAmount);
      console.log(
        `CHAIN ${ref}  swap ${step.swapId} (${step.reason}) ${catName(step.correctOldCategoryId)} → ` +
          `${step.incomingCategoryId ? catName(step.incomingCategoryId) : "?"}: recorded delta ` +
          `${money(recorded)} — pre-fix quote used stale category ${catName(step.staleOldCategoryId)}`,
      );
      if (!step.incomingCategoryId) {
        console.log(`      re-estimate unavailable — swap has no incoming vehicle`);
        continue;
      }
      if (booking.returnDateTime.getTime() <= swap.swappedAt.getTime()) {
        console.log(`      re-estimate unavailable — booking return precedes the swap time`);
        continue;
      }
      try {
        const [correctEst, staleEst] = await Promise.all([
          quoteSwapDelta(p, {
            oldCategoryId: step.correctOldCategoryId,
            newCategoryId: step.incomingCategoryId,
            oldVehicleId: swap.outgoingVehicleId,
            newVehicleId: swap.incomingVehicleId ?? undefined,
            swapAt: swap.swappedAt,
            returnDateTime: booking.returnDateTime,
          }),
          // Mimic the pre-fix computation: stale category, no vehicle-level
          // pricing (the old code dropped vehicle ids entirely).
          quoteSwapDelta(p, {
            oldCategoryId: step.staleOldCategoryId,
            newCategoryId: step.incomingCategoryId,
            swapAt: swap.swappedAt,
            returnDateTime: booking.returnDateTime,
          }),
        ]);
        console.log(
          `      re-estimated at TODAY'S rates (indicative only): correct-category ` +
            `${money(correctEst.deltaAmount)} vs stale-category ${money(staleEst.deltaAmount)}`,
        );
        const rec = toNumber(recorded);
        if (Math.abs(rec - staleEst.deltaAmount) <= 0.05 && Math.abs(rec - correctEst.deltaAmount) > 0.05) {
          console.log(
            `      ⚠ recorded delta matches the STALE estimate — likely mis-quoted by ` +
              `~${money(Math.abs(correctEst.deltaAmount - rec))}; any correction is a manual ` +
              `refund/charge decision`,
          );
        } else if (Math.abs(rec) < 0.005 && correctEst.deltaAmount < -0.01) {
          console.log(
            `      ⚠ possible free swap-back — customer may be owed ~${money(Math.abs(correctEst.deltaAmount))}; ` +
              `any refund is a manual decision`,
          );
        } else if (Math.abs(rec) < 0.005 && correctEst.deltaAmount > 0.01) {
          console.log(
            `      ⚠ possible undercharge of ~${money(correctEst.deltaAmount)} — never retro-charge ` +
              `without manager + customer agreement`,
          );
        }
      } catch (err) {
        console.log(
          `      re-estimate unavailable — ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  console.log(
    `\nScanned ${bookings.length} booking(s) with committed swaps:\n` +
      `  categoryId: ${catFixed} backfilled, ${catOk} already correct, ${catManual} manual review.\n` +
      `  totals: ${totalsApplied} reconstructed, ${totalsOk} already consistent, ${totalsDrift} drift ` +
      `(manual), ${totalsManual} not provable (manual), ${totalsSkipped} no snapshot.\n` +
      `  cash refunds: ${cashHealed} amountPaid backfill(s) totalling ${money(cashHealedAud)}.\n` +
      `  stale-quote suspects (report-only, never auto-refunded): ${chainSuspects}.`,
  );
  console.log(
    args.apply
      ? `Applied. balanceDue was intentionally left untouched — use the drift report + ` +
        `diagnose-balance-due-drift for any residue.\n`
      : `Dry run — re-run with --apply to write these changes.\n`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await p.$disconnect();
  });
