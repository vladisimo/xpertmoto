/**
 * One-shot backfill: heal CANCELLED bookings whose `balanceDue` was never
 * zeroed and/or whose `BookingBillingPlan` was left in ACTIVE/PAUSED state.
 *
 * Cause: prior versions of `cancel()` in
 * src/server/services/booking-cancellation.ts only updated booking status
 * + cancellationReason, leaving the customer-facing Payments tab showing
 * a non-zero Balance due and a still-Active billing plan. The fix landed
 * forward; this script catches up rows that were cancelled before then.
 *
 * Dry-run by default. Pass --apply to commit.
 *
 * Flags:
 *   --apply              actually write changes (default: dry-run)
 *   --booking-id <id>    process a single booking (its bookingReference or id)
 */
import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();

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

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const candidates = await p.booking.findMany({
    where: {
      status: "CANCELLED",
      ...(args.bookingId
        ? {
            OR: [
              { id: args.bookingId },
              { bookingReference: args.bookingId },
            ],
          }
        : {
            OR: [
              { balanceDue: { gt: 0 } },
              {
                billingPlan: {
                  is: { status: { in: ["ACTIVE", "PAUSED"] } },
                },
              },
            ],
          }),
    },
    select: {
      id: true,
      bookingReference: true,
      balanceDue: true,
      cancellationReason: true,
      billingPlan: { select: { id: true, status: true } },
    },
    orderBy: { updatedAt: "asc" },
  });

  if (candidates.length === 0) {
    console.log("No cancelled bookings need reconciliation.");
    return;
  }

  console.log(
    `${args.apply ? "APPLY" : "DRY-RUN"} — ${candidates.length} cancelled booking(s) to reconcile:`,
  );

  let balanceFixed = 0;
  let plansCancelled = 0;

  for (const b of candidates) {
    const willZeroBalance = Number(b.balanceDue) > 0;
    const willCancelPlan =
      b.billingPlan && (b.billingPlan.status === "ACTIVE" || b.billingPlan.status === "PAUSED");

    const parts: string[] = [];
    if (willZeroBalance) parts.push(`balanceDue ${b.balanceDue} → 0`);
    if (willCancelPlan) parts.push(`plan ${b.billingPlan!.status} → CANCELLED`);
    if (parts.length === 0) continue;

    console.log(`  ${b.bookingReference} (${b.id}): ${parts.join(", ")}`);

    if (!args.apply) {
      if (willZeroBalance) balanceFixed++;
      if (willCancelPlan) plansCancelled++;
      continue;
    }

    await p.$transaction(async (tx) => {
      if (willZeroBalance) {
        await tx.booking.update({
          where: { id: b.id },
          data: { balanceDue: 0 },
        });
        balanceFixed++;
      }
      if (willCancelPlan) {
        const reason = `Backfill: parent booking already cancelled (${b.cancellationReason ?? "no reason recorded"})`;
        await tx.bookingBillingPlan.update({
          where: { bookingId: b.id },
          data: { status: "CANCELLED", cancelReason: reason },
        });
        plansCancelled++;
      }
    });
  }

  console.log("");
  console.log(
    `Summary: ${balanceFixed} balance(s) zeroed, ${plansCancelled} plan(s) cancelled.${
      args.apply ? "" : " Re-run with --apply to commit."
    }`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => p.$disconnect());
