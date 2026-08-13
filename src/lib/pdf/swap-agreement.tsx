import { Document, Image, Text, View, renderToBuffer } from "@react-pdf/renderer";

import { getBranding } from "@/lib/branding";
import { getInvoicingConfig } from "@/lib/invoicing-config";
import { formatCurrency, formatDateTime } from "@/lib/utils";

import { NoticeCallout } from "./components/callouts";
import { PdfFooter } from "./components/footer";
import { PdfHeader } from "./components/header";
import { Col, Field, PageShell, PdfSection, TwoColRow } from "./components/page-shell";
import { resolvePdfLogoSrc } from "./logo-resolver";
import { makePdfTheme, type PdfTheme } from "./theme";

/**
 * Mid-rental vehicle-swap agreement. Signed once a swap is committed
 * (`booking-swap.commitSwap`) and stored alongside the booking so the
 * customer's emailed and printed copies read consistently with the
 * other booking documents.
 */
export interface SwapAgreementData {
  swapId: string;
  swappedAt: Date;
  reason: string;
  origin: string;
  reasonNotes: string;
  originDetails: string | null;
  priceAdjustment: {
    direction: "NONE" | "CHARGE" | "REFUND";
    amount: number;
    gst: number;
  };
  bondVariance: number | null;
  booking: {
    bookingReference: string;
    pickupDateTime: Date;
    returnDateTime: Date;
    customer: { firstName: string; lastName: string; email: string };
  };
  outgoing: SwapVehicle;
  incoming: SwapVehicle;
  workOrderNumber: string | null;
  incidentNumber: string | null;
  customerSignatureUrl: string | null;
  staffSignatureUrl: string | null;
  staffName: string;
}

interface SwapVehicle {
  internalCode: string;
  rego: string;
  make: string;
  model: string;
  categoryName: string;
  /**
   * Inspection readings are null when the leg's inspection was waived —
   * LOSS_REPLACEMENT swaps have no outgoing inspection (the vehicle is
   * lost), and the document says so instead of printing readings.
   */
  odometerKm: number | null;
  fuelLevel: number | null;
  overallCondition: string | null;
  notes: string | null;
}

export async function renderSwapAgreementPdf(
  data: SwapAgreementData,
  abnOverride?: string,
): Promise<Buffer> {
  const branding = await getBranding();
  const config = await getInvoicingConfig();
  const theme = makePdfTheme(branding);
  const logoUrl = resolvePdfLogoSrc(branding);

  const swappedAtLocal = data.swappedAt.toLocaleString("en-AU", {
    timeZone: "Australia/Brisbane",
  });

  const pa = data.priceAdjustment;
  const priceLine =
    pa.direction === "NONE"
      ? "No price change."
      : `${pa.direction === "CHARGE" ? "Customer to be charged" : "Customer to be refunded"} ${formatCurrency(pa.amount)} (GST ${formatCurrency(pa.gst)}).`;

  const reasonLabel = `${data.reason.replace(/_/g, " ")} (reported via ${data.origin
    .replace(/_/g, " ")
    .toLowerCase()}${data.originDetails ? ` — ${data.originDetails}` : ""})`;

  return renderToBuffer(
    <Document>
      <PageShell theme={theme}>
        <PdfHeader
          theme={theme}
          logoUrl={logoUrl}
          siteName={branding.siteName}
          legalName={branding.legalName}
          abn={abnOverride ?? branding.abn}
          documentType="Vehicle Swap Agreement"
          documentNumber={data.booking.bookingReference}
          issueLabel="Swapped"
          issueDate={swappedAtLocal}
          contextNote={`Swap performed by ${data.staffName}`}
        />

        <PdfSection theme={theme} title="Customer & booking">
          <TwoColRow theme={theme}>
            <Col>
              <Field
                theme={theme}
                label="Customer"
                value={`${data.booking.customer.firstName} ${data.booking.customer.lastName}`}
              />
              <Field theme={theme} label="Email" value={data.booking.customer.email} />
            </Col>
            <Col>
              <Field
                theme={theme}
                label="Booking window"
                value={`${formatDateTime(data.booking.pickupDateTime)} → ${formatDateTime(data.booking.returnDateTime)}`}
              />
              <Field theme={theme} label="Booking reference" value={data.booking.bookingReference} />
            </Col>
          </TwoColRow>
        </PdfSection>

        <PdfSection theme={theme} title="Reason for swap">
          <Text style={{ fontSize: theme.size.body, marginBottom: theme.spacing.sm }}>
            {reasonLabel}
          </Text>
          {data.reasonNotes ? (
            <Text style={{ fontSize: theme.size.body, color: theme.colors.muted }}>
              {data.reasonNotes}
            </Text>
          ) : null}
        </PdfSection>

        <PdfSection theme={theme} title="Vehicles">
          <TwoColRow theme={theme}>
            <Col>
              <SwapVehicleBlock theme={theme} vehicle={data.outgoing} label="Outgoing vehicle" />
            </Col>
            <Col>
              <SwapVehicleBlock theme={theme} vehicle={data.incoming} label="Incoming vehicle" />
            </Col>
          </TwoColRow>
        </PdfSection>

        <PdfSection theme={theme} title="Price adjustment">
          <Text style={{ fontSize: theme.size.body }}>{priceLine}</Text>
        </PdfSection>

        {data.bondVariance !== null ? (
          <BondVarianceCallout theme={theme} variance={data.bondVariance} />
        ) : null}

        {data.workOrderNumber || data.incidentNumber ? (
          <View style={{ marginTop: theme.spacing.lg, gap: theme.spacing.xs }}>
            {data.workOrderNumber ? (
              <Text style={{ fontSize: theme.size.caption, color: theme.colors.muted }}>
                Work order: {data.workOrderNumber}
              </Text>
            ) : null}
            {data.incidentNumber ? (
              <Text style={{ fontSize: theme.size.caption, color: theme.colors.muted }}>
                Incident: {data.incidentNumber}
              </Text>
            ) : null}
          </View>
        ) : null}

        <PdfSection theme={theme} title="Signatures">
          <TwoColRow theme={theme}>
            <Col>
              <SignatureSlot
                theme={theme}
                label="Customer signature"
                signatureUrl={data.customerSignatureUrl}
              />
            </Col>
            <Col>
              <SignatureSlot
                theme={theme}
                label="Staff signature"
                signatureUrl={data.staffSignatureUrl}
              />
            </Col>
          </TwoColRow>
        </PdfSection>

        <PdfFooter
          theme={theme}
          legalName={branding.legalName}
          abn={abnOverride ?? branding.abn}
          supportEmail={branding.supportEmail}
          supportPhone={branding.supportPhone}
          postalAddress={branding.postalAddress}
          invoiceFooter={config.invoiceFooter}
        />
      </PageShell>
    </Document>,
  );
}

function SwapVehicleBlock({
  theme,
  vehicle,
  label,
}: {
  theme: PdfTheme;
  vehicle: SwapVehicle;
  label: string;
}) {
  return (
    <View>
      <Text
        style={{
          fontSize: theme.size.caption,
          color: theme.colors.muted,
          textTransform: "uppercase",
          letterSpacing: 0.5,
          marginBottom: theme.spacing.xs,
        }}
      >
        {label}
      </Text>
      <Text style={{ fontSize: theme.size.bodyLg, fontFamily: theme.font.bodyBold }}>
        {vehicle.make} {vehicle.model} · {vehicle.internalCode}
      </Text>
      <Text style={{ fontSize: theme.size.body }}>
        Rego {vehicle.rego} · {vehicle.categoryName}
      </Text>
      <Text
        style={{
          fontSize: theme.size.caption,
          color: theme.colors.muted,
          marginTop: theme.spacing.xs,
        }}
      >
        {vehicle.odometerKm !== null
          ? `Odometer ${vehicle.odometerKm.toLocaleString()} km · Fuel ${vehicle.fuelLevel ?? 0}% · Condition ${vehicle.overallCondition ?? "—"}`
          : "Outgoing inspection waived — vehicle lost."}
      </Text>
      {vehicle.notes ? (
        <Text
          style={{
            fontSize: theme.size.caption,
            color: theme.colors.muted,
            marginTop: theme.spacing.sm,
          }}
        >
          Notes: {vehicle.notes}
        </Text>
      ) : null}
    </View>
  );
}

function BondVarianceCallout({ theme, variance }: { theme: PdfTheme; variance: number }) {
  return (
    <NoticeCallout theme={theme} title="Bond variance" tone="info">
      Original bond hold retained across swap. Category bond differs by {formatCurrency(variance)} —
      recorded for audit only, no additional hold placed.
    </NoticeCallout>
  );
}

function SignatureSlot({
  theme,
  label,
  signatureUrl,
}: {
  theme: PdfTheme;
  label: string;
  signatureUrl: string | null;
}) {
  return (
    <View>
      <Text
        style={{
          fontSize: theme.size.caption,
          color: theme.colors.muted,
          textTransform: "uppercase",
          letterSpacing: 0.5,
          marginBottom: theme.spacing.xs,
        }}
      >
        {label}
      </Text>
      {signatureUrl ? (
        <Image src={signatureUrl} style={{ height: 50, marginTop: theme.spacing.xs }} />
      ) : (
        <Text
          style={{
            fontSize: theme.size.caption,
            color: theme.colors.faint,
            marginTop: theme.spacing.xs,
          }}
        >
          (signed on tablet)
        </Text>
      )}
    </View>
  );
}
