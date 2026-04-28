import { Document, Image, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";

import { getBranding } from "@/lib/branding";
import { getInvoicingConfig } from "@/lib/invoicing-config";
import { LineItemsTable, type PdfLineItem } from "@/lib/pdf/components/line-items-table";
import { NoticeCallout } from "@/lib/pdf/components/callouts";
import { PdfFooter } from "@/lib/pdf/components/footer";
import { PdfHeader } from "@/lib/pdf/components/header";
import {
  Col,
  Field,
  PageShell,
  PdfSection,
  TwoColRow,
} from "@/lib/pdf/components/page-shell";
import { resolvePdfLogoSrc } from "@/lib/pdf/logo-resolver";
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
  photos: { url: string; caption?: string | null }[];
  damageMarkers: DamageMarker[];
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

interface DamageMarker {
  x: number;
  y: number;
  severity: string;
  note?: string;
  view?: "LEFT" | "RIGHT" | "FRONT" | "REAR";
}

export async function renderRentalAgreementPdf(data: RentalAgreementData): Promise<Buffer> {
  const branding = await getBranding();
  const config = await getInvoicingConfig();
  const theme = makePdfTheme(branding);
  const logoUrl = resolvePdfLogoSrc(branding);

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

  const renderFooter = () => (
    <PdfFooter
      theme={theme}
      legalName={branding.legalName}
      abn={branding.abn}
      supportEmail={branding.supportEmail}
      supportPhone={branding.supportPhone}
      postalAddress={branding.postalAddress}
      invoiceFooter={config.invoiceFooter}
    />
  );

  const renderInitials = () =>
    data.signatures.initialsUrl ? (
      <InitialsStamp theme={theme} url={data.signatures.initialsUrl} />
    ) : null;

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
        {renderInitials()}
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
        {renderInitials()}
        {renderFooter()}
      </PageShell>

      {/* Page 3 — Vehicle condition */}
      <PageShell theme={theme}>
        {renderHeader()}
        <PdfSection theme={theme} title="Vehicle condition report (pre-hire)">
          <Text style={{ fontSize: theme.size.body, marginBottom: theme.spacing.md }}>
            The photographs and damage map below document the condition of the vehicle at handover.
            This report forms part of the agreement and is the reference against which return
            damage is assessed.
          </Text>
          {data.photos.length > 0 ? (
            <PhotoGrid theme={theme} photos={data.photos.slice(0, 6)} />
          ) : null}
          <Text
            style={{
              fontSize: theme.size.h3,
              fontFamily: theme.font.bodyBold,
              color: theme.colors.ink,
              marginTop: theme.spacing.lg,
              marginBottom: theme.spacing.sm,
            }}
          >
            Damage map
          </Text>
          <View
            style={{
              width: "100%",
              height: 180,
              borderWidth: 1,
              borderColor: theme.colors.divider,
              marginBottom: theme.spacing.sm,
            }}
          >
            <DamageMapSvg theme={theme} markers={data.damageMarkers} />
          </View>
          <Text style={{ fontSize: theme.size.body }}>
            {data.damageMarkers.length === 0
              ? "No existing damage recorded at handover."
              : `${data.damageMarkers.length} existing marking(s) recorded at handover.`}
          </Text>
        </PdfSection>
        {renderInitials()}
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
        {renderInitials()}
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
        {renderInitials()}
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
        {renderInitials()}
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
            Signed on {formatDateTime(data.signedAt)}. This agreement is subject to the terms set
            out above.
          </Text>
          <TwoColRow theme={theme}>
            <Col>
              <SignatureBox
                theme={theme}
                label="Hirer signature"
                signatureUrl={data.signatures.customerFullUrl}
                caption={`${data.customer.firstName} ${data.customer.lastName}`}
              />
            </Col>
            <Col>
              <SignatureBox
                theme={theme}
                label="Staff witness signature"
                signatureUrl={data.signatures.staffFullUrl}
                caption={data.staffName ?? null}
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

function PhotoGrid({
  theme,
  photos,
}: {
  theme: PdfTheme;
  photos: { url: string; caption?: string | null }[];
}) {
  const styles = StyleSheet.create({
    grid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: theme.spacing.sm,
    },
    box: {
      width: "32%",
      height: 100,
      borderWidth: 1,
      borderColor: theme.colors.divider,
      borderRadius: theme.radii.sm,
    },
    image: {
      width: "100%",
      height: "100%",
      objectFit: "cover",
    },
    caption: {
      fontSize: theme.size.micro,
      color: theme.colors.muted,
      textAlign: "center",
      marginTop: theme.spacing.xs,
    },
  });
  return (
    <View style={styles.grid}>
      {photos.map((p, i) => (
        <View key={`ph-${i}`} style={styles.box}>
          <Image src={p.url} style={styles.image} />
          {p.caption ? <Text style={styles.caption}>{p.caption}</Text> : null}
        </View>
      ))}
    </View>
  );
}

function SignatureBox({
  theme,
  label,
  signatureUrl,
  caption,
}: {
  theme: PdfTheme;
  label: string;
  signatureUrl: string | null | undefined;
  caption: string | null;
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
    image: {
      width: "100%",
      height: 60,
    },
    placeholder: {
      fontSize: theme.size.caption,
      color: theme.colors.faint,
    },
    caption: {
      marginTop: theme.spacing.sm,
      fontSize: theme.size.caption,
    },
  });
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      {signatureUrl ? (
        <Image src={signatureUrl} style={styles.image} />
      ) : (
        <Text style={styles.placeholder}>(unsigned)</Text>
      )}
      {caption ? <Text style={styles.caption}>{caption}</Text> : null}
    </View>
  );
}

function InitialsStamp({ theme, url }: { theme: PdfTheme; url: string }) {
  const styles = StyleSheet.create({
    box: {
      borderWidth: 1,
      borderColor: theme.colors.divider,
      padding: theme.spacing.xs,
      position: "absolute",
      bottom: theme.spacing.page + theme.spacing.lg,
      right: theme.spacing.page,
    },
    image: {
      width: 48,
      height: 22,
    },
  });
  return (
    <View style={styles.box} fixed>
      <Image src={url} style={styles.image} />
    </View>
  );
}

const DAMAGE_VIEWS = ["LEFT", "RIGHT", "FRONT", "REAR"] as const;
type DamageView = (typeof DAMAGE_VIEWS)[number];

function DamageMapSvg({ theme, markers }: { theme: PdfTheme; markers: DamageMarker[] }) {
  const byView: Record<DamageView, DamageMarker[]> = {
    LEFT: [],
    RIGHT: [],
    FRONT: [],
    REAR: [],
  };
  for (const m of markers) byView[m.view ?? "LEFT"].push(m);
  const severityColour = (severity: string) => {
    if (severity === "MAJOR") return theme.colors.errorInk;
    return theme.colors.alertBorder;
  };
  return (
    <View
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        height: "100%",
        width: "100%",
        backgroundColor: theme.colors.surface,
      }}
    >
      {DAMAGE_VIEWS.map((v) => (
        <View key={v} style={{ width: "50%", height: "50%", padding: 3 }}>
          <View
            style={{
              position: "relative",
              height: "100%",
              width: "100%",
              backgroundColor: theme.colors.paper,
              borderWidth: 1,
              borderColor: theme.colors.divider,
            }}
          >
            <Text
              style={{
                position: "absolute",
                top: 4,
                left: 6,
                fontSize: theme.size.micro,
                color: theme.colors.muted,
                textTransform: "uppercase",
                letterSpacing: 1,
              }}
            >
              {v}
            </Text>
            {byView[v].map((m, i) => (
              <View
                key={`${v}-${i}`}
                style={{
                  position: "absolute",
                  left: `${m.x * 100}%`,
                  top: `${m.y * 100}%`,
                  width: 8,
                  height: 8,
                  marginLeft: -4,
                  marginTop: -4,
                  borderRadius: 8,
                  backgroundColor: severityColour(m.severity),
                }}
              />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}
