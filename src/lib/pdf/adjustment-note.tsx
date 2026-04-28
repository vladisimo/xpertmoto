import { Document, renderToBuffer, Text, View } from "@react-pdf/renderer";

import { getBranding } from "@/lib/branding";
import { getInvoicingConfig } from "@/lib/invoicing-config";
import { formatCurrency } from "@/lib/utils";

import { AdjustmentRefNotice } from "./components/callouts";
import { PdfFooter } from "./components/footer";
import { PdfHeader } from "./components/header";
import { LineItemsTable, type PdfLineItem } from "./components/line-items-table";
import { PageShell, PdfSection } from "./components/page-shell";
import { PartiesBlock, type RecipientParty } from "./components/parties";
import { PdfTotals } from "./components/totals";
import { resolvePdfLogoSrc } from "./logo-resolver";
import { makePdfTheme } from "./theme";

/**
 * ATO §29-75 adjustment note. Issued whenever the consideration for a
 * taxable supply changes after the original tax invoice was issued.
 */
export interface AdjustmentNotePdfInput {
  adjustmentNumber: string;
  issuedAt: Date;
  /** "INCREASE" raises the booking total; "DECREASE" reduces it. */
  type: "INCREASE" | "DECREASE";
  /** Customer-facing one-liner — eg "2-day rental extension". */
  description: string;
  /** The original tax invoice this adjusts. */
  originalInvoiceNumber: string;
  originalIssuedAt: Date;
  bookingReference: string;
  customer: RecipientParty;
  lineItems: PdfLineItem[];
  /** Subtotal is always positive; direction is conveyed by `type` and
   *  the parenthesised display on DECREASE rows. */
  subtotal: number;
  gstAmount: number;
  totalAmount: number;
  contextNote?: string;
}

export async function renderAdjustmentNotePdf(
  input: AdjustmentNotePdfInput,
): Promise<Buffer> {
  const branding = await getBranding();
  const config = await getInvoicingConfig();
  const theme = makePdfTheme(branding);
  const logoUrl = resolvePdfLogoSrc(branding);

  const enAuDate = (d: Date): string =>
    new Intl.DateTimeFormat("en-AU", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(d);

  const supplier = {
    legalName: branding.legalName || branding.siteName,
    tradingName: branding.siteName,
    abn: branding.abn,
    postalAddress: branding.postalAddress,
    email: branding.supportEmail,
    phone: branding.supportPhone,
  };

  // For DECREASE adjustments, we visually negate the totals box (paren'd
  // values + destructive ink on the bottom line) but keep the underlying
  // numbers positive — the document still reads as a positive amount on
  // the supplier's books with the type indicating direction.
  const isDecrease = input.type === "DECREASE";

  return renderToBuffer(
    <Document>
      <PageShell theme={theme}>
        <PdfHeader
          theme={theme}
          logoUrl={logoUrl}
          siteName={branding.siteName}
          legalName={branding.legalName}
          abn={branding.abn}
          documentType="Adjustment Note"
          documentNumber={input.adjustmentNumber}
          issueDate={enAuDate(input.issuedAt)}
          contextNote={
            input.contextNote ??
            `${isDecrease ? "Decrease" : "Increase"} · adjusts ${input.originalInvoiceNumber}`
          }
        />

        <PartiesBlock theme={theme} supplier={supplier} recipient={input.customer} />

        <AdjustmentRefNotice
          theme={theme}
          originalInvoiceNumber={input.originalInvoiceNumber}
          originalIssuedAt={enAuDate(input.originalIssuedAt)}
          bookingReference={input.bookingReference}
        />

        <PdfSection theme={theme} title={input.description} eyebrow="Adjustment">
          <LineItemsTable theme={theme} items={input.lineItems} showQuantity={false} />
        </PdfSection>

        <PdfTotals
          theme={theme}
          subtotal={input.subtotal}
          gst={input.gstAmount}
          total={input.totalAmount}
          totalLabel={
            isDecrease ? "Total decrease (incl GST)" : "Total increase (incl GST)"
          }
        />

        <View style={{ marginTop: theme.spacing.lg }}>
          <Text
            style={{
              alignSelf: "flex-end",
              fontSize: theme.size.caption,
              color: theme.colors.muted,
            }}
          >
            {isDecrease
              ? `Refunded to your card · ${formatCurrency(input.totalAmount)}`
              : `Charged to your card · ${formatCurrency(input.totalAmount)}`}
          </Text>
        </View>

        <PdfFooter
          theme={theme}
          legalName={branding.legalName}
          abn={branding.abn}
          supportEmail={branding.supportEmail}
          supportPhone={branding.supportPhone}
          postalAddress={branding.postalAddress}
          invoiceFooter={config.invoiceFooter}
        />
      </PageShell>
    </Document>,
  );
}
