import { Document, renderToBuffer, Text, View } from "@react-pdf/renderer";

import { getBranding } from "@/lib/branding";
import { getInvoicingConfig } from "@/lib/invoicing-config";
import { formatCurrency } from "@/lib/utils";

import { BondNotice, RemittanceBlock } from "./components/callouts";
import { PdfFooter } from "./components/footer";
import { PdfHeader } from "./components/header";
import { LineItemsTable, type PdfLineItem } from "./components/line-items-table";
import { PageShell, PdfSection } from "./components/page-shell";
import { PartiesBlock, type RecipientParty } from "./components/parties";
import { PdfTotals, type PdfTotalsLine } from "./components/totals";
import { resolvePdfLogoSrc } from "./logo-resolver";
import { makePdfTheme } from "./theme";

/**
 * Input shape for the canonical Tax Invoice renderer. Built by the
 * `invoice-lifecycle` service from a Booking + its pricing snapshot.
 *
 * Every monetary field is GST-inclusive (Australian convention).
 * `gstAmount` and `subtotal` are the GST-split totals (subtotal +
 * gstAmount = totalAmount).
 */
export interface TaxInvoicePdfInput {
  invoiceNumber: string;
  /** ISO date string. Used for the "Issued" header and the FY context. */
  issuedAt: Date;
  /** Optional date object — when present, the customer-facing "Due"
   *  block is rendered in the remittance area. */
  dueDate: Date | null;
  bookingReference: string;
  customer: RecipientParty;
  /** Itemised line items derived from the booking pricing snapshot
   *  (rental days, addons, insurance, delivery, discounts).
   *  Discount lines should set `negative: true` and use a positive
   *  `totalPrice` magnitude. */
  lineItems: PdfLineItem[];
  subtotal: number; // ex GST
  gstAmount: number;
  totalAmount: number; // incl GST
  amountPaid: number; // 0 if still pending
  /** Refundable bond hold; rendered in a callout, NOT in the totals. */
  bondAmount: number;
  /** Render under the document number — eg "Booking SCT-2024-001234". */
  contextNote?: string;
}

export async function renderTaxInvoicePdf(input: TaxInvoicePdfInput): Promise<Buffer> {
  const branding = await getBranding();
  // A tax invoice without the supplier's legal name + ABN is not a valid
  // GST invoice (ATO requirement). Fail fast instead of silently issuing
  // non-compliant documents — invoice-lifecycle retry sweeps regenerate
  // once branding is configured.
  if (!branding.abn || !branding.legalName) {
    throw new Error(
      "Cannot render a tax invoice: org.legalName and org.abn are not configured. " +
        "Set them in Admin → Settings → Organisation before issuing invoices.",
    );
  }
  const config = await getInvoicingConfig();
  const theme = makePdfTheme(branding);
  const logoUrl = resolvePdfLogoSrc(branding);

  const enAuDate = (d: Date | null): string =>
    d
      ? new Intl.DateTimeFormat("en-AU", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        }).format(d)
      : "";

  const balanceDue = Math.max(0, input.totalAmount - input.amountPaid);
  const totalsExtras: PdfTotalsLine[] = [];
  if (input.amountPaid > 0) {
    totalsExtras.push({ label: "Less amount paid", amount: input.amountPaid, negative: true });
    totalsExtras.push({
      label: balanceDue === 0 ? "Balance" : "Balance due",
      amount: balanceDue,
      muted: balanceDue === 0,
    });
  }

  const supplier = {
    legalName: branding.legalName || branding.siteName,
    tradingName: branding.siteName,
    abn: branding.abn,
    postalAddress: branding.postalAddress,
    email: branding.supportEmail,
    phone: branding.supportPhone,
  };

  return renderToBuffer(
    <Document>
      <PageShell theme={theme}>
        <PdfHeader
          theme={theme}
          logoUrl={logoUrl}
          siteName={branding.siteName}
          legalName={branding.legalName}
          abn={branding.abn}
          documentType="Tax Invoice"
          documentNumber={input.invoiceNumber}
          issueDate={enAuDate(input.issuedAt)}
          contextNote={input.contextNote ?? `Booking ${input.bookingReference}`}
        />

        <PartiesBlock theme={theme} supplier={supplier} recipient={input.customer} />

        <PdfSection theme={theme} title="Rental details" eyebrow="Itemised charges">
          <LineItemsTable theme={theme} items={input.lineItems} />
        </PdfSection>

        <PdfTotals
          theme={theme}
          subtotal={input.subtotal}
          gst={input.gstAmount}
          total={input.totalAmount}
          totalLabel="Total (incl GST)"
          extras={totalsExtras.length ? totalsExtras : undefined}
        />

        {/* Status pill — paid / due-on-issue / due-by */}
        <View style={{ marginTop: theme.spacing.lg }}>
          {balanceDue === 0 ? (
            <Text
              style={{
                alignSelf: "flex-end",
                fontSize: theme.size.caption,
                fontFamily: theme.font.bodyBold,
                color: theme.colors.successInk,
                letterSpacing: 0.6,
                textTransform: "uppercase",
              }}
            >
              Paid in full · Thank you
            </Text>
          ) : (
            <Text
              style={{
                alignSelf: "flex-end",
                fontSize: theme.size.caption,
                color: theme.colors.muted,
              }}
            >
              {input.dueDate
                ? `Balance due by ${enAuDate(input.dueDate)} · ${formatCurrency(balanceDue)}`
                : `Balance due on receipt · ${formatCurrency(balanceDue)}`}
            </Text>
          )}
        </View>

        <BondNotice theme={theme} bondAmount={input.bondAmount} />

        <RemittanceBlock
          theme={theme}
          remittanceDetails={config.remittanceDetails}
          invoiceNumber={input.invoiceNumber}
          amountDue={balanceDue}
          dueDate={input.dueDate ? enAuDate(input.dueDate) : null}
        />

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
