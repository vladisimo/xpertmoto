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
 * SYM has two AU distributor sites (symmotorsports.com.au and
 * mojomotorcycles.com.au). We hit Mojo first because it carries the full
 * catalogue and links to PDFs; symmotorsports is used as a fallback.
 */
const PRIMARY_BASE = "https://mojomotorcycles.com.au";
const FALLBACK_BASE = "https://www.symmotorsports.com.au";

const MODEL_SLUG: Record<string, string> = {
  FIDDLE: "fiddle",
};

const symFetch = (url: string): Promise<Response> =>
  fetch(url, {
    headers: {
      "User-Agent": "ScooteringFleetEnricher/1.0 (+https://scootering.com.au)",
      Accept: "text/html,application/xhtml+xml,application/pdf",
    },
  });

function specsUrlFor(model: string): { url: string; base: string } | null {
  const slug = MODEL_SLUG[model.toUpperCase()];
  if (!slug) return null;
  return { url: `${PRIMARY_BASE}/sym/${slug}/`, base: PRIMARY_BASE };
}

export const symRecipe: SourceRecipe = {
  name: "SYM (Mojo Motorcycles)",

  async fetchSpecs(input: VehicleModelSeed): Promise<SpecResult | null> {
    const target = specsUrlFor(input.model);
    if (!target) return null;

    const res = await symFetch(target.url);
    if (!res.ok) {
      // Try fallback distributor site before giving up.
      const fb = await symFetch(`${FALLBACK_BASE}/models/${input.model.toLowerCase()}/`);
      if (!fb.ok) return null;
      const html = await fb.text();
      const fields = parseSpecTable(html);
      if (Object.keys(fields).length === 0) return null;
      return {
        fields,
        sourceUrl: `${FALLBACK_BASE}/models/${input.model.toLowerCase()}/`,
        sourceName: "SYM Australia",
        confidence: "OFFICIAL_MANUFACTURER",
      };
    }

    const html = await res.text();
    const fields = parseSpecTable(html);
    if (Object.keys(fields).length === 0) return null;

    return {
      fields,
      sourceUrl: target.url,
      sourceName: "SYM (Mojo Motorcycles)",
      confidence: "OFFICIAL_MANUFACTURER",
    };
  },

  async listDocuments(input: VehicleModelSeed): Promise<DocumentCandidate[]> {
    const target = specsUrlFor(input.model);
    if (!target) return [];

    const res = await symFetch(target.url);
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
      target.base,
    );

    hits.sort(
      (a, b) => yearDistance(a.year, input.year) - yearDistance(b.year, input.year),
    );

    return hits.map((h) => ({
      type: "OWNERS_MANUAL" as const,
      title: h.title,
      sourceUrl: absolutiseUrl(h.href, target.base),
      language: "en-AU",
    }));
  },
};
