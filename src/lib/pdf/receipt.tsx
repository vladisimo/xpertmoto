import { Document, renderToBuffer, Text, View } from "@react-pdf/renderer";

import { getBranding } from "@/lib/branding";
import { getInvoicingConfig } from "@/lib/invoicing-config";
import { formatCurrency } from "@/lib/utils";

import { PdfFooter } from "./components/footer";
import { PdfHeader } from "./components/header";
import { PageShell, PdfSection, Field, TwoColRow, Col } from "./components/page-shell";
import { PartiesBlock, type RecipientParty } from "./components/parties";
import { PdfTotals } from "./components/totals";
import { resolvePdfLogoSrc } from "./logo-resolver";
import { makePdfTheme } from "./theme";

/**
 * Branded payment receipt. Issued every time a Payment row reaches
 * SUCCEEDED — including booking payments, bond captures, ancillary
 * charges, refunds (negative total), and manual entries.
 */
export interface ReceiptPdfInput {
  receiptNumber: string;
  paidAt: Date;
  /** Plain-English label — "Booking payment", "Damage charge",
   *  "Bond release", "Refund", "Late return fee", etc. */
  paymentLabel: string;
  /** When the receipt is for a refund, render the amount in red and
   *  prefix the totals label with "Refunded". */
  isRefund: boolean;
  /** GST-inclusive total. Stored as a positive number even for refunds;
   *  direction is conveyed by `isRefund`. */
  amount: number;
  gstAmount: number;
  /** Methods like "Visa •••• 4242", "Cash", "Bank transfer". */
  methodLabel: string;
  /** Optional Stripe charge id / bank transfer reference. */
  paymentReference?: string | null;
  /** Linked booking, if any. */
  bookingReference?: string | null;
  /** Linked invoice / adjustment-note number, if any. */
  relatedDocumentNumber?: string | null;
  customer: RecipientParty;
  /** Optional free-text note (eg "Bond capture for damage to fairing"). */
  note?: string | null;
}

export async function renderReceiptPdf(input: ReceiptPdfInput): Promise<Buffer> {
  const branding = await getBranding();
  const config = await getInvoicingConfig();
  const theme = makePdfTheme(branding);
  const logoUrl = resolvePdfLogoSrc(branding);

  const enAuDate = (d: Date): string =>
    new Intl.DateTimeFormat("en-AU", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);

  const supplier = {
    legalName: branding.legalName || branding.siteName,
    tradingName: branding.siteName,
    abn: branding.abn,
    postalAddress: branding.postalAddress,
    email: branding.supportEmail,
    phone: branding.supportPhone,
  };

  const subtotal = Math.max(0, input.amount - input.gstAmount);

  return renderToBuffer(
    <Document>
      <PageShell theme={theme}>
        <PdfHeader
          theme={theme}
          logoUrl={logoUrl}
          siteName={branding.siteName}
          legalName={branding.legalName}
          abn={branding.abn}
          documentType={input.isRefund ? "Refund Receipt" : "Receipt"}
          documentNumber={input.receiptNumber}
          issueLabel="Date"
          issueDate={enAuDate(input.paidAt)}
          contextNote={
            input.relatedDocumentNumber
              ? `Relates to ${input.relatedDocumentNumber}`
              : input.bookingReference
                ? `Booking ${input.bookingReference}`
                : undefined
          }
        />

        <PartiesBlock theme={theme} supplier={supplier} recipient={input.customer} />

        <PdfSection theme={theme} title="Payment summary" eyebrow="What was paid">
          <TwoColRow theme={theme}>
            <Col>
              <Field theme={theme} label="Description" value={input.paymentLabel} />
              <Field
                theme={theme}
                label="Booking"
                value={input.bookingReference ?? null}
              />
              <Field
                theme={theme}
                label="Related document"
                value={input.relatedDocumentNumber ?? null}
              />
            </Col>
            <Col>
              <Field theme={theme} label="Method" value={input.methodLabel} />
              <Field
                theme={theme}
                label="Reference"
                value={input.paymentReference ?? null}
              />
              <Field theme={theme} label="Date" value={enAuDate(input.paidAt)} />
            </Col>
          </TwoColRow>
          {input.note ? (
            <View style={{ marginTop: theme.spacing.md }}>
              <Text
                style={{
                  fontSize: theme.size.caption,
                  color: theme.colors.muted,
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                }}
              >
                Note
              </Text>
              <Text style={{ fontSize: theme.size.body }}>{input.note}</Text>
            </View>
          ) : null}
        </PdfSection>

        <PdfTotals
          theme={theme}
          subtotal={subtotal}
          gst={input.gstAmount}
          total={input.amount}
          totalLabel={input.isRefund ? "Refunded (incl GST)" : "Paid (incl GST)"}
        />

        <View style={{ marginTop: theme.spacing.xl }}>
          <Text
            style={{
              alignSelf: "flex-end",
              fontSize: theme.size.caption,
              fontFamily: theme.font.bodyBold,
              color: input.isRefund ? theme.colors.errorInk : theme.colors.successInk,
              letterSpacing: 0.6,
              textTransform: "uppercase",
            }}
          >
            {input.isRefund
              ? `Refunded · ${formatCurrency(input.amount)}`
              : `Received · Thank you`}
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
