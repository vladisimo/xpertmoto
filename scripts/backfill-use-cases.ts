/**
 * Backfill: classify every VehicleModel across the browse/filter axes and,
 * where useful, set a short marketing tagline. Idempotent — safe to re-run.
 *
 * The per-slug map below is still expressed with the original six "use case"
 * tags (incl. SPORT_CRUISER / LEARNER_APPROVED) for readability. Those two were
 * split out of FleetUseCase into the BikeType and RiderLevel axes (see the
 * bike_classification_axes migration); `normalizeTags()` translates the legacy
 * tags into the three current axes at write time, so the data here stays terse.
 *
 * Run:  npx tsx scripts/backfill-use-cases.ts
 */

import { PrismaClient, type BikeType, type FleetUseCase, type RiderLevel } from "@prisma/client";

const prisma = new PrismaClient();

/** The original six tags, kept as the script's input vocabulary. */
type LegacyUseCase = FleetUseCase | "SPORT_CRUISER" | "LEARNER_APPROVED";
type Tagging = { useCases: LegacyUseCase[]; tagline?: string };

/** Split legacy tags into the current three axes. */
function normalizeTags(legacy: LegacyUseCase[]): {
  useCases: FleetUseCase[];
  bikeTypes: BikeType[];
  riderLevels: RiderLevel[];
} {
  const useCases: FleetUseCase[] = [];
  const bikeTypes = new Set<BikeType>();
  const riderLevels = new Set<RiderLevel>();
  for (const tag of legacy) {
    if (tag === "SPORT_CRUISER") {
      bikeTypes.add("SPORT");
      bikeTypes.add("CRUISER");
    } else if (tag === "LEARNER_APPROVED") {
      riderLevels.add("BEGINNER");
    } else {
      useCases.push(tag);
    }
  }
  return { useCases, bikeTypes: [...bikeTypes], riderLevels: [...riderLevels] };
}

/**
 * Explicit per-slug tagging. When a slug lands here, its tags are applied
 * verbatim. Anything not listed falls through to the heuristic fallback.
 */
const TAG_BY_SLUG: Record<string, Tagging> = {
  // Adventure tourers
  "bmw-f-750-gs-triple-black-2023": {
    useCases: ["ADVENTURE"],
    tagline: "Middleweight GS for long-haul tarmac and graded fire trails.",
  },
  "bmw-r1250-gs-trophy-2023": {
    useCases: ["ADVENTURE"],
    tagline: "The benchmark big-bore adventure tourer.",
  },
  "bmw-r1300-gs-trophy-2024": {
    useCases: ["ADVENTURE"],
    tagline: "The latest GS — lighter, faster, smarter than ever.",
  },
  "cfmoto-800mt-2023": {
    useCases: ["ADVENTURE"],
    tagline: "Parallel-twin adventure bike built for big miles.",
  },
  "honda-cb500x-2023": {
    useCases: ["ADVENTURE", "LEARNER_APPROVED"],
    tagline: "LAMS-approved adventure styling with beginner-friendly manners.",
  },
  "kawasaki-klr-650-adventure-2026": {
    useCases: ["ADVENTURE"],
    tagline: "Proven single-cylinder adventure workhorse.",
  },
  "ktm-390-adventure-2024": {
    useCases: ["ADVENTURE", "LEARNER_APPROVED"],
    tagline: "Light, nimble ADV that won't intimidate new riders.",
  },
  "royal-enfield-himalayan-450-2022": {
    useCases: ["ADVENTURE", "LEARNER_APPROVED"],
    tagline: "Go-anywhere character bike — from the city to the Himalayas.",
  },
  "yamaha-tenere-700-2022": {
    useCases: ["ADVENTURE"],
    tagline: "Pure rally-inspired adventure, ready for whatever's next.",
  },
  "yamaha-wr450-2015": {
    useCases: ["ADVENTURE"],
    tagline: "Enduro-bred single — trail-focused and endlessly capable.",
  },
  "yamaha-wr450f-2015": {
    useCases: ["ADVENTURE"],
    tagline: "Race-derived off-road weapon.",
  },

  // Sport & Cruiser
  "ducati-monster-659-2021": {
    useCases: ["SPORT_CRUISER", "LEARNER_APPROVED"],
    tagline: "Italian naked sport with LAMS manners.",
  },
  "ducati-monster-937-2022": {
    useCases: ["SPORT_CRUISER"],
    tagline: "Full-power Monster — sharp, raw, unmistakable.",
  },
  "harley-davidson-sportster-s-2023": {
    useCases: ["SPORT_CRUISER"],
    tagline: "Modern Harley performance cruiser.",
  },
  "harley-davidson-xl883l-2010": {
    useCases: ["SPORT_CRUISER", "LEARNER_APPROVED"],
    tagline: "LAMS-friendly Sportster — classic American cruiser character.",
  },
  "honda-cb1000r-2008": {
    useCases: ["SPORT_CRUISER"],
    tagline: "Big-displacement naked sport.",
  },
  "honda-cbr1000rr-fireblade-repsol-edition-2004": {
    useCases: ["SPORT_CRUISER"],
    tagline: "Iconic Repsol-livery Fireblade — full-power supersport.",
  },
  "honda-cbr300r-2014": {
    useCases: ["SPORT_CRUISER", "LEARNER_APPROVED", "PRACTICE"],
    tagline: "LAMS supersport — perfect first sportbike.",
  },
  "honda-cbr300r-2023": {
    useCases: ["SPORT_CRUISER", "LEARNER_APPROVED", "PRACTICE"],
    tagline: "Friendly LAMS supersport — ideal for new riders.",
  },
  "honda-cbr500r-2023": {
    useCases: ["SPORT_CRUISER", "LEARNER_APPROVED"],
    tagline: "Mid-weight LAMS sport tourer.",
  },
  "kawasaki-ninja-650-2024": {
    useCases: ["SPORT_CRUISER", "LEARNER_APPROVED"],
    tagline: "Parallel-twin Ninja — the benchmark LAMS sport bike.",
  },
  "kawasaki-vulcan-s-2021": {
    useCases: ["SPORT_CRUISER", "LEARNER_APPROVED"],
    tagline: "LAMS cruiser with adjustable ergonomics.",
  },
  "ktm-rc-390-2024": {
    useCases: ["SPORT_CRUISER", "LEARNER_APPROVED"],
    tagline: "Track-inspired LAMS supersport.",
  },
  "suzuki-gsx250r-2024": {
    useCases: ["SPORT_CRUISER", "LEARNER_APPROVED", "PRACTICE"],
    tagline: "Gentle, flickable LAMS supersport — brilliant to learn on.",
  },
  "triumph-trident-660-2023": {
    useCases: ["SPORT_CRUISER", "LEARNER_APPROVED"],
    tagline: "British triple naked — smooth, characterful LAMS performance.",
  },
  "yamaha-r15m-2025": {
    useCases: ["SPORT_CRUISER", "LEARNER_APPROVED", "PRACTICE"],
    tagline: "Racing-styled LAMS supersport.",
  },
  "yamaha-r3-2021": {
    useCases: ["SPORT_CRUISER", "LEARNER_APPROVED", "PRACTICE"],
    tagline: "Twin-cylinder LAMS supersport.",
  },
  "yamaha-r7-2023": {
    useCases: ["SPORT_CRUISER", "LEARNER_APPROVED"],
    tagline: "Middleweight LAMS supersport with R-series DNA.",
  },
  "yamaha-mt03-2023": {
    useCases: ["COMMUTING", "LEARNER_APPROVED", "PRACTICE"],
    tagline: "LAMS hyper-naked — easy to live with, fun everywhere.",
  },
  "yamaha-mt07-2022": {
    useCases: ["SPORT_CRUISER", "LEARNER_APPROVED"],
    tagline: "LAMS MT-07 — torquey parallel-twin hyper-naked.",
  },
  "yamaha-mt07-2023": {
    useCases: ["SPORT_CRUISER", "LEARNER_APPROVED"],
    tagline: "The benchmark LAMS naked.",
  },
  "yamaha-mt09-2019": {
    useCases: ["SPORT_CRUISER"],
    tagline: "Full-power triple hyper-naked.",
  },
  "yamaha-mt09-2023": {
    useCases: ["SPORT_CRUISER"],
    tagline: "Latest-generation MT-09 — sharper than ever.",
  },

  // Commuting
  "bmw-g310r-2025": {
    useCases: ["COMMUTING", "LEARNER_APPROVED", "PRACTICE"],
    tagline: "BMW's entry-point naked — sharp city manners, LAMS friendly.",
  },
  "cfmoto-150nk-2020": {
    useCases: ["COMMUTING", "LEARNER_APPROVED", "PRACTICE"],
    tagline: "Light, nimble LAMS naked for the urban commute.",
  },
  "cfmoto-300cl-x-2023": {
    useCases: ["COMMUTING", "LEARNER_APPROVED"],
    tagline: "Retro-styled LAMS naked with modern manners.",
  },
  "cfmoto-450nk-2024": {
    useCases: ["COMMUTING", "LEARNER_APPROVED"],
    tagline: "Mid-weight LAMS naked — punchy twin, comfortable ergos.",
  },
  "cfmoto-700cl-x-sport-2022": {
    useCases: ["COMMUTING"],
    tagline: "Full-power retro-styled naked.",
  },
  "honda-cb125e-2023": {
    useCases: ["COMMUTING", "LEARNER_APPROVED", "PRACTICE"],
    tagline: "Honda's bulletproof 125 commuter — perfect for first-time riders.",
  },
  "honda-cb125f-2022": {
    useCases: ["COMMUTING", "LEARNER_APPROVED", "PRACTICE"],
    tagline: "Fuel-efficient 125 — the classic learner commuter.",
  },
  "honda-cb300r-2023": {
    useCases: ["COMMUTING", "LEARNER_APPROVED", "PRACTICE"],
    tagline: "Neo-retro LAMS naked with sharp urban manners.",
  },
  "honda-cb500f-2023": {
    useCases: ["COMMUTING", "LEARNER_APPROVED"],
    tagline: "Mid-weight LAMS naked — smooth twin, all-day comfort.",
  },
  "honda-sh150-2023": {
    useCases: ["COMMUTING", "DELIVERY", "LEARNER_APPROVED"],
    tagline: "Large-wheel scooter — effortless city transport.",
  },
  "ktm-duke-200-2022": {
    useCases: ["COMMUTING", "LEARNER_APPROVED", "PRACTICE"],
    tagline: "Light, aggressive LAMS naked with KTM sharpness.",
  },
  "ktm-duke-200-2023": {
    useCases: ["COMMUTING", "LEARNER_APPROVED", "PRACTICE"],
    tagline: "Scalpel-sharp LAMS naked for the city.",
  },
  "ktm-duke-390-2022": {
    useCases: ["COMMUTING", "LEARNER_APPROVED"],
    tagline: "Single-cylinder LAMS naked — punchy and agile.",
  },
  "ktm-duke-390-2023": {
    useCases: ["COMMUTING", "LEARNER_APPROVED"],
    tagline: "The latest Duke 390 — even sharper than before.",
  },
  "yamaha-nmax155-2023": {
    useCases: ["COMMUTING", "DELIVERY", "LEARNER_APPROVED"],
    tagline: "Refined 155cc commuter scooter with smart-key convenience.",
  },
  "yamaha-xmax300-2022": {
    useCases: ["COMMUTING", "LEARNER_APPROVED"],
    tagline: "Maxi-scooter comfort with LAMS-approved performance.",
  },
  "yamaha-y-dlight-2023": {
    useCases: ["COMMUTING", "DELIVERY", "LEARNER_APPROVED"],
    tagline: "Lightweight commuter scooter — fuel-efficient city runabout.",
  },

  // Delivery
  "honda-nsc110-dio-2022": {
    useCases: ["DELIVERY", "COMMUTING", "LEARNER_APPROVED"],
    tagline: "The workhorse 110 — the backbone of Australian food delivery.",
  },
  "honda-nsc110-dio-2023": {
    useCases: ["DELIVERY", "COMMUTING", "LEARNER_APPROVED"],
    tagline: "Our highest-volume fleet scooter — bulletproof and cheap to run.",
  },
  "ford-transit-connect-2024": {
    useCases: ["DELIVERY"],
    tagline: "Compact panel van for metro deliveries.",
  },
  "renault-master-2017": {
    useCases: ["DELIVERY"],
    tagline: "Large-capacity panel van for heavy-duty delivery work.",
  },
};

/**
 * Heuristic fallback for any model not in the explicit map.
 * Uses category + make/model patterns to guess a sensible default.
 */
function fallback(model: {
  slug: string;
  make: string;
  model: string;
  category: { slug: string; licenceRequired: string } | null;
}): Tagging {
  const lams = model.category?.licenceRequired === "RE";
  const utility = model.category?.slug === "utility-vehicle";
  const haystack = `${model.make} ${model.model}`.toLowerCase();

  if (utility) return { useCases: ["DELIVERY"] };

  if (/adventure|tenere|gs\b|himalayan|klr|africa twin/.test(haystack)) {
    return { useCases: lams ? ["ADVENTURE", "LEARNER_APPROVED"] : ["ADVENTURE"] };
  }
  if (/ninja|cbr|gsx\-?r|r1|r3|r6|r7|r15|rc\s*390|mt-?09|mt-?07|mt-?03|monster|panigale|sportster|vulcan|trident/.test(haystack)) {
    return { useCases: lams ? ["SPORT_CRUISER", "LEARNER_APPROVED"] : ["SPORT_CRUISER"] };
  }
  if (/dio|nmax|pcx|xmax|d\-?light|sh\d|primavera|liberty|vino|fiddle|agility/.test(haystack)) {
    return { useCases: lams ? ["COMMUTING", "DELIVERY", "LEARNER_APPROVED"] : ["COMMUTING", "DELIVERY"] };
  }
  return { useCases: lams ? ["COMMUTING", "LEARNER_APPROVED"] : ["COMMUTING"] };
}

async function main() {
  const models = await prisma.vehicleModel.findMany({
    select: {
      id: true,
      slug: true,
      make: true,
      model: true,
      tagline: true,
      category: { select: { slug: true, licenceRequired: true } },
    },
  });

  let updated = 0;
  for (const m of models) {
    const explicit = TAG_BY_SLUG[m.slug];
    const tagging = explicit ?? fallback(m);
    const { useCases, bikeTypes, riderLevels } = normalizeTags(tagging.useCases);
    await prisma.vehicleModel.update({
      where: { id: m.id },
      data: {
        useCases: { set: useCases },
        bikeTypes: { set: bikeTypes },
        riderLevels: { set: riderLevels },
        ...(tagging.tagline && !m.tagline ? { tagline: tagging.tagline } : {}),
      },
    });
    updated++;
  }
  console.log(`Tagged ${updated} VehicleModel rows.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
