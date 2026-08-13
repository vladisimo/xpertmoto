/**
 * One-shot reconciliation: incident damage-charge ledger + GST backfill.
 *
 * Cause: `fleet.chargeCustomerForIncident` used to write its DAMAGE_CHARGE
 * Payment rows without a `gstAmount` (BAS under-report — `gst-bas-export`
 * reads `Payment.gstAmount`) and raised the PENDING card-overflow row
 * without the matching `Booking.balanceDue` increment — so the capture
 * sweep's decrement ate into UNRELATED debt on the booking. The go-forward
 * fix writes both at charge time; this script corrects the history.
 *
 * Three passes:
 *   1. GST backfill — INC-% DAMAGE_CHARGE rows with zero gstAmount (the
 *      column defaults to 0 when unset) and status != FAILED get
 *      `gstAmount = gstFromInclusive(amount)`. Reported
 *      per Australian financial year so the BAS impact per period is visible.
 *   2. PENDING INC-%-CARD rows — re-apply the missing balanceDue increment.
 *      Idempotent: a "[RECONCILED:balance-due]" marker is appended to the
 *      payment notes and marked rows are skipped on re-run.
 *   3. SUCCEEDED INC-%-CARD rows — REPORT ONLY, never auto-applied. Their
 *      capture already decremented balanceDue (clamped at 0), so the missed
 *      raise-increment is not blindly reversible; the report prints the
 *      booking's current ledger + other PENDING raises so a human decides.
 *
 * No customer is charged or emailed. Dry-run by default.
 *
 * Usage:
 *   npx tsx scripts/reconcile-incident-charges.ts                 # dry-run report
 *   npx tsx scripts/reconcile-incident-charges.ts --apply         # write changes
 *   npx tsx scripts/reconcile-incident-charges.ts --booking-id X  # one booking (id or reference)
 */
import { PrismaClient } from "@prisma/client";

import { gstFromInclusive } from "@/lib/money";
import { BALANCE_AFFECTING_CHARGE_TYPES } from "@/server/services/balance-due";

const p = new PrismaClient();

const RECONCILED_MARKER = "[RECONCILED:balance-due]";

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

const money = (n: number) => `A$${n.toFixed(2)}`;
const fy = (d: Date) => {
  // Australian financial year (1 Jul – 30 Jun).
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth(); // 0 = Jan
  return m >= 6 ? `FY${y + 1}` : `FY${y}`;
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(
    `\nIncident damage-charge reconciliation — ${
      args.apply ? "APPLY (writing changes)" : "DRY RUN (no writes)"
    }\n`,
  );

  const bookingFilter = args.bookingId
    ? {
        booking: {
          is: {
            OR: [{ id: args.bookingId }, { bookingReference: args.bookingId }],
          },
        },
      }
    : {};

  // ---- Pass 1: gstAmount backfill on INC-% DAMAGE_CHARGE rows -------------
  const gstRows = await p.payment.findMany({
    where: {
      type: "DAMAGE_CHARGE",
      reference: { startsWith: "INC-" },
      status: { not: "FAILED" },
      gstAmount: 0,
      ...bookingFilter,
    },
    include: { booking: { select: { bookingReference: true } } },
    orderBy: { createdAt: "asc" },
  });

  const fyTotals = new Map<string, { count: number; gst: number; gstSucceeded: number }>();
  for (const row of gstRows) {
    const amount = Number(row.amount);
    const gst = gstFromInclusive(amount).toNumber();
    const period = fy(row.processedAt ?? row.createdAt);
    const bucket = fyTotals.get(period) ?? { count: 0, gst: 0, gstSucceeded: 0 };
    bucket.count++;
    bucket.gst += gst;
    if (row.status === "SUCCEEDED") bucket.gstSucceeded += gst;
    fyTotals.set(period, bucket);

    console.log(
      `GST   ${row.booking?.bookingReference ?? row.bookingId ?? "-"}  ${row.reference}  ` +
        `${row.status}  amount ${money(amount)} → gstAmount ${money(gst)}`,
    );
    if (args.apply) {
      await p.payment.update({
        where: { id: row.id },
        data: { gstAmount: gstFromInclusive(amount) },
      });
    }
  }
  for (const [period, t] of [...fyTotals.entries()].sort()) {
    console.log(
      `      ${period}: ${t.count} row(s), GST backfilled ${money(t.gst)} ` +
        `(${money(t.gstSucceeded)} on SUCCEEDED rows — BAS-relevant)`,
    );
  }

  // ---- Pass 2: missing balanceDue raise on PENDING INC-%-CARD rows --------
  const pendingCard = await p.payment.findMany({
    where: {
      type: "DAMAGE_CHARGE",
      reference: { startsWith: "INC-", endsWith: "-CARD" },
      status: "PENDING",
      ...bookingFilter,
    },
    include: {
      booking: { select: { id: true, bookingReference: true, balanceDue: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  let raisesApplied = 0;
  let raisesSkipped = 0;
  for (const row of pendingCard) {
    const ref = row.booking?.bookingReference ?? row.bookingId ?? "-";
    const amount = Number(row.amount);
    if (row.notes?.includes(RECONCILED_MARKER)) {
      raisesSkipped++;
      console.log(`SKIP  ${ref}  ${row.reference}  ${money(amount)} — already reconciled`);
      continue;
    }
    if (!row.bookingId || !row.booking) {
      raisesSkipped++;
      console.log(`SKIP  ${ref}  ${row.reference}  ${money(amount)} — no booking linked`);
      continue;
    }
    console.log(
      `RAISE ${ref}  ${row.reference}  balanceDue ${money(Number(row.booking.balanceDue))} ` +
        `+ ${money(amount)}`,
    );
    if (!args.apply) continue;
    // Increment + marker in one tx so a re-run can't double-apply.
    await p.$transaction([
      p.booking.update({
        where: { id: row.bookingId },
        data: { balanceDue: { increment: amount } },
      }),
      p.payment.update({
        where: { id: row.id },
        data: { notes: `${row.notes ? `${row.notes} ` : ""}${RECONCILED_MARKER}` },
      }),
    ]);
    raisesApplied++;
  }

  // ---- Pass 3: SUCCEEDED INC-%-CARD rows — report only --------------------
  const succeededCard = await p.payment.findMany({
    where: {
      type: "DAMAGE_CHARGE",
      reference: { startsWith: "INC-", endsWith: "-CARD" },
      status: "SUCCEEDED",
      ...bookingFilter,
    },
    include: {
      booking: { select: { id: true, bookingReference: true, balanceDue: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  for (const row of succeededCard) {
    const ref = row.booking?.bookingReference ?? row.bookingId ?? "-";
    console.log(
      `CHECK ${ref}  ${row.reference}  collected ${money(Number(row.amount))}  ` +
        `booking balanceDue ${money(Number(row.booking?.balanceDue ?? 0))} — ` +
        `capture decremented balanceDue without a matching raise; review manually`,
    );
    if (!row.bookingId) continue;
    const pendingRaises = await p.payment.findMany({
      where: {
        bookingId: row.bookingId,
        status: "PENDING",
        type: { in: [...BALANCE_AFFECTING_CHARGE_TYPES] },
      },
      select: { reference: true, type: true, amount: true },
      orderBy: { createdAt: "asc" },
    });
    for (const raise of pendingRaises) {
      console.log(
        `      pending raise: ${raise.reference}  ${raise.type}  ${money(Number(raise.amount))}`,
      );
    }
  }

  console.log(
    `\nScanned: ${gstRows.length} GST backfill row(s), ` +
      `${pendingCard.length} PENDING card row(s) (${raisesSkipped} skipped), ` +
      `${succeededCard.length} SUCCEEDED card row(s) flagged for manual review.`,
  );
  if (args.apply) {
    console.log(
      `Applied: ${gstRows.length} gstAmount backfill(s), ${raisesApplied} balanceDue raise(s).\n`,
    );
  } else {
    console.log(`Dry run — re-run with --apply to write these changes.\n`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await p.$disconnect();
  });
