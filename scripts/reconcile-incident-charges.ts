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
 *      REQUIRES `--before <ISO timestamp>`: pass the deploy timestamp of the
 *      balance-due fix (the incident-charge.ts change that raises the
 *      increment at charge time). Rows created at/after that instant already
 *      got their increment at raise — re-applying would DOUBLE-increment —
 *      so only rows created strictly before the cutoff are eligible, and the
 *      pass refuses to run (with an explanation) when candidates exist and
 *      --before was not given. Idempotent within the eligible set: a
 *      "[RECONCILED:balance-due]" marker is appended to the payment notes
 *      and marked rows are skipped on re-run.
 *   3. SUCCEEDED INC-%-CARD rows — REPORT ONLY, never auto-applied. Their
 *      capture already decremented balanceDue (clamped at 0), so the missed
 *      raise-increment is not blindly reversible; the report prints the
 *      booking's current ledger + other PENDING raises so a human decides.
 *
 * No customer is charged or emailed. Dry-run by default.
 *
 * Usage:
 *   npx tsx scripts/reconcile-incident-charges.ts                 # dry-run report (pass 2 needs --before)
 *   npx tsx scripts/reconcile-incident-charges.ts --before 2026-08-20T00:00:00Z --apply
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
  /** Pass-2 eligibility cutoff: only PENDING INC-%-CARD rows created strictly
   *  before this instant may receive the balanceDue raise. Set it to the
   *  deploy timestamp of the balance-due fix in incident-charge.ts. */
  before?: Date;
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
    } else if (a === "--before") {
      const v = argv[++i];
      if (!v) throw new Error("--before requires an ISO-8601 timestamp");
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) {
        throw new Error(`--before is not a parseable date: ${v}`);
      }
      args.before = d;
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
  // Post-fix, incident-charge.ts raises the balanceDue increment itself at
  // charge time — a still-PENDING row created AFTER the fix deployed already
  // carries its raise, and re-adding it here would double-increment. The
  // `--before` cutoff (deploy timestamp of that fix) bounds this pass to
  // pre-fix history; without it the pass REFUSES to touch candidate rows.
  const pendingCard = await p.payment.findMany({
    where: {
      type: "DAMAGE_CHARGE",
      reference: { startsWith: "INC-", endsWith: "-CARD" },
      status: "PENDING",
      ...(args.before ? { createdAt: { lt: args.before } } : {}),
      ...bookingFilter,
    },
    include: {
      booking: { select: { id: true, bookingReference: true, balanceDue: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  let raisesApplied = 0;
  let raisesSkipped = 0;
  let pass2Refused = false;
  if (!args.before && pendingCard.length > 0) {
    pass2Refused = true;
    console.log(
      `REFUSED pass 2 — ${pendingCard.length} PENDING INC-%-CARD row(s) found but no --before cutoff was given.\n` +
        `      Rows created after the balance-due fix in incident-charge.ts deployed already received their\n` +
        `      raise at charge time; re-applying it here would double-increment Booking.balanceDue.\n` +
        `      Re-run with \`--before <ISO timestamp of that deploy>\` — only rows created strictly before\n` +
        `      that instant are eligible. Passes 1 and 3 are unaffected.`,
    );
  } else {
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
      `${pendingCard.length} PENDING card row(s) ` +
      `(${pass2Refused ? "pass 2 REFUSED — missing --before" : `${raisesSkipped} skipped`}), ` +
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
