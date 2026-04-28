#!/usr/bin/env tsx
/**
 * Auto-discover VehicleModel catalogue rows from the existing fleet.
 *
 *   SELECT DISTINCT make, model, year, categoryId FROM Vehicle
 *
 * For every unique tuple, upsert a VehicleModel row (keyed on
 * make+model+year) and link every matching Vehicle.modelId back to it.
 *
 * Safe to re-run — every write is an upsert / idempotent update.
 * Run with: `npx tsx scripts/backfill-vehicle-models.ts`
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function slugify(make: string, model: string, year: number): string {
  const clean = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  return `${clean(make)}-${clean(model)}-${year}`;
}

async function main() {
  const combos = await prisma.vehicle.groupBy({
    by: ["make", "model", "year", "categoryId"],
    _count: { _all: true },
  });
  combos.sort((a, b) =>
    a.make.localeCompare(b.make) ||
    a.model.localeCompare(b.model) ||
    a.year - b.year,
  );

  let createdOrTouched = 0;
  let linked = 0;

  for (const c of combos) {
    const slug = slugify(c.make, c.model, c.year);
    const row = await prisma.vehicleModel.upsert({
      where: { make_model_year: { make: c.make, model: c.model, year: c.year } },
      update: { categoryId: c.categoryId },
      create: {
        make: c.make,
        model: c.model,
        year: c.year,
        slug,
        categoryId: c.categoryId,
        specsConfidence: "UNVERIFIED",
      },
    });
    createdOrTouched++;

    const res = await prisma.vehicle.updateMany({
      where: { make: c.make, model: c.model, year: c.year, modelId: null },
      data: { modelId: row.id },
    });
    linked += res.count;

    const note = res.count > 0 ? `linked ${res.count}` : "no new links";
    console.log(`· ${c.make} ${c.model} (${c.year}) — ${c._count._all} vehicle(s), ${note}`);
  }

  console.log(
    `\nDone. ${createdOrTouched} catalogue rows touched, ${linked} vehicles linked.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
