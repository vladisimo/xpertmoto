export { TERMS_V2 } from "./v2";
export type { Terms, TermsSection } from "./v2";

import type { Terms } from "./v2";
import { TERMS_V2 } from "./v2";

export const CURRENT_TERMS = TERMS_V2;

export interface TermsBranding {
  siteName: string;
  legalName: string;
  abn: string;
}

/**
 * Resolve `{{token}}` placeholders in rental-agreement terms text against
 * the deployed customer's branding. Use at render time wherever a Terms
 * object is about to be displayed or passed into a PDF — keeps the static
 * template platform-neutral so the codebase can ship to any customer.
 */
export function interpolateTermsText(text: string, branding: TermsBranding): string {
  const abnClause = branding.abn ? `ABN ${branding.abn}` : "";
  return text.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    switch (key) {
      case "siteName":
        return branding.siteName;
      case "legalName":
        return branding.legalName;
      case "abn":
        return branding.abn;
      case "abnClause":
        return abnClause;
      default:
        return match;
    }
  });
}

export function interpolateTerms(terms: Terms, branding: TermsBranding): Terms {
  return {
    ...terms,
    preamble: terms.preamble.map((p) => interpolateTermsText(p, branding)),
    sections: terms.sections.map((s) => ({
      heading: interpolateTermsText(s.heading, branding),
      paragraphs: s.paragraphs.map((p) => interpolateTermsText(p, branding)),
    })),
  };
}
