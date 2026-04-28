/**
 * One-shot backfill: fix customer addresses that were imported with the
 * whole address jammed into addressLine1 (e.g. "35 kildare road, Blacktown,
 * NSW2148") leaving suburb/state/postcode null.
 *
 * Resolves each candidate against OpenStreetMap Nominatim, splits into
 * canonical components, and writes them back. Dry-run by default; pass
 * --apply to commit.
 *
 * Flags:
 *   --apply              actually write changes (default: dry-run)
 *   --limit N            process only the first N candidates
 *   --customer-id <id>   process a single CustomerProfile by id
 */
import { PrismaClient } from "@prisma/client";
import { resolveAddressComponents } from "../src/lib/geo";

const p = new PrismaClient();

type Args = {
  apply: boolean;
  limit?: number;
  customerId?: string;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { apply: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") args.apply = true;
    else if (a === "--limit") {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n <= 0) {
        throw new Error(`--limit requires a positive integer, got ${argv[i]}`);
      }
      args.limit = n;
    } else if (a === "--customer-id") {
      const v = argv[++i];
      if (!v) throw new Error("--customer-id requires a value");
      args.customerId = v;
    } else {
      throw new Error(`unknown argument: ${a}`);
    }
  }
  return args;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const where = args.customerId
    ? { id: args.customerId }
    : {
        addressLine1: { not: null },
        OR: [
          { addressLine1: { contains: "," } },
          { AND: [{ suburb: null }, { state: null }, { postcode: null }] },
        ],
      };

  const candidates = await p.customerProfile.findMany({
    where,
    select: {
      id: true,
      userId: true,
      addressLine1: true,
      addressLine2: true,
      suburb: true,
      state: true,
      postcode: true,
      country: true,
      user: { select: { firstName: true, lastName: true, email: true } },
    },
    orderBy: { id: "asc" },
    take: args.limit,
  });

  console.log(
    `${args.apply ? "APPLY" : "DRY-RUN"}: ${candidates.length} candidate customer(s)`,
  );
  if (candidates.length === 0) {
    return;
  }

  let updated = 0;
  let unchanged = 0;
  const unresolved: Array<{ id: string; raw: string; who: string }> = [];

  for (const c of candidates) {
    const who = `${c.user.firstName ?? ""} ${c.user.lastName ?? ""} <${c.user.email}>`.trim();
    const raw = c.addressLine1 ?? "";
    if (!raw) {
      unchanged++;
      continue;
    }

    const resolved = await resolveAddressComponents(raw);

    // Nominatim policy is 1 req/sec. The resolver may fire up to ~5 sequential
    // requests on the worst path (full + drop-prefix + 3 locality variants),
    // so sleep 5.5s on geocoded / unresolved paths and 0s on the parsed path.
    if (!resolved) {
      await sleep(5500);
      unresolved.push({ id: c.id, raw, who });
      console.log(`  UNRESOLVED  ${c.id}  ${who}  "${raw}"`);
      continue;
    }
    if (resolved.source === "geocoded") await sleep(5500);

    const noChange =
      c.addressLine1 === resolved.addressLine1 &&
      c.suburb === resolved.suburb &&
      c.state === resolved.state &&
      c.postcode === resolved.postcode &&
      (c.country ?? "Australia") === resolved.country;

    if (noChange) {
      unchanged++;
      continue;
    }

    console.log(
      `  ${args.apply ? "UPDATE" : "WOULD UPDATE"}  ${c.id}  ${who}  [${resolved.source}]\n` +
        `    from: "${c.addressLine1}" | ${c.suburb ?? "—"} | ${c.state ?? "—"} | ${c.postcode ?? "—"}\n` +
        `    to:   "${resolved.addressLine1}" | ${resolved.suburb} | ${resolved.state} | ${resolved.postcode}`,
    );

    if (args.apply) {
      await p.customerProfile.update({
        where: { id: c.id },
        data: {
          addressLine1: resolved.addressLine1,
          suburb: resolved.suburb,
          state: resolved.state,
          postcode: resolved.postcode,
          country: resolved.country,
        },
      });
      updated++;
    }
  }

  console.log("\n--- Summary ---");
  console.log(`Total candidates:   ${candidates.length}`);
  console.log(`Updated:            ${args.apply ? updated : `${updated} (would update ${candidates.length - unchanged - unresolved.length})`}`);
  console.log(`Already clean:      ${unchanged}`);
  console.log(`Unresolved:         ${unresolved.length}`);

  if (unresolved.length > 0) {
    console.log("\nUnresolved customers (manual fix required):");
    for (const u of unresolved) {
      console.log(`  ${u.id}  ${u.who}  "${u.raw}"`);
    }
  }

  if (!args.apply) {
    console.log("\nDry-run complete. Re-run with --apply to commit changes.");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => p.$disconnect());
