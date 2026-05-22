import {
  absolutiseUrl,
  findMatchingPdfLinks,
  parseSpecTable,
  yearDistance,
} from "../parser";
import type {
  DocumentCandidate,
  SourceRecipe,
  SpecFields,
  SpecResult,
  VehicleModelSeed,
} from "../types";

const BASE = "https://motorcycles.honda.com.au";

/**
 * Honda AU splits its model pages by category segment: scooter, street,
 * sport, adventure. We store the segment per model because it's part of
 * the canonical URL and can't be guessed from the model name alone.
 */
type ModelEntry = { slug: string; segment: "scooter" | "street" | "sport" | "adventure" };

const MODEL_MAP: Record<string, ModelEntry> = {
  // Scooters
  PCX: { slug: "pcx", segment: "scooter" },
  DIO: { slug: "dio", segment: "scooter" },
  "NSC110 DIO": { slug: "dio", segment: "scooter" },
  SH150: { slug: "sh150i", segment: "scooter" },
  // Street / naked
  CB125E: { slug: "cb125e", segment: "street" },
  CB125F: { slug: "cb125f", segment: "street" },
  CB300R: { slug: "cb300r", segment: "street" },
  CB500F: { slug: "cb500f", segment: "street" },
  CB500X: { slug: "cb500x", segment: "adventure" },
  CB1000R: { slug: "cb1000r", segment: "street" },
  // Sport
  CBR300R: { slug: "cbr300r", segment: "sport" },
  CBR500R: { slug: "cbr500r", segment: "sport" },
  "CBR1000RR FIREBLADE REPSOL EDITION": { slug: "cbr1000rr-r-fireblade-sp", segment: "sport" },
};

const MANUAL_INDEX_URL = `${BASE}/en/owners/owners-manuals`;

const hondaFetch = (url: string): Promise<Response> =>
  fetch(url, {
    headers: {
      "User-Agent": "XpertMotoFleetEnricher/1.0 (+https://xpertmoto.com.au)",
      Accept: "text/html,application/xhtml+xml,application/pdf",
    },
  });

function specsUrlFor(model: string): string | null {
  const key = model.toUpperCase();
  const entry = MODEL_MAP[key];
  if (!entry) return null;
  return `${BASE}/models/onroad/${entry.segment}/${entry.slug}/specifications`;
}

export const hondaRecipe: SourceRecipe = {
  name: "Honda Australia",

  async fetchSpecs(input: VehicleModelSeed): Promise<SpecResult | null> {
    const url = specsUrlFor(input.model);
    if (!url) return null;

    const res = await hondaFetch(url);
    if (!res.ok) return null;
    const html = await res.text();
    const fields = parseSpecTable(html);
    if (Object.keys(fields).length === 0) return null;

    return {
      fields,
      sourceUrl: url,
      sourceName: "Honda Australia",
      confidence: "OFFICIAL_MANUFACTURER",
    };
  },

  async listDocuments(input: VehicleModelSeed): Promise<DocumentCandidate[]> {
    const res = await hondaFetch(MANUAL_INDEX_URL);
    if (!res.ok) return [];
    const html = await res.text();
    return parseHondaManualIndex(html, input);
  },
};

export function parseHondaManualIndex(
  html: string,
  input: VehicleModelSeed,
): DocumentCandidate[] {
  // Token used to match the manual — e.g. for "NSC110 Dio", look for "dio".
  // Honda distribution often uses the marketing name (PCX, Dio) over the
  // technical name (NSC110). Strip digits + technical prefixes first.
  const rawModel = input.model.toLowerCase();
  const marketingToken =
    rawModel.split(/\s+/).find((w) => /[a-z]/.test(w) && !/^[a-z]+\d/.test(w)) ?? rawModel;

  const hits = findMatchingPdfLinks(
    html,
    (href, text) => {
      if (!href.toLowerCase().endsWith(".pdf")) return false;
      const blob = `${text} ${href}`.toLowerCase();
      return blob.includes(marketingToken) || blob.includes(rawModel);
    },
    BASE,
  );

  hits.sort((a, b) => yearDistance(a.year, input.year) - yearDistance(b.year, input.year));

  return hits.map((h) => ({
    type: "OWNERS_MANUAL",
    title: h.title,
    sourceUrl: absolutiseUrl(h.href, BASE),
    language: "en-AU",
  }));
}

export { parseSpecTable as parseHondaSpecs };
export type { SpecFields };
