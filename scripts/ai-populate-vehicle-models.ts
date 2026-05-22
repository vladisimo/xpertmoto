#!/usr/bin/env tsx
/**
 * One-shot: use the configured LLM (via OpenRouter) to populate specs for
 * every VehicleModel row that doesn't already have them. Writes with
 * `specsConfidence = REPUTABLE_SECONDARY` because the LLM is a
 * knowledgeable intermediary, not an authoritative manufacturer source —
 * admins can promote to OFFICIAL_MANUFACTURER when they've spot-checked.
 *
 * Run with: `npx tsx scripts/ai-populate-vehicle-models.ts`
 */

import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.resolve(__dirname, "../.env") });

import OpenAI from "openai";
import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

const {
  OPENROUTER_API_KEY,
  OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1",
  OPENROUTER_HTTP_REFERER = "https://xpertmoto.com.au",
  OPENROUTER_APP_TITLE = "XPERT Moto",
} = process.env;

if (!OPENROUTER_API_KEY) {
  console.error("OPENROUTER_API_KEY not set.");
  process.exit(1);
}

const client = new OpenAI({
  apiKey: OPENROUTER_API_KEY,
  baseURL: OPENROUTER_BASE_URL,
  defaultHeaders: {
    "HTTP-Referer": OPENROUTER_HTTP_REFERER,
    "X-Title": OPENROUTER_APP_TITLE,
  },
});

const MODEL = process.env.SUPPORT_AI_MODEL ?? "anthropic/claude-haiku-4.5";
const CONCURRENCY = 5;

// Tool schema (OpenAI format) — the model must call this tool, so we get
// strict JSON back. Every spec field nullable so the LLM can honestly say
// "I don't know the seat height for this 2004 model" instead of guessing.
const tools = [
  {
    type: "function" as const,
    function: {
      name: "record_specifications",
      description:
        "Record the factual manufacturer-published specifications for the given motorcycle/scooter/vehicle model. Return null for any field you are not confident about.",
      parameters: {
        type: "object",
        properties: {
          engineCapacityCc: { type: ["integer", "null"], description: "Engine displacement in cubic centimetres" },
          enginePowerKw: { type: ["number", "null"], description: "Maximum power in kilowatts" },
          engineTorqueNm: { type: ["number", "null"], description: "Maximum torque in newton-metres" },
          dryWeightKg: { type: ["number", "null"], description: "Dry/kerb weight in kilograms" },
          fuelTankLitres: { type: ["number", "null"], description: "Fuel tank capacity in litres" },
          fuelType: { type: ["string", "null"], description: "e.g. Unleaded 91 RON, Diesel, Electric" },
          topSpeedKmh: { type: ["integer", "null"], description: "Top speed in km/h" },
          seatHeightMm: { type: ["integer", "null"], description: "Seat height in millimetres" },
          tyreFront: { type: ["string", "null"], description: "e.g. 110/70-14" },
          tyreRear: { type: ["string", "null"], description: "e.g. 130/70-13" },
          serviceIntervalKm: { type: ["integer", "null"], description: "Service interval in kilometres" },
          serviceIntervalMonths: { type: ["integer", "null"], description: "Service interval in months" },
          confidenceNote: {
            type: "string",
            description: "One short sentence describing any caveats or uncertainty.",
          },
        },
        required: ["confidenceNote"],
      },
    },
  },
];

type SpecsFromAI = {
  engineCapacityCc?: number | null;
  enginePowerKw?: number | null;
  engineTorqueNm?: number | null;
  dryWeightKg?: number | null;
  fuelTankLitres?: number | null;
  fuelType?: string | null;
  topSpeedKmh?: number | null;
  seatHeightMm?: number | null;
  tyreFront?: string | null;
  tyreRear?: string | null;
  serviceIntervalKm?: number | null;
  serviceIntervalMonths?: number | null;
  confidenceNote?: string;
};

async function fetchSpecs(make: string, model: string, year: number): Promise<SpecsFromAI | null> {
  const res = await client.chat.completions.create({
    model: MODEL,
    tools,
    tool_choice: { type: "function", function: { name: "record_specifications" } },
    messages: [
      {
        role: "system",
        content:
          "You are a motorcycle/scooter/vehicle specifications reference. Given a make, model and year, return the manufacturer's published specifications. If you are unsure about any value, return null for that field — do not guess or fabricate. Prefer Australian-market specifications where applicable.",
      },
      {
        role: "user",
        content: `Return the specifications for: ${year} ${make} ${model}`,
      },
    ],
  });

  const choice = res.choices?.[0];
  const call = choice?.message?.tool_calls?.[0];
  if (!call || call.type !== "function") return null;
  try {
    return JSON.parse(call.function.arguments) as SpecsFromAI;
  } catch {
    return null;
  }
}

async function populate(row: {
  id: string;
  make: string;
  model: string;
  year: number;
  engineCapacityCc: number | null;
}) {
  if (row.engineCapacityCc !== null) {
    return { status: "already-populated" as const };
  }

  const specs = await fetchSpecs(row.make, row.model, row.year);
  if (!specs) return { status: "no-response" as const };

  const data: Prisma.VehicleModelUpdateInput = {
    engineCapacityCc: cleanInt(specs.engineCapacityCc),
    enginePowerKw: toDec(specs.enginePowerKw),
    engineTorqueNm: toDec(specs.engineTorqueNm),
    dryWeightKg: toDec(specs.dryWeightKg),
    fuelTankLitres: toDec(specs.fuelTankLitres),
    fuelType: cleanStr(specs.fuelType),
    topSpeedKmh: cleanInt(specs.topSpeedKmh),
    seatHeightMm: cleanInt(specs.seatHeightMm),
    tyreFront: cleanStr(specs.tyreFront),
    tyreRear: cleanStr(specs.tyreRear),
    serviceIntervalKm: cleanInt(specs.serviceIntervalKm),
    serviceIntervalMonths: cleanInt(specs.serviceIntervalMonths),
    specsSourceName: `AI (${MODEL})`,
    specsSourceUrl: null,
    specsFetchedAt: new Date(),
    specsConfidence: "REPUTABLE_SECONDARY",
    lastEnrichmentError: null,
  };

  await prisma.vehicleModel.update({ where: { id: row.id }, data });
  const filled = Object.entries(specs).filter(
    ([k, v]) => k !== "confidenceNote" && v !== null && v !== undefined && v !== "",
  ).length;
  return { status: "populated" as const, filled, note: specs.confidenceNote };
}

function toDec(n: number | null | undefined): Prisma.Decimal | null {
  if (n === null || n === undefined) return null;
  return new Prisma.Decimal(n);
}
function cleanInt(n: number | null | undefined): number | null {
  if (n === null || n === undefined) return null;
  return Math.round(n);
}
function cleanStr(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.trim();
  return t === "" ? null : t;
}

async function main() {
  const rows = await prisma.vehicleModel.findMany({
    orderBy: [{ make: "asc" }, { model: "asc" }, { year: "desc" }],
    select: { id: true, make: true, model: true, year: true, engineCapacityCc: true },
  });

  console.log(`Populating ${rows.length} VehicleModel rows via ${MODEL}…\n`);

  const queue = [...rows];
  let done = 0;
  let populated = 0;
  let skipped = 0;
  let failed = 0;

  async function worker() {
    while (queue.length > 0) {
      const row = queue.shift();
      if (!row) return;
      const prefix = `${row.make} ${row.model} (${row.year})`;
      try {
        const r = await populate(row);
        done++;
        if (r.status === "populated") {
          populated++;
          console.log(`[${done}/${rows.length}] ✓ ${prefix} — ${r.filled} fields · ${r.note ?? ""}`);
        } else if (r.status === "already-populated") {
          skipped++;
          console.log(`[${done}/${rows.length}] · ${prefix} — already populated`);
        } else {
          failed++;
          console.log(`[${done}/${rows.length}] ! ${prefix} — no tool call returned`);
        }
      } catch (err) {
        failed++;
        done++;
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`[${done}/${rows.length}] ! ${prefix} — ${msg}`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  console.log(`\nDone. populated=${populated} skipped=${skipped} failed=${failed}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
