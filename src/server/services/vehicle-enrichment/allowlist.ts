/**
 * Domains we accept for document attachments. Everything else is rejected
 * outright — manualslib, scribd and PDF mirrors are not acceptable provenance
 * for a rental fleet's owner's manuals.
 *
 * Matches on suffix so `cdn2.yamaha-motor.eu` picks up
 * `yamaha-motor.eu`. Subdomains of allowlisted hosts inherit trust.
 */
export const DOCUMENT_SOURCE_ALLOWLIST: readonly string[] = [
  "motorcycles.honda.com.au",
  "honda.com.au",
  "yamaha-motor.com.au",
  "yamaha-motor.eu",
  "manuals.vespa.com",
  "vespa.com",
  "piaggio.com",
  "cdnmedia.endeavorsuite.com",
  "kymco.com.au",
  "kymco.com",
  "symmotorsports.com.au",
  "mojomotorcycles.com.au",
];

export function isAllowedDocumentSource(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return DOCUMENT_SOURCE_ALLOWLIST.some(
    (d) => host === d || host.endsWith(`.${d}`),
  );
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}
