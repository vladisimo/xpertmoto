/**
 * One-shot reconciliation: heal "phantom" bond captures.
 *
 * Cause: every bond-capture path used to update the BondLedger and write a
 * SUCCEEDED BOND_CAPTURE / DAMAGE_CHARGE Payment row (and, for some paths, an
 * INCREASE adjustment note) WITHOUT ever calling Stripe to capture the held
 * `capture_method: "manual"` PaymentIntent. So the authorisation was never
 * captured — it expired after ~7 days and the money returned to the customer
 * — yet our books recorded collected revenue and issued a tax document. The
 * go-forward fix wires real captures via `capturePaymentIntent`; this script
 * corrects the history.
 *
 * For each bond whose Stripe PaymentIntent shows it was never actually
 * captured (`amount_received == 0`, status `requires_capture` / `canceled`):
 *   1. Void the SUCCEEDED, charge-less bond Payment rows (→ FAILED) — a
 *      genuinely-collected payment carries a `stripeChargeId`; a phantom one
 *      does not.
 *   2. For any INCREASE adjustment note the phantom capture produced, issue a
 *      reversing DECREASE note of equal magnitude (GST-correct unwind under
 *      ATO §29-75 — the two notes net the period's GST to zero). No customer
 *      email (these are long-dropped holds).
 *   3. Reset the BondLedger to RELEASED (captured 0, released = held).
 *
 * No customer is charged or emailed. Idempotent: re-running is a no-op once a
 * bond is RELEASED / a reversing note exists. Dry-run by default.
 *
 * Usage:
 *   npx tsx scripts/reconcile-phantom-bond-captures.ts                 # dry-run report
 *   npx tsx scripts/reconcile-phantom-bond-captures.ts --apply         # write changes
 *   npx tsx scripts/reconcile-phantom-bond-captures.ts --booking-id X  # one booking (id or reference)
 *   npx tsx scripts/reconcile-phantom-bond-captures.ts --include-stub  # also reverse stub PIs (dev only)
 */
import { PrismaClient, type Prisma } from "@prisma/client";

import { retrievePaymentIntent } from "@/lib/stripe";
import { issueAdjustmentNote } from "@/server/services/invoice-lifecycle";

const p = new PrismaClient();

type Args = {
  apply: boolean;
  bookingId?: string;
  includeStub: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { apply: false, includeStub: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") args.apply = true;
    else if (a === "--include-stub") args.includeStub = true;
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

function isStubPi(pi: string): boolean {
  return pi.startsWith("pi_stub_") || pi.startsWith("pi_bond_stub_");
}

type Classification =
  | { kind: "phantom"; reason: string }
  | { kind: "real"; capturedCents: number }
  | { kind: "skip"; reason: string };

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
    `\nPhantom bond-capture reconciliation — ${
      args.apply ? "APPLY (writing changes)" : "DRY RUN (no writes)"
    }${args.includeStub ? " — including stub PIs" : ""}\n`,
  );

  const ledgers = await p.bondLedger.findMany({
    where: {
      capturedAmount: { gt: 0 },
      status: { not: "RELEASED" },
      stripePaymentIntentId: { not: null },
      ...(args.bookingId
        ? {
            booking: {
              is: {
                OR: [{ id: args.bookingId }, { bookingReference: args.bookingId }],
              },
            },
          }
        : {}),
    },
    include: {
      booking: { select: { id: true, bookingReference: true } },
    },
    orderBy: { updatedAt: "asc" },
  });

  let phantomCount = 0;
  let realCount = 0;
  let skipCount = 0;
  let voidedPayments = 0;
  let reversedNotes = 0;
  let totalPhantomAud = 0;

  for (const ledger of ledgers) {
    const ref = ledger.booking?.bookingReference ?? ledger.bookingId;
    const pi = ledger.stripePaymentIntentId!;
    const held = Number(ledger.heldAmount);
    const captured = Number(ledger.capturedAmount);

    // ---- Classify against Stripe truth -----------------------------------
    let classification: Classification;
    if (isStubPi(pi)) {
      classification = args.includeStub
        ? { kind: "phantom", reason: "stub PI (--include-stub)" }
        : { kind: "skip", reason: "stub PI — skipped (pass --include-stub in dev)" };
    } else {
      const intent = await retrievePaymentIntent(pi);
      if (!intent) {
        classification = {
          kind: "skip",
          reason: "could not verify (Stripe unconfigured) — configure Stripe and re-run",
        };
      } else if (intent.amountReceivedCents > 0) {
        classification = { kind: "real", capturedCents: intent.amountReceivedCents };
      } else {
        classification = {
          kind: "phantom",
          reason: `Stripe status ${intent.status}, amount_received 0`,
        };
      }
    }

    if (classification.kind === "skip") {
      skipCount++;
      console.log(`SKIP  ${ref}  captured ${money(captured)}  — ${classification.reason}`);
      continue;
    }

    if (classification.kind === "real") {
      realCount++;
      const realAud = classification.capturedCents / 100;
      const mismatch = Math.abs(realAud - captured) > 0.01;
      console.log(
        `REAL  ${ref}  ledger ${money(captured)} vs Stripe ${money(realAud)}${
          mismatch ? "  ⚠ mismatch — reconciling ledger to Stripe" : ""
        }`,
      );
      if (mismatch && args.apply) {
        await p.bondLedger.update({
          where: { id: ledger.id },
          data: {
            capturedAmount: realAud,
            releasedAmount: Math.max(0, held - realAud),
            status: "FULLY_CAPTURED",
          },
        });
      }
      continue;
    }

    // ---- Phantom: reverse the books --------------------------------------
    phantomCount++;
    totalPhantomAud += captured;

    // A genuinely-collected payment carries a Stripe charge id; a phantom one
    // doesn't. Target only the bond-funded capture rows for this booking.
    const phantomPayments = await p.payment.findMany({
      where: {
        bookingId: ledger.bookingId,
        status: "SUCCEEDED",
        method: "STRIPE",
        stripeChargeId: null,
        OR: [
          { type: "BOND_CAPTURE" },
          {
            type: "DAMAGE_CHARGE",
            reference: { startsWith: "INC-" },
            NOT: { reference: { endsWith: "-CARD" } },
          },
        ],
      },
      include: {
        adjustmentNote: {
          select: {
            id: true,
            type: true,
            adjustmentNumber: true,
            invoiceId: true,
            issuedAt: true,
            totalAmount: true,
          },
        },
      },
    });

    const noteSummary = phantomPayments
      .map((pay) =>
        pay.adjustmentNote?.type === "INCREASE"
          ? `${pay.adjustmentNote.adjustmentNumber}@${fy(pay.adjustmentNote.issuedAt)}`
          : null,
      )
      .filter(Boolean)
      .join(", ");
    const detail =
      phantomPayments.length === 0
        ? "no SUCCEEDED phantom Payment row — ledger-only reset; verify any card-path collection"
        : `phantom payments=${phantomPayments.length}${
            noteSummary ? `, INCREASE notes to reverse: ${noteSummary}` : ", no INCREASE note"
          }`;
    console.log(`PHANTOM ${ref}  captured ${money(captured)}  — ${detail}  [${classification.reason}]`);

    if (!args.apply) continue;

    // 1) Void phantom payments + 2) reverse their INCREASE notes.
    for (const pay of phantomPayments) {
      await p.payment.update({
        where: { id: pay.id },
        data: {
          status: "FAILED",
          notes: `Reconciliation: phantom bond capture reversed (hold never captured at Stripe)`,
          processedAt: pay.processedAt ?? new Date(),
        },
      });
      voidedPayments++;

      const note = pay.adjustmentNote;
      if (note?.type === "INCREASE") {
        const reversalDesc = `Reversal of bond capture ${note.adjustmentNumber} — hold expired uncaptured, no consideration received`;
        const already = await p.adjustmentNote.findFirst({
          where: {
            invoiceId: note.invoiceId,
            type: "DECREASE",
            status: { not: "VOID" },
            description: { contains: `Reversal of bond capture ${note.adjustmentNumber}` },
          },
          select: { id: true },
        });
        if (already) continue;
        const amount = Number(note.totalAmount);
        await issueAdjustmentNote({
          invoiceId: note.invoiceId,
          type: "DECREASE",
          reason: "OTHER",
          description: reversalDesc,
          lineItems: [
            {
              description: `Reversal — phantom bond capture (${pay.reference})`,
              detail: "Bond hold was never captured at Stripe; consideration never received.",
              quantity: 1,
              unitPrice: amount,
              totalPrice: amount,
              gstIncluded: true,
            },
          ],
          // The original INCREASE already holds this payment's @unique link.
          paymentId: null,
          issuedById: null,
          skipCustomerEmail: true,
        });
        reversedNotes++;
      }
    }

    // 3) Reset the ledger — the hold expired, so the bond is released in full.
    const reversalDeduction = {
      reason: "Reconciliation reversal — phantom bond capture (hold never captured)",
      amount: -captured,
    };
    const priorDeductions = Array.isArray(ledger.deductions)
      ? (ledger.deductions as unknown[])
      : [];
    await p.bondLedger.update({
      where: { id: ledger.id },
      data: {
        capturedAmount: 0,
        releasedAmount: held,
        status: "RELEASED",
        deductions: [...priorDeductions, reversalDeduction] as Prisma.InputJsonValue,
      },
    });
  }

  console.log(
    `\nScanned ${ledgers.length} captured bond ledger(s): ` +
      `${phantomCount} phantom (${money(totalPhantomAud)}), ${realCount} real, ${skipCount} skipped.`,
  );
  if (args.apply) {
    console.log(
      `Applied: ${voidedPayments} payment(s) voided, ${reversedNotes} reversing note(s) issued, ${phantomCount} ledger(s) released.\n`,
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
