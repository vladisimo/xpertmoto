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

const BASE = "https://www.kymco.com.au";

const MODEL_SLUG: Record<string, string> = {
  AGILITY: "agility",
};

const kymcoFetch = (url: string): Promise<Response> =>
  fetch(url, {
    headers: {
      "User-Agent": "XpertMotoFleetEnricher/1.0 (+https://xpertmoto.com.au)",
      Accept: "text/html,application/xhtml+xml,application/pdf",
    },
  });

function specsUrlFor(model: string): string | null {
  const slug = MODEL_SLUG[model.toUpperCase()];
  if (!slug) return null;
  return `${BASE}/scooter/${slug}/`;
}

export const kymcoRecipe: SourceRecipe = {
  name: "Kymco Australia",

  async fetchSpecs(input: VehicleModelSeed): Promise<SpecResult | null> {
    const url = specsUrlFor(input.model);
    if (!url) return null;

    const res = await kymcoFetch(url);
    if (!res.ok) return null;
    const html = await res.text();
    const fields = parseSpecTable(html);
    if (Object.keys(fields).length === 0) return null;

    return {
      fields,
      sourceUrl: url,
      sourceName: "Kymco Australia",
      confidence: "OFFICIAL_MANUFACTURER",
    };
  },

  async listDocuments(input: VehicleModelSeed): Promise<DocumentCandidate[]> {
    const url = specsUrlFor(input.model);
    if (!url) return [];
    const res = await kymcoFetch(url);
    if (!res.ok) return [];
    const html = await res.text();

    const token = input.model.toLowerCase();
    const hits = findMatchingPdfLinks(
      html,
      (href, text) => {
        if (!href.toLowerCase().endsWith(".pdf")) return false;
        const blob = `${text} ${href}`.toLowerCase();
        return blob.includes(token) || blob.includes("owner") || blob.includes("manual");
      },
      BASE,
    );

    hits.sort(
      (a, b) => yearDistance(a.year, input.year) - yearDistance(b.year, input.year),
    );

    return hits.map((h) => ({
      type: "OWNERS_MANUAL" as const,
      title: h.title,
      sourceUrl: absolutiseUrl(h.href, BASE),
      language: "en-AU",
    }));
  },
};
