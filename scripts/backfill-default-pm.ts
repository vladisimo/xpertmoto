/**
 * One-shot backfill: persist the default Stripe PaymentMethod for customers
 * who paid a booking deposit online but never had the DB pointer written
 * (the checkout wizard created a SetupIntent it never confirmed, so
 * `CustomerProfile.defaultStripePaymentMethodId` stayed null and every
 * off-session auto-charge skipped with "no stored PM").
 *
 * The card IS attached to the Stripe Customer — every deposit PI is created
 * with `setup_future_usage: "off_session"` — so this walks each affected
 * profile's most recent SUCCEEDED BOOKING_PAYMENT, reads the PaymentMethod
 * off the PaymentIntent, and calls persistDefaultPaymentMethodFromIntent
 * (which sets the Stripe default + caches brand/last4 and audits).
 *
 * Idempotent: profiles with a default PM already set are skipped (both by
 * the query filter and inside the persist helper). Stub-mode ids are
 * skipped. Rate: one Stripe read per customer — throttled below.
 *
 * Flags:
 *   --apply       actually write changes (default: dry-run)
 *   --limit <n>   process at most n profiles (default: all)
 */
import { PrismaClient } from "@prisma/client";
import { retrievePaymentIntent } from "../src/lib/stripe";
import { persistDefaultPaymentMethodFromIntent } from "../src/server/services/stripe-customer";

const p = new PrismaClient();

function parseArgs(argv: string[]): { apply: boolean; limit: number | null } {
  const args: { apply: boolean; limit: number | null } = { apply: false, limit: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--apply") args.apply = true;
    else if (a === "--limit") {
      const v = Number(argv[i + 1]);
      if (!Number.isInteger(v) || v <= 0) throw new Error("--limit needs a positive integer");
      args.limit = v;
      i += 1;
    } else throw new Error(`unknown argument: ${a}`);
  }
  return args;
}

async function main() {
  const { apply, limit } = parseArgs(process.argv.slice(2));

  const profiles = await p.customerProfile.findMany({
    where: {
      defaultStripePaymentMethodId: null,
      stripeCustomerId: { not: null },
    },
    select: { userId: true, stripeCustomerId: true },
    ...(limit ? { take: limit } : {}),
  });

  let scanned = 0;
  let persisted = 0;
  let noPi = 0;
  let noPm = 0;
  let errors = 0;

  for (const profile of profiles) {
    scanned += 1;
    if (!profile.stripeCustomerId || profile.stripeCustomerId.startsWith("cus_stub_")) {
      continue;
    }
    const payment = await p.payment.findFirst({
      where: {
        customerId: profile.userId,
        type: "BOOKING_PAYMENT",
        status: "SUCCEEDED",
        stripePaymentIntentId: { not: null },
      },
      orderBy: { processedAt: "desc" },
      select: { stripePaymentIntentId: true },
    });
    if (!payment?.stripePaymentIntentId || payment.stripePaymentIntentId.startsWith("pi_stub_")) {
      noPi += 1;
      continue;
    }
    try {
      const pi = await retrievePaymentIntent(payment.stripePaymentIntentId);
      if (!pi?.paymentMethodId) {
        noPm += 1;
        continue;
      }
      if (apply) {
        const res = await persistDefaultPaymentMethodFromIntent(
          profile.userId,
          pi.paymentMethodId,
          { prisma: p },
        );
        if (res.persisted) persisted += 1;
      } else {
        persisted += 1; // would persist
        console.log(`[dry-run] would persist PM for user ${profile.userId}`);
      }
      // Gentle on the Stripe API — this is a one-shot maintenance script.
      await new Promise((r) => setTimeout(r, 120));
    } catch (err) {
      errors += 1;
      console.error(
        `user ${profile.userId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  console.log(
    `${apply ? "APPLIED" : "DRY-RUN"}: scanned=${scanned} persisted=${persisted} noSucceededPi=${noPi} piWithoutPm=${noPm} errors=${errors}`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => p.$disconnect());
