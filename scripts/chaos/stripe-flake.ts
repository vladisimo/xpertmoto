#!/usr/bin/env tsx
/**
 * G16 chaos — Stripe flake injection.
 *
 * Runs the booking-flow integration suite with a fault-injecting Stripe
 * mock that returns 5xx for a configurable fraction of calls. Targets:
 *
 *   - with a 30% Stripe failure rate, the suite still passes (no
 *     duplicated Payment rows, no stuck bookings, retry-queue absorbs the
 *     transient failures)
 *   - at 100% failure rate, bookings fail cleanly (status CANCELLED) with
 *     no orphaned Payment rows
 *
 * Usage:
 *   npm run chaos:stripe-flake -- --rate=0.3
 *
 * The script sets `CHAOS_STRIPE_FLAKE_RATE` and hands off to vitest; the
 * rate is consumed by `src/lib/stripe.ts` when this env var is present.
 */

import { spawnSync } from "node:child_process";

function parseArgs(argv: string[]): { rate: number; pattern: string } {
  const args: Record<string, string> = {};
  for (const a of argv.slice(2)) {
    const [k, v] = a.replace(/^--/, "").split("=");
    if (k && v != null) args[k] = v;
  }
  const rate = Math.min(1, Math.max(0, parseFloat(args.rate ?? "0.3")));
  const pattern = args.pattern ?? "tests/integration/booking-flow.test.ts";
  return { rate, pattern };
}

const { rate, pattern } = parseArgs(process.argv);
console.log(`[chaos] Stripe flake at ${(rate * 100).toFixed(0)}% on ${pattern}`);

const res = spawnSync(
  "npx",
  ["vitest", "run", pattern],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      CHAOS_STRIPE_FLAKE_RATE: String(rate),
      ALLOW_STUB_STRIPE: "1",
    },
  },
);
process.exit(res.status ?? 1);
