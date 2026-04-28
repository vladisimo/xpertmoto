import * as cheerio from "cheerio";
import type { SpecFields } from "./types";

/**
 * Generic spec-table parser reused across every manufacturer recipe. Spec
 * sheets are universally rendered as either `<table><tr><th>..<td>..` or
 * `<dl><dt>..<dd>..` — we collect every pair into a normalised
 * label → value map and pick off the known spec fields.
 */
export function parseSpecTable(html: string): SpecFields {
  const $ = cheerio.load(html);
  const pairs = new Map<string, string>();

  $("table tr").each((_, tr) => {
    const cells = $(tr).find("th,td");
    if (cells.length < 2) return;
    const label = normaliseLabel($(cells[0]!).text());
    const value = $(cells[1]!).text().trim();
    if (label && value) pairs.set(label, value);
  });

  $("dl").each((_, dl) => {
    const dts = $(dl).find("dt");
    const dds = $(dl).find("dd");
    const n = Math.min(dts.length, dds.length);
    for (let i = 0; i < n; i++) {
      const label = normaliseLabel($(dts[i]!).text());
      const value = $(dds[i]!).text().trim();
      if (label && value) pairs.set(label, value);
    }
  });

  // Some sites use a `div.spec-row > .label + .value` pattern instead.
  $(".spec-row, .specification, .spec, li.spec").each((_, el) => {
    const label = normaliseLabel($(el).find(".label, .spec-label, dt, strong").first().text());
    const value = $(el).find(".value, .spec-value, dd, span").last().text().trim();
    if (label && value && !pairs.has(label)) pairs.set(label, value);
  });

  const fields: SpecFields = {};
  const cc = pickNumeric(pairs, ["engine displacement", "displacement", "engine capacity", "engine", "cubic capacity"]);
  if (cc !== undefined) fields.engineCapacityCc = Math.round(cc);

  const powerKw = pickNumeric(pairs, ["maximum power", "max power", "power", "rated power"], "kw");
  if (powerKw !== undefined) fields.enginePowerKw = round2(powerKw);

  const torque = pickNumeric(pairs, ["maximum torque", "max torque", "torque"], "nm");
  if (torque !== undefined) fields.engineTorqueNm = round2(torque);

  const dryKg = pickNumeric(pairs, ["dry weight", "kerb weight", "kerb mass", "wet weight", "weight (kerb)"], "kg");
  if (dryKg !== undefined) fields.dryWeightKg = round2(dryKg);

  const tank = pickNumeric(pairs, ["fuel tank capacity", "fuel tank", "fuel capacity"], "l");
  if (tank !== undefined) fields.fuelTankLitres = round2(tank);

  const seat = pickNumeric(pairs, ["seat height"], "mm");
  if (seat !== undefined) fields.seatHeightMm = Math.round(seat);

  const topSpeed = pickNumeric(pairs, ["top speed", "maximum speed", "max speed"], "km/h");
  if (topSpeed !== undefined) fields.topSpeedKmh = Math.round(topSpeed);

  const tyreFront = pairs.get("front tyre") ?? pairs.get("front tire") ?? pairs.get("tyres front");
  if (tyreFront) fields.tyreFront = tyreFront;
  const tyreRear = pairs.get("rear tyre") ?? pairs.get("rear tire") ?? pairs.get("tyres rear");
  if (tyreRear) fields.tyreRear = tyreRear;

  const fuelType = pairs.get("fuel type") ?? pairs.get("fuel");
  if (fuelType) fields.fuelType = fuelType;

  return fields;
}

function normaliseLabel(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/[:*]+$/, "")
    .trim();
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function pickNumeric(
  pairs: Map<string, string>,
  labels: string[],
  unitHint?: string,
): number | undefined {
  for (const label of labels) {
    const v = pairs.get(label);
    if (!v) continue;
    const unitOk = !unitHint || v.toLowerCase().includes(unitHint);
    if (!unitOk) continue;
    const m = v.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
    if (m) return Number(m[0]);
  }
  return undefined;
}

/**
 * Absolutise a relative URL against a base. No-op when already absolute.
 */
export function absolutiseUrl(href: string, base: string): string {
  if (href.startsWith("http://") || href.startsWith("https://")) return href;
  if (href.startsWith("//")) return `https:${href}`;
  const b = base.replace(/\/$/, "");
  if (href.startsWith("/")) return `${b}${href}`;
  return `${b}/${href}`;
}

/**
 * Pull all anchors whose href matches the given predicate. Used by
 * manufacturer recipes to scrape manual-index pages for PDFs matching
 * a model token.
 */
export function findMatchingPdfLinks(
  html: string,
  predicate: (href: string, text: string) => boolean,
  base: string,
): Array<{ href: string; title: string; year?: number }> {
  const $ = cheerio.load(html);
  const hits: Array<{ href: string; title: string; year?: number }> = [];
  $("a[href]").each((_, a) => {
    const href = $(a).attr("href") ?? "";
    const text = $(a).text().trim();
    if (!href || !predicate(href, text)) return;
    const title = text || href.split("/").pop() || "Manual";
    const yearMatch = title.match(/\b(20\d{2})\b/) ?? href.match(/\b(20\d{2})\b/);
    hits.push({
      href: absolutiseUrl(href, base),
      title: title.replace(/\s+/g, " "),
      year: yearMatch ? Number(yearMatch[1]) : undefined,
    });
  });
  return hits;
}

export function yearDistance(a: number | undefined, target: number): number {
  if (a === undefined) return 1000;
  return Math.abs(a - target);
}
