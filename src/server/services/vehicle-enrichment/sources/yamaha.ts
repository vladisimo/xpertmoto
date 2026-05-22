import {
  absolutiseUrl,
  findMatchingPdfLinks,
  parseSpecTable,
  yearDistance,
} from "../parser";
import type {
  DocumentCandidate,
  SourceRecipe,
  SpecResult,
  VehicleModelSeed,
} from "../types";

const AU_BASE = "https://www.yamaha-motor.com.au";
/**
 * Yamaha Europe hosts the canonical owner's-manual PDFs — the AU site
 * links back to the same CDN. Safe as a Tier-A source because it's the
 * manufacturer-operated CDN, not a third-party mirror.
 */
const MANUALS_INDEX = "https://www.yamaha-motor.eu/en/owners/owner-s-manuals";

type ModelConfig = { path: string; manualToken: string };

const MODEL_MAP: Record<string, ModelConfig> = {
  // Scooters
  NMAX: { path: "/products/scooters/urban-mobility/nmax-125", manualToken: "nmax" },
  NMAX155: { path: "/products/scooters/urban-mobility/nmax-155", manualToken: "nmax" },
  XMAX: { path: "/products/scooters/sport/xmax", manualToken: "xmax" },
  XMAX300: { path: "/products/scooters/sport/xmax-300", manualToken: "xmax" },
  VINO: { path: "/products/scooters/urban-mobility/vino", manualToken: "vino" },
  "Y-DLIGHT": { path: "/products/scooters/urban-mobility/y-dlight", manualToken: "dlight" },
  // Hyper-naked / sport
  MT03: { path: "/products/motorcycles/hyper-naked/mt-03", manualToken: "mt-03" },
  MT07: { path: "/products/motorcycles/hyper-naked/mt-07", manualToken: "mt-07" },
  MT09: { path: "/products/motorcycles/hyper-naked/mt-09", manualToken: "mt-09" },
  R3: { path: "/products/motorcycles/supersport/yzf-r3", manualToken: "yzf-r3" },
  R7: { path: "/products/motorcycles/supersport/yzf-r7", manualToken: "yzf-r7" },
  R15M: { path: "/products/motorcycles/supersport/yzf-r15m", manualToken: "r15" },
  // Adventure
  "TENERE 700": { path: "/products/motorcycles/adventure/tenere-700", manualToken: "tenere" },
  // Enduro
  WR450F: { path: "/products/motorcycles/enduro/wr450f", manualToken: "wr450" },
  WR450: { path: "/products/motorcycles/enduro/wr450f", manualToken: "wr450" },
};

const yamahaFetch = (url: string): Promise<Response> =>
  fetch(url, {
    headers: {
      "User-Agent": "XpertMotoFleetEnricher/1.0 (+https://xpertmoto.com.au)",
      Accept: "text/html,application/xhtml+xml,application/pdf",
    },
  });

function configFor(model: string): ModelConfig | null {
  return MODEL_MAP[model.toUpperCase()] ?? null;
}

export const yamahaRecipe: SourceRecipe = {
  name: "Yamaha Motor Australia",

  async fetchSpecs(input: VehicleModelSeed): Promise<SpecResult | null> {
    const cfg = configFor(input.model);
    if (!cfg) return null;

    const url = `${AU_BASE}${cfg.path}`;
    const res = await yamahaFetch(url);
    if (!res.ok) return null;
    const html = await res.text();
    const fields = parseSpecTable(html);
    if (Object.keys(fields).length === 0) return null;

    return {
      fields,
      sourceUrl: url,
      sourceName: "Yamaha Motor Australia",
      confidence: "OFFICIAL_MANUFACTURER",
    };
  },

  async listDocuments(input: VehicleModelSeed): Promise<DocumentCandidate[]> {
    const cfg = configFor(input.model);
    if (!cfg) return [];

    const res = await yamahaFetch(MANUALS_INDEX);
    if (!res.ok) return [];
    const html = await res.text();

    const token = cfg.manualToken.toLowerCase();
    const hits = findMatchingPdfLinks(
      html,
      (href, text) => {
        if (!href.toLowerCase().endsWith(".pdf")) return false;
        const blob = `${text} ${href}`.toLowerCase();
        return blob.includes(token);
      },
      MANUALS_INDEX,
    );

    hits.sort(
      (a, b) => yearDistance(a.year, input.year) - yearDistance(b.year, input.year),
    );

    return hits.map((h) => ({
      type: "OWNERS_MANUAL" as const,
      title: h.title,
      sourceUrl: absolutiseUrl(h.href, MANUALS_INDEX),
      language: "en",
    }));
  },
};
