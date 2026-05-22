#!/usr/bin/env tsx
/**
 * Scrape every bike + rate parameters from the live xpertmoto.com.au
 * marketing site (Shopify) and write to xpertmoto-fleet.xlsx at repo root.
 *
 * One-shot data export. Run with: `npm run scrape:xpertmoto`
 * Or directly:                    `npx tsx scripts/scrape-xpertmoto.ts`
 */

import ExcelJS from "exceljs";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ORIGIN = "https://xpertmoto.com.au";
const INDEX_URL = `${ORIGIN}/pages/all-rental-scooters-motorcycles`;
const OUTPUT_XLSX = resolve(process.cwd(), "xpertmoto-fleet.xlsx");
const OUTPUT_JSON = resolve(process.cwd(), "xpertmoto-fleet.debug.json");
const CONCURRENCY = 5;
const FETCH_TIMEOUT_MS = 20_000;

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

type BikeRow = {
  make: string;
  model: string;
  headlinePrice: number | null;
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

// All 11 brands seen on the live site. Order matters: multi-word brands
// MUST come first so the slug split doesn't grab just "royal" or "harley".
const KNOWN_MAKES = [
  "royal-enfield",
  "harley-davidson",
  "honda",
  "yamaha",
  "bmw",
  "ktm",
  "kawasaki",
  "ducati",
  "cfmoto",
  "suzuki",
  "triumph",
] as const;

function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .map((w) => (w.length <= 3 ? w.toUpperCase() : (w[0] ?? "").toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ");
}

function makeModelFromSlug(path: string): { make: string; model: string } {
  // path like "/products/royal-enfield-himalayan-450-rental"
  const slug = path.replace(/^\/products\//, "").replace(/-rental$/, "");
  for (const make of KNOWN_MAKES) {
    if (slug === make || slug.startsWith(`${make}-`)) {
      const modelSlug = slug.slice(make.length).replace(/^-+/, "");
      const makePretty = make
        .split("-")
        .filter((p) => p.length > 0)
        .map((p) => (p === "bmw" || p === "ktm" || p === "cfmoto" ? p.toUpperCase() : (p[0] ?? "").toUpperCase() + p.slice(1)))
        .join(" ");
      // Model: keep alphanumeric tokens but uppercase short ones (R7, MT09, NSC110).
      const model = modelSlug
        .split("-")
        .filter((tok) => tok.length > 0)
        .map((tok) => {
          // All digits → keep as is (e.g. "450", "750").
          if (/^\d+$/.test(tok)) return tok;
          // Letters AND digits → model code, fully uppercase (CBR500R, R1250GS, NMAX155).
          if (/[a-z]/i.test(tok) && /\d/.test(tok)) return tok.toUpperCase();
          // Short all-letters token → likely an acronym (GS, MT, RC, ES, KLR).
          if (tok.length <= 3) return tok.toUpperCase();
          // Otherwise Title Case (Trophy, Himalayan, Africa, Twin, Adventure).
          return (tok[0] ?? "").toUpperCase() + tok.slice(1);
        })
        .join(" ");
      return { make: makePretty, model: titleCase(makePretty) === makePretty ? model : model };
    }
  }
  return { make: "", model: slug.replace(/-/g, " ") };
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&ndash;|&#8211;/gi, "-")
    .replace(/&mdash;|&#8212;/gi, "-");
}

function stripTags(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  ).replace(/\s+/g, " ").trim();
}

function extractIndexProducts(html: string): { path: string; headlinePrice: number | null }[] {
  // Pull anchors that point to /products/<slug>-rental and their nearby price text.
  const out = new Map<string, number | null>();

  // First pass: collect all unique product paths.
  for (const m of html.matchAll(/\/products\/[a-z0-9][a-z0-9-]*-rental/gi)) {
    const path = m[0];
    if (!out.has(path)) out.set(path, null);
  }

  // Second pass: try to associate a headline price with each product card.
  // Shopify cards typically embed price as "$NNN.NN" or with cents.
  const cards = html.split(/\/products\//i);
  for (let i = 1; i < cards.length; i++) {
    const card = cards[i];
    if (!card) continue;
    const slugMatch = card.match(/^([a-z0-9][a-z0-9-]*-rental)/i);
    if (!slugMatch?.[1]) continue;
    const path = `/products/${slugMatch[1]}`;
    if (out.get(path) != null) continue;
    // Look ahead ~2KB for the first "$NNN" amount.
    const window = card.slice(0, 2000);
    const priceMatch = window.match(/\$\s*(\d{2,4})(?:\.\d{2})?/);
    if (priceMatch?.[1]) out.set(path, Number(priceMatch[1]));
  }

  return [...out.entries()].map(([path, headlinePrice]) => ({ path, headlinePrice }));
}

function parseAmount(text: string, re: RegExp): number | null {
  const m = text.match(re);
  if (!m?.[1]) return null;
  // Handle "$1,197" → 1197.
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

type Rates = Pick<
  BikeRow,
  "baseRate" | "baseHours" | "week1" | "week2" | "week3" | "week4_12" | "week12p" | "depositPct" | "deliveryAud"
>;

function extractRates(bodyText: string): Rates {
  // Rate card text — actual on-page samples:
  //   "Rent 24 hours: $110" | "Rent 48 hours: $500"
  //   "Rent 1 week: $168" | "Rent 1 week: $1,197"
  //   "Rent 2 weeks: $152 per week"
  //   "Rent 4 to 12 weeks: $136 per week"
  //   "Rent 12+ weeks: $110 per week"
  //   "paying just 30% of the total rental cost upfront"
  //   "deliver anywhere in Sydney for just $149"
  const t = bodyText;

  // Try 24h first, fall back to 48h. Track which one matched.
  let baseRate = parseAmount(t, /\b24\s*hour[s]?\b[^$0-9]{0,40}\$\s*([\d,]+)/i);
  let baseHours: 24 | 48 | null = baseRate != null ? 24 : null;
  if (baseRate == null) {
    baseRate = parseAmount(t, /\b48\s*hour[s]?\b[^$0-9]{0,40}\$\s*([\d,]+)/i);
    baseHours = baseRate != null ? 48 : null;
  }

  return {
    baseRate,
    baseHours,
    week1: parseAmount(t, /\b1\s*week\b[^$0-9]{0,40}\$\s*([\d,]+)/i),
    week2: parseAmount(t, /\b2\s*weeks?\b[^$0-9]{0,40}\$\s*([\d,]+)/i),
    week3: parseAmount(t, /\b3\s*weeks?\b[^$0-9]{0,40}\$\s*([\d,]+)/i),
    // "4-12 weeks" or "4 to 12 weeks"
    week4_12: parseAmount(t, /\b4\s*(?:-|–|to)\s*12\s*weeks?\b[^$0-9]{0,40}\$\s*([\d,]+)/i),
    // Require literal "+" to disambiguate from "to 12 weeks".
    week12p: parseAmount(t, /\b12\s*\+\s*weeks?\b[^$0-9]{0,40}\$\s*([\d,]+)/i),
    // Deposit: "30% of the total rental" or "30% deposit" or "30% upfront"
    depositPct: parseAmount(
      t,
      /(\d{1,2})\s*%\s*(?:of\s+the\s+total|deposit|upfront|down|to\s+secure)/i,
    ),
    // Delivery: either "$NNN ... Sydney" or "Sydney ... $NNN"
    deliveryAud:
      parseAmount(t, /Sydney[^$0-9]{0,60}\$\s*([\d,]+)/i) ??
      parseAmount(t, /\$\s*([\d,]+)[^$0-9]{0,40}(?:anywhere\s+in\s+)?Sydney/i),
  };
}

async function scrapeBike(path: string, headlinePrice: number | null): Promise<BikeRow> {
  const url = `${ORIGIN}${path}`;
  const html = await fetchText(url);
  const { make, model } = makeModelFromSlug(path);
  const bodyText = stripTags(html);
  const rates = extractRates(bodyText);
  // If the body didn't yield a base rate, fall back to the index card price
  // and label it 24h (Shopify card price is the daily rate by convention).
  const baseRate = rates.baseRate ?? headlinePrice;
  const baseHours: 24 | 48 | null = rates.baseHours ?? (headlinePrice != null ? 24 : null);
  return {
    make,
    model,
    headlinePrice,
    ...rates,
    baseRate,
    baseHours,
    url,
  };
}

async function mapLimited<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, idx: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      const item = items[idx];
      if (item === undefined) return;
      results[idx] = await fn(item, idx);
    }
  });
  await Promise.all(workers);
  return results;
}

async function main() {
  console.log(`Fetching index ${INDEX_URL}`);
  const indexHtml = await fetchText(INDEX_URL);
  const products = extractIndexProducts(indexHtml);
  console.log(`Discovered ${products.length} product URLs`);
  if (products.length === 0) {
    throw new Error("No products discovered on index page — markup may have changed.");
  }

  const rows = await mapLimited(products, CONCURRENCY, async (p, i) => {
    try {
      const row = await scrapeBike(p.path, p.headlinePrice);
      console.log(
        `  [${String(i + 1).padStart(2)}/${products.length}] ${row.make} ${row.model} → $${row.baseRate ?? "?"}/${row.baseHours ?? "?"}h`,
      );
      return row;
    } catch (err) {
      console.error(`  [${i + 1}] FAILED ${p.path}:`, (err as Error).message);
      const fallback = makeModelFromSlug(p.path);
      return {
        make: fallback.make,
        model: fallback.model,
        headlinePrice: p.headlinePrice,
        baseRate: p.headlinePrice,
        baseHours: p.headlinePrice != null ? 24 : null,
        week1: null,
        week2: null,
        week3: null,
        week4_12: null,
        week12p: null,
        depositPct: null,
        deliveryAud: null,
        url: `${ORIGIN}${p.path}`,
      } satisfies BikeRow;
    }
  });

  // Sort by make then model for a tidy sheet.
  rows.sort((a, b) => (a.make + a.model).localeCompare(b.make + b.model));

  // Debug JSON (gitignored alongside the xlsx) — useful when a row looks wrong.
  writeFileSync(OUTPUT_JSON, JSON.stringify(rows, null, 2));

  const wb = new ExcelJS.Workbook();
  wb.creator = "scripts/scrape-xpertmoto.ts";
  wb.created = new Date();
  const ws = wb.addWorksheet("Fleet");
  ws.columns = [
    { header: "Make", key: "make", width: 18 },
    { header: "Model", key: "model", width: 36 },
    { header: "Base rate ($)", key: "baseRate", width: 13 },
    { header: "Base period (hrs)", key: "baseHours", width: 16 },
    { header: "1wk ($)", key: "week1", width: 10 },
    { header: "2wk ($/wk)", key: "week2", width: 12 },
    { header: "3wk ($/wk)", key: "week3", width: 12 },
    { header: "4-12wk ($/wk)", key: "week4_12", width: 14 },
    { header: "12wk+ ($/wk)", key: "week12p", width: 13 },
    { header: "Deposit %", key: "depositPct", width: 11 },
    { header: "Sydney delivery ($)", key: "deliveryAud", width: 18 },
    { header: "Product URL", key: "url", width: 70 },
  ];
  ws.addRows(rows);
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).alignment = { vertical: "middle", horizontal: "center" };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  for (const colKey of ["baseRate", "week1", "week2", "week3", "week4_12", "week12p", "deliveryAud"]) {
    const col = ws.getColumn(colKey);
    col.numFmt = '"$"#,##0';
    col.alignment = { horizontal: "right" };
  }
  ws.getColumn("depositPct").numFmt = '0"%"';
  ws.getColumn("depositPct").alignment = { horizontal: "right" };

  await wb.xlsx.writeFile(OUTPUT_XLSX);

  // Summary
  const populated = (k: keyof BikeRow) => rows.filter((r) => r[k] != null).length;
  console.log("");
  console.log(`Wrote ${rows.length} rows to ${OUTPUT_XLSX}`);
  console.log(`Debug JSON at ${OUTPUT_JSON}`);
  console.log(
    `Coverage: base=${populated("baseRate")} 1wk=${populated("week1")} 2wk=${populated("week2")} 3wk=${populated("week3")} 4-12wk=${populated("week4_12")} 12wk+=${populated("week12p")} deposit=${populated("depositPct")} delivery=${populated("deliveryAud")}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
