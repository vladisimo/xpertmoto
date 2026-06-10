/**
 * Load-test data inflation.
 *
 * Run AFTER `tsx prisma/seed.ts` (which creates depots/categories/vehicles/
 * users/pricing). This bulk-inserts historical + near-future bookings so the
 * Booking/Payment tables reach realistic size and the availability/pricing
 * query paths traverse representative row counts.
 *
 *   HIST=18000 FUT=500 npx tsx scripts/load/seed-loadtest.ts
 *
 * Strategy: clone an existing booking row (all scalar fields) and override
 * only reference / FKs / dates / status. Historical rows are COMPLETED in the
 * past 3y (table-size realism); future rows are CONFIRMED in the next 60d
 * (real availability contention for booking.availability overlap checks).
 *
 * Idempotent-ish: every reference is prefixed LTH-/LTF-, so re-running just
 * appends a fresh batch. Targets the DATABASE_URL in the environment — guard
 * checks it is the isolated :55432 load-test DB before writing.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const HIST = Number(process.env.HIST ?? 18000);
const FUT = Number(process.env.FUT ?? 500);
const BATCH = 1000;
const DAY = 24 * 3600 * 1000;

function pick<T>(arr: T[], i: number): T {
  return arr[i % arr.length]!;
}

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!url.includes("55432")) {
    throw new Error(`Refusing to seed: DATABASE_URL is not the isolated :55432 load-test DB (got ${url})`);
  }

  // Real IDs from the demo seed.
  const vehicles = await prisma.vehicle.findMany({
    select: { id: true, categoryId: true, depotId: true },
  });
  const customers = await prisma.user.findMany({
    where: { customerProfile: { isNot: null } },
    select: { id: true },
  });
  const template = await prisma.booking.findFirst();
  if (!vehicles.length || !customers.length || !template) {
    throw new Error("Run `tsx prisma/seed.ts` first — need vehicles, customers and a template booking.");
  }
  console.log(`vehicles=${vehicles.length} customers=${customers.length} template=${template.bookingReference}`);

  // Scalar template: drop identity/unique/timestamps so we can override them.
  const base: Record<string, unknown> = { ...template };
  delete base.id;
  delete base.bookingReference;
  delete base.createdAt;
  delete base.updatedAt;
  // Null out any unique-ish or relational extras that could collide.
  delete base.vehicleId;

  const NOW = Date.now();
  const customerIds = customers.map((c) => c.id);

  // Build a row generator.
  function makeRow(seq: number, opts: { future: boolean }) {
    const v = pick(vehicles, seq);
    const startOffsetDays = opts.future
      ? 1 + (seq % 60) // next 60 days
      : -(3 + (seq % (3 * 365))); // past ~3 years
    const durDays = 1 + (seq % 5);
    const pickup = new Date(NOW + startOffsetDays * DAY);
    const ret = new Date(pickup.getTime() + durDays * DAY);
    const ref = opts.future
      ? `LTF-${String(seq).padStart(7, "0")}`
      : `LTH-${String(seq).padStart(7, "0")}`;
    return {
      ...base,
      bookingReference: ref,
      customerId: pick(customerIds, seq * 7 + 3),
      vehicleId: v.id,
      categoryId: v.categoryId,
      depotId: v.depotId,
      pickupDepotId: v.depotId,
      returnDepotId: v.depotId,
      pickupDateTime: pickup,
      returnDateTime: ret,
      status: opts.future ? "CONFIRMED" : "COMPLETED",
      createdAt: new Date(pickup.getTime() - 2 * DAY),
    } as Record<string, unknown>;
  }

  let inserted = 0;
  async function insertRange(count: number, future: boolean, label: string) {
    for (let start = 0; start < count; start += BATCH) {
      const n = Math.min(BATCH, count - start);
      const rows = Array.from({ length: n }, (_, k) => makeRow(start + k, { future }));
      await prisma.booking.createMany({ data: rows as never, skipDuplicates: true });
      inserted += n;
      if ((start / BATCH) % 5 === 0) console.log(`  ${label}: ${start + n}/${count}`);
    }
  }

  console.time("seed-loadtest");
  console.log(`Inserting ${HIST} historical (COMPLETED) bookings...`);
  await insertRange(HIST, false, "hist");
  console.log(`Inserting ${FUT} future (CONFIRMED) bookings...`);
  await insertRange(FUT, true, "fut");
  console.timeEnd("seed-loadtest");

  const total = await prisma.booking.count();
  console.log(`Done. inserted=${inserted}. Booking table now ~${total} rows.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
