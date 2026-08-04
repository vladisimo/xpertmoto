import { Document, Image, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";

import { getBranding } from "@/lib/branding";
import { LineItemsTable, type PdfLineItem } from "@/lib/pdf/components/line-items-table";
import { NoticeCallout } from "@/lib/pdf/components/callouts";
import { PdfHeader } from "@/lib/pdf/components/header";
import {
  Col,
  Field,
  PageShell,
  PdfSection,
  TwoColRow,
} from "@/lib/pdf/components/page-shell";
import { resolvePdfLogoSrc } from "@/lib/pdf/logo-resolver";
import { PhotoIssues, type PdfPhotoWithIssues } from "@/lib/agreement/pdf/photo-issues";
import { type PdfTheme, makePdfTheme } from "@/lib/pdf/theme";
import { PdfTotals } from "@/lib/pdf/components/totals";
import { formatCurrency, formatDateTime } from "@/lib/utils";

export interface RentalAgreementData {
  agreementNumber: string;
  version: number;
  termsVersion: string;
  signedAt: Date;
  booking: {
    bookingReference: string;
    pickupDateTime: Date;
    returnDateTime: Date;
    durationDays: number;
    subtotal: number;
    addonTotal: number;
    insuranceTotal: number;
    discountAmount: number;
    gstAmount: number;
    totalAmount: number;
    bondAmount: number;
  };
  customer: { firstName: string; lastName: string; email: string; phone: string | null };
  vehicle: {
    internalCode: string;
    rego: string;
    make: string;
    model: string;
    year: number;
    colour: string | null;
  };
  category: { name: string };
  pickupDepot: {
    name: string;
    addressLine1: string;
    suburb: string;
    state: string;
    postcode: string;
  };
  returnDepot: { name: string };
  staffName?: string;
  addons: { name: string; quantity: number; totalPrice: number }[];
  insurance: { name: string; excessAmount: number; totalPrice: number } | null;
  photos: PdfPhotoWithIssues[];
  terms: { version: string; sections: { heading: string; paragraphs: string[] }[] };
  cancellationPolicy: string[];
  bondPolicy: string[];
  declarations: string[];
  signatures: {
    customerFullUrl?: string | null;
    staffFullUrl?: string | null;
    initialsUrl?: string | null;
  };
  abn: string;
}

export async function renderRentalAgreementPdf(data: RentalAgreementData): Promise<Buffer> {
  const branding = await getBranding();
  const theme = makePdfTheme(branding);
  const logoUrl = resolvePdfLogoSrc(branding);

  const signedAtIso = data.signedAt.toISOString();
  const signedAtLocal = data.signedAt.toLocaleString("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Australia/Brisbane",
  });
  const customerFullName = `${data.customer.firstName} ${data.customer.lastName}`;

  const renderHeader = () => (
    <PdfHeader
      theme={theme}
      logoUrl={logoUrl}
      siteName={branding.siteName}
      legalName={branding.legalName}
      abn={branding.abn}
      documentType="Rental Agreement"
      documentNumber={data.agreementNumber}
      issueLabel="Version"
      issueDate={`v${data.version}`}
      contextNote={`Booking ${data.booking.bookingReference}`}
    />
  );

  // Per-page fixed footer carries the customer signature stamp + name + date,
  // mirroring the Terms & Conditions consent document so every page stands
  // alone as evidence of signing.
  const renderFooter = () => (
    <SignedFixedFooter
      theme={theme}
      legalName={branding.legalName}
      abn={branding.abn}
      title="Rental Agreement"
      version={`v${data.version}`}
      customerFullName={customerFullName}
      signatureUrl={data.signatures.customerFullUrl}
      signedAtLocal={signedAtLocal}
      signedAtIso={signedAtIso}
    />
  );

  const lineItems = buildLineItems(data);
  const subtotalExGst = data.booking.totalAmount - data.booking.gstAmount;

  return renderToBuffer(
    <Document>
      {/* Page 1 — Cover */}
      <PageShell theme={theme}>
        {renderHeader()}
        <PdfSection theme={theme} title="Rental agreement cover">
          <TwoColRow theme={theme}>
            <Col>
              <Field
                theme={theme}
                label="Hirer"
                value={`${data.customer.firstName} ${data.customer.lastName}`}
              />
              <Field theme={theme} label="Email" value={data.customer.email} />
              {data.customer.phone ? (
                <Field theme={theme} label="Phone" value={data.customer.phone} />
              ) : null}
            </Col>
            <Col>
              <Field theme={theme} label="Pickup depot" value={data.pickupDepot.name} />
              <Field
                theme={theme}
                label="Address"
                value={`${data.pickupDepot.addressLine1}, ${data.pickupDepot.suburb} ${data.pickupDepot.state} ${data.pickupDepot.postcode}`}
              />
            </Col>
          </TwoColRow>
          <TwoColRow theme={theme}>
            <Col>
              <Field
                theme={theme}
                label="Vehicle"
                value={`${data.vehicle.make} ${data.vehicle.model} (${data.vehicle.year})`}
              />
              <Field
                theme={theme}
                label="Identifiers"
                value={`${data.category.name} · Rego ${data.vehicle.rego} · Code ${data.vehicle.internalCode}`}
              />
              {data.vehicle.colour ? (
                <Field theme={theme} label="Colour" value={data.vehicle.colour} />
              ) : null}
            </Col>
            <Col>
              <Field
                theme={theme}
                label="Pickup"
                value={formatDateTime(data.booking.pickupDateTime)}
              />
              <Field
                theme={theme}
                label="Return"
                value={formatDateTime(data.booking.returnDateTime)}
              />
              <Field theme={theme} label="Duration" value={`${data.booking.durationDays} day(s)`} />
              <Field theme={theme} label="Return depot" value={data.returnDepot.name} />
            </Col>
          </TwoColRow>
          <NoticeCallout theme={theme} title="Booking" tone="info">
            Booking reference {data.booking.bookingReference}
            {data.staffName ? ` · Handover staff: ${data.staffName}` : ""}
            {"\n"}Terms version: {data.terms.version} · Agreement version: {data.version}
          </NoticeCallout>
        </PdfSection>
        {renderFooter()}
      </PageShell>

      {/* Page 2 — Pricing */}
      <PageShell theme={theme}>
        {renderHeader()}
        <PdfSection theme={theme} title="Pricing summary" eyebrow="Itemised charges">
          <LineItemsTable theme={theme} items={lineItems} />
          <PdfTotals
            theme={theme}
            subtotal={subtotalExGst}
            gst={data.booking.gstAmount}
            total={data.booking.totalAmount}
            totalLabel="Total (incl GST)"
          />
        </PdfSection>
        <NoticeCallout theme={theme} title="Refundable bond" tone="warn">
          A refundable security hold of {formatCurrency(data.booking.bondAmount)} is authorised
          against your card. The bond may be applied to damage, late fees, fuel shortfall,
          cleaning, infringements, or insurance excess. Any unused portion is released within 14
          days of return.
        </NoticeCallout>
        {renderFooter()}
      </PageShell>

      {/* Page 3 — Vehicle condition */}
      <PageShell theme={theme}>
        {renderHeader()}
        <PdfSection theme={theme} title="Vehicle condition report (pre-hire)">
          <Text style={{ fontSize: theme.size.body, marginBottom: theme.spacing.md }}>
            The photographs below document the condition of the vehicle at handover, with any
            pre-existing damage pinned and labelled on the relevant photo. This report forms part of
            the agreement and is the reference against which return damage is assessed.
          </Text>
          <PhotoIssues theme={theme} photos={data.photos} />
        </PdfSection>
        {renderFooter()}
      </PageShell>

      {/* Page 4 — Terms */}
      <PageShell theme={theme}>
        {renderHeader()}
        <PdfSection theme={theme} title={`Terms & conditions — v${data.terms.version}`}>
          {data.terms.sections.map((s) => (
            <View key={s.heading} style={{ marginBottom: theme.spacing.md }} wrap>
              <Text
                style={{
                  fontSize: theme.size.h3,
                  fontFamily: theme.font.bodyBold,
                  color: theme.colors.ink,
                  marginTop: theme.spacing.md,
                  marginBottom: theme.spacing.xs,
                }}
              >
                {s.heading}
              </Text>
              {s.paragraphs.map((p, pi) => (
                <Text
                  key={`p-${pi}`}
                  style={{
                    fontSize: theme.size.body,
                    lineHeight: 1.45,
                    marginBottom: theme.spacing.xs,
                  }}
                >
                  {p}
                </Text>
              ))}
            </View>
          ))}
        </PdfSection>
        {renderFooter()}
      </PageShell>

      {/* Page 5 — Bond & cancellation */}
      <PageShell theme={theme}>
        {renderHeader()}
        <PdfSection theme={theme} title="Bond & cancellation policy">
          <Text
            style={{
              fontSize: theme.size.h3,
              fontFamily: theme.font.bodyBold,
              color: theme.colors.ink,
              marginTop: theme.spacing.md,
              marginBottom: theme.spacing.xs,
            }}
          >
            Bond
          </Text>
          {data.bondPolicy.map((p, i) => (
            <Text
              key={`bp-${i}`}
              style={{
                fontSize: theme.size.body,
                lineHeight: 1.45,
                marginBottom: theme.spacing.xs,
              }}
            >
              {p}
            </Text>
          ))}
          <Text
            style={{
              fontSize: theme.size.h3,
              fontFamily: theme.font.bodyBold,
              color: theme.colors.ink,
              marginTop: theme.spacing.lg,
              marginBottom: theme.spacing.xs,
            }}
          >
            Cancellation
          </Text>
          {data.cancellationPolicy.map((p, i) => (
            <Text
              key={`cp-${i}`}
              style={{
                fontSize: theme.size.body,
                lineHeight: 1.45,
                marginBottom: theme.spacing.xs,
              }}
            >
              {p}
            </Text>
          ))}
        </PdfSection>
        {renderFooter()}
      </PageShell>

      {/* Page 6 — Driver declarations */}
      <PageShell theme={theme}>
        {renderHeader()}
        <PdfSection theme={theme} title="Driver declarations">
          <Text
            style={{
              fontSize: theme.size.body,
              marginBottom: theme.spacing.md,
            }}
          >
            By initialling this page, you declare and confirm that:
          </Text>
          {data.declarations.map((d, i) => (
            <Text
              key={`de-${i}`}
              style={{
                fontSize: theme.size.body,
                lineHeight: 1.45,
                marginBottom: theme.spacing.xs,
              }}
            >
              • {d}
            </Text>
          ))}
        </PdfSection>
        {renderFooter()}
      </PageShell>

      {/* Page 7 — Final signatures */}
      <PageShell theme={theme}>
        {renderHeader()}
        <PdfSection theme={theme} title="Signatures">
          <Text
            style={{
              fontSize: theme.size.body,
              color: theme.colors.muted,
              marginBottom: theme.spacing.lg,
            }}
          >
            This agreement is subject to the terms set out above.
          </Text>
          <TwoColRow theme={theme}>
            <Col>
              <SignatureBox
                theme={theme}
                label="Hirer signature"
                signatureUrl={data.signatures.customerFullUrl}
                name={customerFullName}
                signedAtLocal={signedAtLocal}
                signedAtIso={signedAtIso}
              />
            </Col>
            <Col>
              <SignatureBox
                theme={theme}
                label="Staff witness signature"
                signatureUrl={data.signatures.staffFullUrl}
                name={data.staffName ?? null}
                signedAtLocal={signedAtLocal}
                signedAtIso={signedAtIso}
              />
            </Col>
          </TwoColRow>
        </PdfSection>
        {renderFooter()}
      </PageShell>
    </Document>,
  );
}

function buildLineItems(data: RentalAgreementData): PdfLineItem[] {
  const days = Math.max(1, data.booking.durationDays);
  const items: PdfLineItem[] = [
    {
      description: `${data.category.name} hire`,
      detail: `${days} day${days === 1 ? "" : "s"}`,
      quantity: days,
      unitPrice: data.booking.subtotal / days,
      totalPrice: data.booking.subtotal,
    },
  ];
  for (const a of data.addons) {
    const qty = Math.max(1, a.quantity);
    items.push({
      description: a.name,
      quantity: qty,
      unitPrice: a.totalPrice / qty,
      totalPrice: a.totalPrice,
    });
  }
  if (data.insurance) {
    items.push({
      description: "Insurance",
      detail: `${data.insurance.name} · excess ${formatCurrency(data.insurance.excessAmount)}`,
      quantity: 1,
      unitPrice: data.insurance.totalPrice,
      totalPrice: data.insurance.totalPrice,
    });
  }
  if (data.booking.discountAmount > 0) {
    items.push({
      description: "Discount",
      quantity: 1,
      unitPrice: data.booking.discountAmount,
      totalPrice: data.booking.discountAmount,
      negative: true,
    });
  }
  return items;
}

// Final signature block — mirrors the Terms & Conditions consent document:
// label → bold signer name → signature image → "Accepted at {local} AEST ({iso})".
function SignatureBox({
  theme,
  label,
  signatureUrl,
  name,
  signedAtLocal,
  signedAtIso,
}: {
  theme: PdfTheme;
  label: string;
  signatureUrl: string | null | undefined;
  name: string | null;
  signedAtLocal: string;
  signedAtIso: string;
}) {
  const styles = StyleSheet.create({
    wrap: {
      borderWidth: 1,
      borderColor: theme.colors.divider,
      borderRadius: theme.radii.sm,
      padding: theme.spacing.md,
      minHeight: 110,
    },
    label: {
      fontSize: theme.size.caption,
      color: theme.colors.muted,
      textTransform: "uppercase",
      letterSpacing: 0.5,
      marginBottom: theme.spacing.xs,
    },
    name: {
      fontSize: theme.size.bodyLg,
      fontFamily: theme.font.bodyBold,
      color: theme.colors.ink,
      marginBottom: theme.spacing.xs,
    },
    image: {
      width: "100%",
      height: 60,
    },
    placeholder: {
      fontSize: theme.size.caption,
      color: theme.colors.faint,
    },
    accepted: {
      marginTop: theme.spacing.sm,
      fontSize: theme.size.caption,
      color: theme.colors.muted,
    },
  });
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      {name ? <Text style={styles.name}>{name}</Text> : null}
      {signatureUrl ? (
        <Image src={signatureUrl} style={styles.image} />
      ) : (
        <Text style={styles.placeholder}>(unsigned)</Text>
      )}
      {signatureUrl ? (
        <Text style={styles.accepted}>
          Accepted at {signedAtLocal} AEST ({signedAtIso})
        </Text>
      ) : null}
    </View>
  );
}

// Per-page fixed footer modelled on the consent document's footer: supplier
// identity + page counter on the left, customer signature stamp + name + date
// on the right, so each rendered page stands alone as evidence of signing.
function SignedFixedFooter({
  theme,
  legalName,
  abn,
  title,
  version,
  customerFullName,
  signatureUrl,
  signedAtLocal,
  signedAtIso,
}: {
  theme: PdfTheme;
  legalName: string;
  abn: string;
  title: string;
  version: string;
  customerFullName: string;
  signatureUrl: string | null | undefined;
  signedAtLocal: string;
  signedAtIso: string;
}) {
  const styles = StyleSheet.create({
    wrap: {
      position: "absolute",
      bottom: theme.spacing.xxl,
      left: theme.spacing.page,
      right: theme.spacing.page,
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-end",
      borderTopWidth: 1,
      borderTopColor: theme.colors.divider,
      paddingTop: theme.spacing.md,
    },
    leftCol: {
      flex: 1,
      gap: theme.spacing.xs,
    },
    rightCol: {
      alignItems: "flex-end",
      gap: theme.spacing.xs,
    },
    line: {
      fontSize: theme.size.micro,
      color: theme.colors.faint,
    },
    sigStamp: {
      width: 80,
      height: 30,
      objectFit: "contain",
    },
  });
  const supplierLine = [legalName, abn ? `ABN ${abn}` : null].filter(Boolean).join(" · ");
  return (
    <View style={styles.wrap} fixed>
      <View style={styles.leftCol}>
        <Text style={styles.line}>{supplierLine}</Text>
        <Text style={styles.line}>
          {title} · {version}
        </Text>
        <Text
          style={styles.line}
          render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
        />
      </View>
      {signatureUrl ? (
        <View style={styles.rightCol}>
          <Image src={signatureUrl} style={styles.sigStamp} />
          <Text style={styles.line}>Signed by {customerFullName}</Text>
          <Text style={styles.line}>{signedAtLocal} AEST</Text>
          <Text style={styles.line}>{signedAtIso}</Text>
        </View>
      ) : null}
    </View>
  );
}

