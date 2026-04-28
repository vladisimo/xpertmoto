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

/**
 * Piaggio Group recipe — covers Vespa and Piaggio models. Both marques are
 * made by Piaggio & C. SpA and share the `manuals.vespa.com` portal for
 * owner's manuals (despite the domain name, it hosts Piaggio-branded
 * scooters too).
 */

type BrandConfig = {
  base: string;
  specsPath: (model: string) => string;
  sourceName: string;
};

const BRAND_MAP: Record<string, BrandConfig> = {
  vespa: {
    base: "https://www.vespa.com",
    specsPath: (model) => `/en_AU/${slugify(model)}/technical-specs.html`,
    sourceName: "Vespa (Piaggio Group)",
  },
  piaggio: {
    base: "https://www.piaggio.com",
    specsPath: (model) => `/en_AU/models/${slugify(model)}/`,
    sourceName: "Piaggio",
  },
};

const MANUALS_INDEX = "https://manuals.vespa.com/";

function slugify(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "-");
}

const piaggioFetch = (url: string): Promise<Response> =>
  fetch(url, {
    headers: {
      "User-Agent": "ScooteringFleetEnricher/1.0 (+https://scootering.com.au)",
      Accept: "text/html,application/xhtml+xml,application/pdf",
    },
  });

function brandFor(make: string): BrandConfig | null {
  return BRAND_MAP[make.toLowerCase()] ?? null;
}

export const piaggioRecipe: SourceRecipe = {
  name: "Piaggio Group",

  async fetchSpecs(input: VehicleModelSeed): Promise<SpecResult | null> {
    const brand = brandFor(input.make);
    if (!brand) return null;

    const url = brand.base + brand.specsPath(input.model);
    const res = await piaggioFetch(url);
    if (!res.ok) return null;
    const html = await res.text();
    const fields = parseSpecTable(html);
    if (Object.keys(fields).length === 0) return null;

    return {
      fields,
      sourceUrl: url,
      sourceName: brand.sourceName,
      confidence: "OFFICIAL_MANUFACTURER",
    };
  },

  async listDocuments(input: VehicleModelSeed): Promise<DocumentCandidate[]> {
    const res = await piaggioFetch(MANUALS_INDEX);
    if (!res.ok) return [];
    const html = await res.text();

    const token = input.model.toLowerCase();
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
