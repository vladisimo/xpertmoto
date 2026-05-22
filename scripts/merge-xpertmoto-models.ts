#!/usr/bin/env tsx
/**
 * One-off cleanup: merge the year=2024 orphan VehicleModel rows that
 * `scripts/import-xpertmoto-rates.ts` created onto existing fleet-attached
 * VehicleModel rows that share the same make+model.
 *
 * Why this is needed: the first import used year=2024 as a sentinel for
 * "year unknown", but the seed catalogue already has rows for the same
 * (make, model) with different years (e.g. CB125F 2022). Result was a
 * duplicate row per bike — one with rates and zero fleet, one with the
 * fleet but no rates.
 *
 * Merge rule:
 *   1. Pick every VehicleModel with baseRate IS NOT NULL and 0 vehicles
 *      attached (the orphans).
 *   2. For each, find any other VehicleModel with the same normalised
 *      (make+model) — case/spaces/hyphens ignored — that has vehicles
 *      attached. If multiple candidates: take the one with the most
 *      vehicles.
 *   3. Copy baseRate + basePeriodHours onto the target. Re-point the
 *      orphan's PricingTier rows at the target (UPDATE modelId).
 *   4. Delete the orphan.
 *   5. If no candidate found, leave the orphan in place and log it — that
 *      means xpertmoto.com.au sells a bike we don't have in the fleet
 *      catalogue yet.
 *
 * Idempotent: running again after a successful merge is a no-op (all
 * orphans have either been deleted or had no candidate).
 *
 *   npx tsx scripts/merge-xpertmoto-models.ts            # apply
 *   npx tsx scripts/merge-xpertmoto-models.ts --dry-run  # log only
 */

import { PrismaClient } from "@prisma/client";

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const prisma = new PrismaClient();
  try {
    const allModels = await prisma.vehicleModel.findMany({
      include: { _count: { select: { vehicles: true } } },
    });
    console.log(`Loaded ${allModels.length} VehicleModel rows${dryRun ? " (DRY RUN)" : ""}`);

    // Index every model by its normalised (make+model) key. A model may
    // appear under multiple year rows so we collect them.
    const byKey = new Map<string, typeof allModels>();
    for (const m of allModels) {
      const key = `${normalise(m.make)}|${normalise(m.model)}`;
      const arr = byKey.get(key) ?? [];
      arr.push(m);
      byKey.set(key, arr);
    }

    const orphans = allModels.filter(
      (m) => m.baseRate !== null && m._count.vehicles === 0,
    );
    console.log(`Found ${orphans.length} orphan model row(s) (baseRate set, 0 fleet)`);

    let merged = 0;
    let kept = 0;

    for (const orphan of orphans) {
      const key = `${normalise(orphan.make)}|${normalise(orphan.model)}`;
      const candidates = (byKey.get(key) ?? [])
        .filter((m) => m.id !== orphan.id && m._count.vehicles > 0)
        .sort((a, b) => b._count.vehicles - a._count.vehicles);

      if (candidates.length === 0) {
        console.log(
          `  · KEEP ${orphan.make} ${orphan.model} ${orphan.year} — no fleet-attached candidate`,
        );
        kept++;
        continue;
      }

      const target = candidates[0]!;
      const note =
        candidates.length > 1
          ? `(picked target with ${target._count.vehicles} fleet of ${candidates.length} candidates)`
          : `(target has ${target._count.vehicles} fleet)`;

      if (dryRun) {
        console.log(
          `  · DRY: MERGE ${orphan.make} ${orphan.model} ${orphan.year} → ${target.make} ${target.model} ${target.year} ${note}`,
        );
        merged++;
        continue;
      }

      await prisma.$transaction(async (tx) => {
        // 1. Delete target's pre-existing tier ladder first — defensive;
        //    typically empty, but a previous partial merge could have left
        //    rows behind.
        await tx.pricingTier.deleteMany({ where: { modelId: target.id } });
        // 2. Re-point the orphan's tier ladder onto the target. The orphan
        //    rows are the authoritative xpertmoto rates.
        await tx.pricingTier.updateMany({
          where: { modelId: orphan.id },
          data: { modelId: target.id },
        });
        // 3. Copy baseRate / basePeriodHours onto the target.
        await tx.vehicleModel.update({
          where: { id: target.id },
          data: {
            baseRate: orphan.baseRate,
            basePeriodHours: orphan.basePeriodHours,
          },
        });
        // 4. Delete the orphan.
        await tx.vehicleModel.delete({ where: { id: orphan.id } });
      });

      console.log(
        `  · MERGE ${orphan.make} ${orphan.model} ${orphan.year} → ${target.make} ${target.model} ${target.year} ${note}`,
      );
      merged++;
    }

    console.log("");
    console.log(`Done. ${merged} merged, ${kept} kept as standalone orphans.`);

    // ----- Fan-out: copy rates onto year-sibling rows -----
    //
    // After the merge, only ONE year row per (make, model) has the
    // xpertmoto rate + tier ladder. Sibling rows with different years
    // (e.g. "Honda CB125F 2022" vs "Honda CB125F 2023") still have
    // baseRate=NULL and no tier ladder. xpertmoto's rate card doesn't
    // vary by year, so fan the rate out to every active sibling.
    //
    // For each (normalised make+model) group with one rate-bearing row:
    //   - Copy baseRate + basePeriodHours onto every sibling.
    //   - Duplicate the rate-bearing row's tier ladder onto every
    //     sibling (each sibling gets its own PricingTier rows).
    // Idempotent: if a sibling already has a baseRate or tier ladder
    // we leave it alone (the operator may have customised it).
    const afterMerge = await prisma.vehicleModel.findMany({
      include: {
        _count: { select: { vehicles: true } },
        pricingTiers: { where: { isActive: true }, orderBy: { minDays: "asc" } },
      },
    });
    const groups = new Map<string, typeof afterMerge>();
    for (const m of afterMerge) {
      const k = `${normalise(m.make)}|${normalise(m.model)}`;
      const arr = groups.get(k) ?? [];
      arr.push(m);
      groups.set(k, arr);
    }

    let fannedOut = 0;
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const source = group.find((m) => m.baseRate !== null && m.pricingTiers.length > 0);
      if (!source) continue;
      const targets = group.filter(
        (m) => m.id !== source.id && m.baseRate === null && m._count.vehicles > 0,
      );
      if (targets.length === 0) continue;

      for (const t of targets) {
        if (dryRun) {
          console.log(
            `  · DRY: FAN-OUT ${source.make} ${source.model} ${source.year} → ${t.make} ${t.model} ${t.year} (${t._count.vehicles} fleet)`,
          );
          fannedOut++;
          continue;
        }
        await prisma.$transaction(async (tx) => {
          await tx.vehicleModel.update({
            where: { id: t.id },
            data: {
              baseRate: source.baseRate,
              basePeriodHours: source.basePeriodHours,
            },
          });
          // Don't clobber an existing per-target ladder — if the operator
          // set one we respect it.
          const existing = await tx.pricingTier.count({ where: { modelId: t.id } });
          if (existing === 0 && source.pricingTiers.length > 0) {
            await tx.pricingTier.createMany({
              data: source.pricingTiers.map((s) => ({
                modelId: t.id,
                minDays: s.minDays,
                maxDays: s.maxDays,
                tierMode: s.tierMode,
                tierTotal: s.tierTotal,
                pricePerWeek: s.pricePerWeek,
                isActive: s.isActive,
              })),
            });
          }
        });
        console.log(
          `  · FAN-OUT ${source.make} ${source.model} ${source.year} → ${t.make} ${t.model} ${t.year} (${t._count.vehicles} fleet)`,
        );
        fannedOut++;
      }
    }
    console.log(`Fanned out rate cards to ${fannedOut} sibling year row(s).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
