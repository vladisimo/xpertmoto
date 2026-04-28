import { getSettings } from "@/lib/settings";

/**
 * Server-only invoicing configuration. Read at issuance time so
 * operator-edited values (prefixes, terms, remittance block, footer)
 * apply to every newly issued document without redeploying.
 *
 * The four currency-style fields (`*TermsDays`) are coerced to a
 * non-negative integer; anything malformed in the database falls back
 * to the SETTING_DEFAULTS value to keep the issuance pipeline robust.
 */

const KEYS = [
  "org.invoicePrefix",
  "org.adjustmentPrefix",
  "org.receiptPrefix",
  "org.invoiceFooter",
  "org.remittanceDetails",
  "org.invoiceTermsDays",
  "org.adjustmentTermsDays",
] as const;

export interface InvoicingConfig {
  invoicePrefix: string;
  adjustmentPrefix: string;
  receiptPrefix: string;
  invoiceFooter: string;
  remittanceDetails: string;
  invoiceTermsDays: number;
  adjustmentTermsDays: number;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function asInt(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  if (typeof value === "string") {
    const n = Number.parseInt(value, 10);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return fallback;
}

export async function getInvoicingConfig(): Promise<InvoicingConfig> {
  const s = await getSettings(KEYS);
  return {
    invoicePrefix: asString(s["org.invoicePrefix"], "INV"),
    adjustmentPrefix: asString(s["org.adjustmentPrefix"], "ADJ"),
    receiptPrefix: asString(s["org.receiptPrefix"], "RCT"),
    invoiceFooter: asString(s["org.invoiceFooter"], ""),
    remittanceDetails: asString(s["org.remittanceDetails"], ""),
    invoiceTermsDays: asInt(s["org.invoiceTermsDays"], 0),
    adjustmentTermsDays: asInt(s["org.adjustmentTermsDays"], 14),
  };
}
