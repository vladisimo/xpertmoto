/**
 * One-shot backfill: grandfather every existing user as email-verified
 * (R2-M4). New registrations must confirm their email before they can
 * confirm a booking; existing accounts predate that gate, so we stamp
 * `emailVerified` for everyone who doesn't already have it set. This means
 * the new gate only ever bites accounts created AFTER this deploy.
 *
 * Run this as part of the R2-M4 deploy, BEFORE (or immediately after) the
 * email-verification gate goes live, so current customers aren't blocked
 * from confirming a booking.
 *
 * Idempotent: the `emailVerified is null` filter skips already-stamped or
 * OAuth-verified users, so re-running is safe.
 *
 * Flags:
 *   --apply   actually write changes (default: dry-run)
 */
import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();

function parseArgs(argv: string[]): { apply: boolean } {
  const args = { apply: false };
  for (const a of argv) {
    if (a === "--apply") args.apply = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const where = { emailVerified: null, deletedAt: null };
  const count = await p.user.count({ where });

  console.log(
    `${args.apply ? "APPLY" : "DRY-RUN"}: ${count} existing user(s) without emailVerified`,
  );

  if (!args.apply) {
    console.log(`Dry-run complete. Re-run with --apply to grandfather ${count} user(s).`);
    return;
  }

  const stampedAt = new Date();
  const res = await p.user.updateMany({
    where,
    data: { emailVerified: stampedAt },
  });
  console.log(`Done: stamped emailVerified=${stampedAt.toISOString()} on ${res.count} user(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await p.$disconnect();
  });
