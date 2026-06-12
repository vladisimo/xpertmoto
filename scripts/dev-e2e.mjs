// Boots `next dev` against the isolated e2e database.
//
// Why spawn instead of `node --env-file` or an in-process import:
//  - `node --env-file=.env.e2e next dev` fails: next dev copies the parent's
//    node CLI flags into NODE_OPTIONS for its workers, and `--env-file` is
//    rejected there.
//  - Loading dotenv in *this* process then importing the next CLI isn't enough
//    either: next dev forks worker processes, and @next/env resets each
//    worker's process.env to the env it was spawned with. Vars we only set
//    in-process after fork don't survive.
// So: parse .env.e2e and spawn the next CLI as a child with those vars baked
// into its real environment. Every worker then inherits DATABASE_URL (the e2e
// database), NEXT_DIST_DIR (separate build dir), etc. from birth.
import { config } from "dotenv";
import { spawn } from "node:child_process";

const parsed = config({ path: ".env.e2e" }).parsed ?? {};
const port = process.env.PORT || "3137"; // matches playwright.config E2E default
const env = { ...process.env, ...parsed, PORT: port };

// Tier-2 Stripe: the default e2e profile runs stub mode (.env.e2e blanks the
// Stripe vars). Exporting STRIPE_TEST_SECRET_KEY / STRIPE_TEST_PUBLISHABLE_KEY
// (the names the Playwright stripe fixture already gates on via STRIPE_READY)
// maps them onto the real var names for this server run only, so
// `npm run test:e2e:stripe` exercises real test-mode Elements/3DS/decline.
if (process.env.STRIPE_TEST_SECRET_KEY && process.env.STRIPE_TEST_PUBLISHABLE_KEY) {
  env.STRIPE_SECRET_KEY = process.env.STRIPE_TEST_SECRET_KEY;
  env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = process.env.STRIPE_TEST_PUBLISHABLE_KEY;
}

const child = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "dev", "-p", port],
  { stdio: "inherit", env },
);
child.on("exit", (code) => process.exit(code ?? 0));
