#!/usr/bin/env tsx
/**
 * Import the xpertmoto.com.au rate card into the platform.
 *
 *   - Reads scripts/../xpertmoto-fleet.debug.json (output of
 *     `scripts/scrape-xpertmoto.ts`) — NOT the xlsx.
 *   - For each row, upserts a VehicleModel keyed on (make, model, year=2024).
 *     The scrape doesn't capture year, so we use the same placeholder year
 *     prisma/seed.ts uses for catalogue rows (CATALOGUE_YEAR = 2024).
 *   - Sets per-model `baseRate` and `basePeriodHours`.
 *   - Replaces the model's PricingTier ladder with 5 PER_WEEK tiers driven
 *     by the scraped week1 / week2 / week3 / week4_12 / week12p columns
 *     (1wk, 2wk, 3wk, 4-12wk, 12+wk).
 *   - Configures one Sydney "Sydney delivery" Addon ($149, flat).
 *   - Configures `bookingFeePercent = 30`, `onlinePaymentStrategy = PERCENT`,
 *     `longTermMinDays = 28`, `longTermDefaultFrequency = WEEKLY` on every
 *     active category — the xpertmoto deposit / long-term contract.
 *
 * Idempotent — re-runnable with no duplicates. Run with:
 *   npx tsx scripts/import-xpertmoto-rates.ts
 *
 * Optional flag:
 *   --dry-run     log the planned changes without writing
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";

const PLACEHOLDER_YEAR = 2024;
const SYDNEY_DELIVERY_NAME = "Sydney delivery";

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}
const SYDNEY_DELIVERY_FEE = 149;

type ScrapedBike = {
  make: string;
  model: string;
  baseRate: number | null;
  baseHours: 24 | 48 | null;
  week1: number | null;
  week2: number | null;
  week3: number | null;
  week4_12: number | null;
  week12p: number | null;
  depositPct: number | null;
  deliveryAud: number | null;
  url: string;
};

type PlannedTier = {
  minDays: number;
  maxDays: number;
  pricePerWeek: number;
};

function slugify(make: string, model: string, year: number): string {
  return `${make}-${model}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    + `-${year}`;
}

/** Build the per-model tier ladder from the scraped weekly columns.
 *  Returns null when no weekly rate is captured — the model falls back to
 *  the per-model baseRate × days for any rental, with no tier ladder.
 *
 *  Tier boundaries are inclusive day counts:
 *    1wk     →   7..13  ($/wk = week1)
 *    2wk     →  14..20  ($/wk = week2)
 *    3wk     →  21..27  ($/wk = week3)
 *    4–12wk  →  28..83  ($/wk = week4_12)   (12 × 7 - 1 = 83)
 *    12+wk   →  84..3650 ($/wk = week12p)
 */
function planTiers(bike: ScrapedBike): PlannedTier[] {
  const tiers: PlannedTier[] = [];
  if (bike.week1 != null) tiers.push({ minDays: 7, maxDays: 13, pricePerWeek: bike.week1 });
  if (bike.week2 != null) tiers.push({ minDays: 14, maxDays: 20, pricePerWeek: bike.week2 });
  if (bike.week3 != null) tiers.push({ minDays: 21, maxDays: 27, pricePerWeek: bike.week3 });
  if (bike.week4_12 != null)
    tiers.push({ minDays: 28, maxDays: 83, pricePerWeek: bike.week4_12 });
  if (bike.week12p != null)
    tiers.push({ minDays: 84, maxDays: 3650, pricePerWeek: bike.week12p });
  return tiers;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const inputPath = resolve(process.cwd(), "xpertmoto-fleet.debug.json");
  const raw = readFileSync(inputPath, "utf-8");
  const bikes = JSON.parse(raw) as ScrapedBike[];
  console.log(`Loaded ${bikes.length} bikes from ${inputPath}${dryRun ? " (DRY RUN)" : ""}`);

  const prisma = new PrismaClient();

  try {
    // ----- Sydney depot lookup -----
    const sydneyDepot = await prisma.depot.findFirst({
      where: {
        OR: [
          { suburb: { contains: "Sydney", mode: "insensitive" } },
          { suburb: { contains: "Lewisham", mode: "insensitive" } },
          { name: { contains: "Sydney", mode: "insensitive" } },
          { name: { contains: "Lewisham", mode: "insensitive" } },
        ],
      },
      orderBy: { createdAt: "asc" },
    });
    if (!sydneyDepot) {
      console.warn("WARN: no Sydney depot found — Sydney delivery addon will be left depot-agnostic.");
    } else {
      console.log(`Sydney depot: ${sydneyDepot.name} (${sydneyDepot.id})`);
    }

    // ----- Sydney delivery addon (idempotent on name + depot) -----
    if (!dryRun) {
      const existing = await prisma.addon.findFirst({
        where: { name: SYDNEY_DELIVERY_NAME, depotId: sydneyDepot?.id ?? null },
      });
      if (existing) {
        await prisma.addon.update({
          where: { id: existing.id },
          data: {
            flatRate: new Prisma.Decimal(SYDNEY_DELIVERY_FEE),
            isPerDay: false,
            type: "DELIVERY",
            isActive: true,
          },
        });
        console.log(`  · Updated existing Sydney delivery addon (${existing.id})`);
      } else {
        const created = await prisma.addon.create({
          data: {
            name: SYDNEY_DELIVERY_NAME,
            description: "Flat-rate delivery anywhere in the Sydney metro area.",
            type: "DELIVERY",
            flatRate: new Prisma.Decimal(SYDNEY_DELIVERY_FEE),
            isPerDay: false,
            isRequired: false,
            maxQuantity: 1,
            depotId: sydneyDepot?.id ?? null,
            isActive: true,
          },
        });
        console.log(`  · Created Sydney delivery addon (${created.id})`);
      }
    } else {
      console.log("  · DRY: would upsert Sydney delivery addon ($149 flat)");
    }

    // ----- Category-level xpertmoto contract -----
    // 50% deposit of the FIRST WEEK's rental on booking + bond on top;
    // balance at pickup. 28+ day rentals get a weekly billing plan.
    // Applied to every active category — operators can re-tune individual
    // categories from the admin pricing page after.
    //
    // The "50% of week 1" semantic is encoded as PERCENT/50% on the
    // category + a global `pricing.depositBasis = WEEK1` SystemSetting
    // (configured below). For non-xpertmoto deployments, leaving
    // `depositBasis` unset falls back to the historical "% of total"
    // behaviour.
    const categories = await prisma.vehicleCategory.findMany({ where: { isActive: true } });
    console.log(`Configuring ${categories.length} active categories for xpertmoto contract`);
    for (const c of categories) {
      if (dryRun) {
        console.log(
          `  · DRY: would set ${c.name} → PERCENT/50%, longTermMinDays=28, WEEKLY`,
        );
        continue;
      }
      await prisma.vehicleCategory.update({
        where: { id: c.id },
        data: {
          onlinePaymentStrategy: "PERCENT",
          bookingFeePercent: new Prisma.Decimal(50),
          longTermMinDays: 28,
          longTermDefaultFrequency: "WEEKLY",
        },
      });
    }

    // Set the deposit-basis lever — PERCENT × week-1 base subtotal instead
    // of × total. Stored as a JSON string so the readPricingFlags helper
    // can branch on it without a schema enum.
    if (dryRun) {
      console.log("  · DRY: would set SystemSetting pricing.depositBasis = WEEK1");
    } else {
      await prisma.systemSetting.upsert({
        where: { key: "pricing.depositBasis" },
        update: { value: "WEEK1" },
        create: { key: "pricing.depositBasis", value: "WEEK1" },
      });
      console.log("  · Set SystemSetting pricing.depositBasis = WEEK1");
    }

    // ----- Per-bike: upsert model + replace tier ladder -----
    //
    // Matching strategy: prefer an existing VehicleModel that already has
    // vehicles attached and shares the normalised (make+model). This
    // avoids creating orphan year=2024 rows in parallel with the seeded
    // catalogue (which is the bug the merge-xpertmoto-models.ts script
    // fixes after the fact). Falls back to upserting on (make, model,
    // year=PLACEHOLDER_YEAR) when no fleet-attached candidate exists —
    // that covers bikes xpertmoto sells but we don't have in our fleet.
    const allModels = await prisma.vehicleModel.findMany({
      include: { _count: { select: { vehicles: true } } },
    });
    const byKey = new Map<string, typeof allModels>();
    for (const m of allModels) {
      const key = `${normalise(m.make)}|${normalise(m.model)}`;
      const arr = byKey.get(key) ?? [];
      arr.push(m);
      byKey.set(key, arr);
    }

    let createdModels = 0;
    let updatedModels = 0;
    let totalTiers = 0;
    let skipped = 0;

    for (const bike of bikes) {
      if (!bike.make || !bike.model || bike.baseRate == null) {
        console.warn(`  · SKIP ${bike.url} — incomplete (make/model/baseRate)`);
        skipped++;
        continue;
      }

      const slug = slugify(bike.make, bike.model, PLACEHOLDER_YEAR);
      const basePeriodHours = bike.baseHours === 48 ? "H48" : "H24";
      const tiers = planTiers(bike);

      const key = `${normalise(bike.make)}|${normalise(bike.model)}`;
      const candidates = (byKey.get(key) ?? [])
        .filter((m) => m._count.vehicles > 0)
        .sort((a, b) => b._count.vehicles - a._count.vehicles);
      const target = candidates[0] ?? null;

      if (dryRun) {
        const label = target
          ? `→ EXISTING ${target.make} ${target.model} ${target.year} (${target._count.vehicles} fleet)`
          : `→ NEW (year=${PLACEHOLDER_YEAR}, no fleet candidate)`;
        console.log(
          `  · DRY: ${bike.make} ${bike.model} ${label} baseRate $${bike.baseRate}/${basePeriodHours}, ${tiers.length} tier(s)`,
        );
        continue;
      }

      let modelId: string;
      let wasUpdate: boolean;
      if (target) {
        await prisma.vehicleModel.update({
          where: { id: target.id },
          data: {
            baseRate: new Prisma.Decimal(bike.baseRate),
            basePeriodHours,
          },
        });
        modelId = target.id;
        wasUpdate = true;
      } else {
        const existing = await prisma.vehicleModel.findUnique({
          where: { make_model_year: { make: bike.make, model: bike.model, year: PLACEHOLDER_YEAR } },
        });
        const m = await prisma.vehicleModel.upsert({
          where: { make_model_year: { make: bike.make, model: bike.model, year: PLACEHOLDER_YEAR } },
          update: {
            baseRate: new Prisma.Decimal(bike.baseRate),
            basePeriodHours,
          },
          create: {
            make: bike.make,
            model: bike.model,
            year: PLACEHOLDER_YEAR,
            slug,
            baseRate: new Prisma.Decimal(bike.baseRate),
            basePeriodHours,
          },
        });
        modelId = m.id;
        wasUpdate = existing !== null;
      }

      if (wasUpdate) updatedModels++;
      else createdModels++;

      // Replace the model's tier ladder atomically.
      await prisma.$transaction(async (tx) => {
        await tx.pricingTier.deleteMany({ where: { modelId } });
        if (tiers.length > 0) {
          await tx.pricingTier.createMany({
            data: tiers.map((t) => ({
              modelId,
              minDays: t.minDays,
              maxDays: t.maxDays,
              tierMode: "PER_WEEK" as const,
              tierTotal: new Prisma.Decimal(0),
              pricePerWeek: new Prisma.Decimal(t.pricePerWeek),
              isActive: true,
            })),
          });
        }
      });
      totalTiers += tiers.length;
      const targetLabel = target
        ? `${target.make} ${target.model} ${target.year}`
        : `${bike.make} ${bike.model} ${PLACEHOLDER_YEAR}`;
      console.log(
        `  · ${wasUpdate ? "updated" : "created"} ${targetLabel} → $${bike.baseRate}/${basePeriodHours}, ${tiers.length} tier(s)`,
      );
    }

    console.log("");
    console.log(
      `Done. ${createdModels} new model(s), ${updatedModels} updated, ${totalTiers} tier(s) written, ${skipped} skipped.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
