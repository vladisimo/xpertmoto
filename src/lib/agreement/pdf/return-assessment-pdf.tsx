import { Document, Image, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";

import { getBranding } from "@/lib/branding";
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
import { type PdfTheme, makePdfTheme } from "@/lib/pdf/theme";
import { formatCurrency, formatDateTime } from "@/lib/utils";

export interface ReturnAssessmentData {
  assessmentNumber: string;
  version: number;
  signedAt: Date;
  booking: {
    bookingReference: string;
    pickupDateTime: Date;
    returnDateTime: Date;
    actualReturnDateTime: Date | null;
    pickupOdometerKm: number | null;
    bondAmount: number;
  };
  customer: { firstName: string; lastName: string; email: string };
  vehicle: { internalCode: string; rego: string; make: string; model: string };
  category: { name: string };
  returnDepot: { name: string };
  staffName?: string;
  odometerKm: number;
  fuelLevel: number;
  preHireMarkers: DamageMarker[];
  newMarkers: DamageMarker[];
  photos: { url: string; caption?: string | null }[];
  charges: ChargeLine[];
  fees: { lateFee: number; fuelCharge: number };
  totalDueNow: number;
  pendingQuoteCap: number;
  bond: { heldAmount: number; appliedAmount: number; releasedAmount: number };
  signatures: {
    customerFullUrl?: string | null;
    staffFullUrl?: string | null;
    initialsUrl?: string | null;
  };
  /** Retained for back-compat with callers that snapshot org identity at
   *  signing time. The render-time values from `getBranding()` take
   *  precedence; these are fallbacks only. */
  abn: string;
  siteName: string;
  legalName: string;
  supportEmail: string | null;
}

interface DamageMarker {
  x: number;
  y: number;
  severity: string;
  note?: string;
  view?: "LEFT" | "RIGHT" | "FRONT" | "REAR";
}

interface ChargeLine {
  description: string;
  severity: string;
  resolution: "STANDARD" | "QUOTE_PENDING" | "WAIVED" | "WARRANTY";
  amount: number;
  quoteCapAmount?: number | null;
  tariffName?: string | null;
}

export async function renderReturnAssessmentPdf(data: ReturnAssessmentData): Promise<Buffer> {
  const branding = await getBranding();
  const theme = makePdfTheme(branding);
  const logoUrl = resolvePdfLogoSrc(branding);

  const hasPendingQuotes = data.charges.some((c) => c.resolution === "QUOTE_PENDING");

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
      documentType="Return Assessment"
      documentNumber={data.assessmentNumber}
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
      title="Return Assessment"
      version={`v${data.version}`}
      customerFullName={customerFullName}
      signatureUrl={data.signatures.customerFullUrl}
      signedAtLocal={signedAtLocal}
      signedAtIso={signedAtIso}
    />
  );

  return renderToBuffer(
    <Document>
      {/* Page 1 — Cover */}
      <PageShell theme={theme}>
        {renderHeader()}
        <PdfSection theme={theme} title="Return assessment cover">
          <TwoColRow theme={theme}>
            <Col>
              <Field
                theme={theme}
                label="Hirer"
                value={`${data.customer.firstName} ${data.customer.lastName}`}
              />
              <Field theme={theme} label="Email" value={data.customer.email} />
            </Col>
            <Col>
              <Field theme={theme} label="Return depot" value={data.returnDepot.name} />
              {data.staffName ? (
                <Field theme={theme} label="Staff" value={data.staffName} />
              ) : null}
            </Col>
          </TwoColRow>
          <TwoColRow theme={theme}>
            <Col>
              <Field
                theme={theme}
                label="Vehicle"
                value={`${data.vehicle.make} ${data.vehicle.model}`}
              />
              <Field
                theme={theme}
                label="Identifiers"
                value={`${data.category.name} · Rego ${data.vehicle.rego} · Code ${data.vehicle.internalCode}`}
              />
            </Col>
            <Col>
              <Field theme={theme} label="Reference" value={data.booking.bookingReference} />
              <Field
                theme={theme}
                label="Pickup"
                value={formatDateTime(data.booking.pickupDateTime)}
              />
              <Field
                theme={theme}
                label="Return"
                value={`${formatDateTime(
                  data.booking.actualReturnDateTime ?? data.booking.returnDateTime,
                )}${
                  data.booking.actualReturnDateTime &&
                  data.booking.actualReturnDateTime > data.booking.returnDateTime
                    ? " (late)"
                    : ""
                }`}
              />
            </Col>
          </TwoColRow>
          <TwoColRow theme={theme}>
            <Col>
              <Field
                theme={theme}
                label="Pickup odometer"
                value={
                  data.booking.pickupOdometerKm !== null
                    ? `${data.booking.pickupOdometerKm} km`
                    : "—"
                }
              />
              <Field theme={theme} label="Return odometer" value={`${data.odometerKm} km`} />
              <Field theme={theme} label="Fuel at return" value={`${data.fuelLevel}%`} />
            </Col>
            <Col>{null}</Col>
          </TwoColRow>
        </PdfSection>
        {renderFooter()}
      </PageShell>

      {/* Page 2 — Condition + diff */}
      <PageShell theme={theme}>
        {renderHeader()}
        <PdfSection theme={theme} title="Post-hire condition report">
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
            Damage map — pre-hire (grey) vs new (red/orange)
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
            <DiffDamageMap theme={theme} pre={data.preHireMarkers} now={data.newMarkers} />
          </View>
          <Text style={{ fontSize: theme.size.body }}>
            {data.newMarkers.length === 0
              ? "No new damage identified at return."
              : `${data.newMarkers.length} new marking(s) identified at return.`}
          </Text>
        </PdfSection>
        {renderFooter()}
      </PageShell>

      {/* Page 3 — Damage charges */}
      <PageShell theme={theme}>
        {renderHeader()}
        <PdfSection theme={theme} title="Damage charges">
          {data.charges.length === 0 ? (
            <Text style={{ fontSize: theme.size.body }}>
              No damage charges raised against this return.
            </Text>
          ) : (
            <ChargesTable theme={theme} charges={data.charges} />
          )}
        </PdfSection>
        {renderFooter()}
      </PageShell>

      {/* Page 4 — Fees */}
      <PageShell theme={theme}>
        {renderHeader()}
        <PdfSection theme={theme} title="Fees">
          <KeyValueRow
            theme={theme}
            label="Late return fee"
            value={formatCurrency(data.fees.lateFee)}
          />
          <KeyValueRow
            theme={theme}
            label="Fuel shortfall charge"
            value={formatCurrency(data.fees.fuelCharge)}
          />
          <Text
            style={{
              fontSize: theme.size.body,
              color: theme.colors.muted,
              marginTop: theme.spacing.md,
            }}
          >
            Fees are calculated per the rental agreement signed at pickup. Late fees begin after a
            one-hour grace period.
          </Text>
        </PdfSection>
        {renderFooter()}
      </PageShell>

      {/* Page 5 — Pending quote acknowledgment (conditional) */}
      {hasPendingQuotes ? (
        <PageShell theme={theme}>
          {renderHeader()}
          <PdfSection theme={theme} title="Pending quote acknowledgment">
            <Text style={{ fontSize: theme.size.body, lineHeight: 1.5 }}>
              The following damage items require a mechanic&rsquo;s quote. By initialling this
              page, you acknowledge the identified damage and authorise {branding.siteName} to
              charge the payment method on file for the confirmed repair cost up to the cap shown
              beside each item, once the mechanic&rsquo;s quote is finalised. Any amount above the
              cap will not be charged without your further agreement.
            </Text>
            <View style={{ marginTop: theme.spacing.lg }}>
              <PendingQuoteHeader theme={theme} />
              {data.charges
                .filter((c) => c.resolution === "QUOTE_PENDING")
                .map((c, i) => (
                  <View key={`q-${i}`} style={chargeRowStyle(theme)}>
                    <Text style={{ flex: 3, paddingHorizontal: theme.spacing.sm }}>
                      {c.description}
                    </Text>
                    <Text
                      style={{
                        flex: 1,
                        paddingHorizontal: theme.spacing.sm,
                        textAlign: "right",
                      }}
                    >
                      {formatCurrency(c.quoteCapAmount ?? 0)}
                    </Text>
                  </View>
                ))}
            </View>
          </PdfSection>
          {renderFooter()}
        </PageShell>
      ) : null}

      {/* Page 6 — Settlement & bond */}
      <PageShell theme={theme}>
        {renderHeader()}
        <PdfSection theme={theme} title="Settlement summary">
          <KeyValueRow
            theme={theme}
            label="Total due now"
            value={formatCurrency(data.totalDueNow)}
            emphasise
          />
          <KeyValueRow
            theme={theme}
            label="Pending quote cap (not yet charged)"
            value={formatCurrency(data.pendingQuoteCap)}
          />
        </PdfSection>
        <PdfSection theme={theme} title="Bond">
          <KeyValueRow
            theme={theme}
            label="Bond held"
            value={formatCurrency(data.bond.heldAmount)}
          />
          <KeyValueRow
            theme={theme}
            label="Applied to charges"
            value={formatCurrency(data.bond.appliedAmount)}
          />
          <KeyValueRow
            theme={theme}
            label="Released to customer"
            value={formatCurrency(data.bond.releasedAmount)}
          />
          <NoticeCallout theme={theme} title="Card capture" tone="warn">
            Any amount charged above the bond is captured from the card on file at the time of
            signing.
          </NoticeCallout>
        </PdfSection>
        {renderFooter()}
      </PageShell>

      {/* Page 7 — Final signatures */}
      <PageShell theme={theme}>
        {renderHeader()}
        <PdfSection theme={theme} title="Signatures">
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
                label="Staff signature"
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

function ChargesTable({ theme, charges }: { theme: PdfTheme; charges: ChargeLine[] }) {
  const head = StyleSheet.create({
    row: {
      flexDirection: "row",
      backgroundColor: theme.colors.surface,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.divider,
      paddingVertical: theme.spacing.sm,
    },
    cell: {
      paddingHorizontal: theme.spacing.sm,
      fontSize: theme.size.caption,
      fontFamily: theme.font.bodyBold,
      color: theme.colors.muted,
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
  });
  return (
    <View>
      <View style={head.row}>
        <Text style={{ ...head.cell, flex: 3 }}>Item</Text>
        <Text style={{ ...head.cell, flex: 1, textAlign: "right" }}>Resolution</Text>
        <Text style={{ ...head.cell, flex: 1, textAlign: "right" }}>Amount</Text>
      </View>
      {charges.map((c, i) => (
        <View key={`ch-${i}`} style={chargeRowStyle(theme)}>
          <View style={{ flex: 3, paddingHorizontal: theme.spacing.sm }}>
            <Text style={{ fontSize: theme.size.body }}>
              {c.description}
              {c.tariffName ? ` · ${c.tariffName}` : ""}
            </Text>
            <Text style={{ fontSize: theme.size.caption, color: theme.colors.muted }}>
              Severity: {c.severity}
            </Text>
          </View>
          <Text
            style={{
              flex: 1,
              paddingHorizontal: theme.spacing.sm,
              textAlign: "right",
              fontSize: theme.size.body,
            }}
          >
            {c.resolution.replace("_", " ")}
          </Text>
          <Text
            style={{
              flex: 1,
              paddingHorizontal: theme.spacing.sm,
              textAlign: "right",
              fontSize: theme.size.body,
            }}
          >
            {c.resolution === "QUOTE_PENDING"
              ? `up to ${formatCurrency(c.quoteCapAmount ?? 0)}`
              : formatCurrency(c.amount)}
          </Text>
        </View>
      ))}
    </View>
  );
}

function PendingQuoteHeader({ theme }: { theme: PdfTheme }) {
  return (
    <View
      style={{
        flexDirection: "row",
        backgroundColor: theme.colors.surface,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.divider,
        paddingVertical: theme.spacing.sm,
      }}
    >
      <Text
        style={{
          flex: 3,
          paddingHorizontal: theme.spacing.sm,
          fontSize: theme.size.caption,
          fontFamily: theme.font.bodyBold,
          color: theme.colors.muted,
          textTransform: "uppercase",
          letterSpacing: 0.5,
        }}
      >
        Item
      </Text>
      <Text
        style={{
          flex: 1,
          paddingHorizontal: theme.spacing.sm,
          textAlign: "right",
          fontSize: theme.size.caption,
          fontFamily: theme.font.bodyBold,
          color: theme.colors.muted,
          textTransform: "uppercase",
          letterSpacing: 0.5,
        }}
      >
        Acknowledged cap
      </Text>
    </View>
  );
}

function chargeRowStyle(theme: PdfTheme) {
  return {
    flexDirection: "row" as const,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.divider,
    paddingVertical: theme.spacing.sm,
  };
}

function KeyValueRow({
  theme,
  label,
  value,
  emphasise = false,
}: {
  theme: PdfTheme;
  label: string;
  value: string;
  emphasise?: boolean;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.divider,
        paddingVertical: theme.spacing.sm,
      }}
    >
      <Text style={{ flex: 3, paddingHorizontal: theme.spacing.sm, fontSize: theme.size.body }}>
        {label}
      </Text>
      <Text
        style={{
          flex: 1,
          paddingHorizontal: theme.spacing.sm,
          textAlign: "right",
          fontSize: theme.size.body,
          fontFamily: emphasise ? theme.font.bodyBold : theme.font.body,
        }}
      >
        {value}
      </Text>
    </View>
  );
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

const DAMAGE_VIEWS = ["LEFT", "RIGHT", "FRONT", "REAR"] as const;
type DamageView = (typeof DAMAGE_VIEWS)[number];

function DiffDamageMap({
  theme,
  pre,
  now,
}: {
  theme: PdfTheme;
  pre: DamageMarker[];
  now: DamageMarker[];
}) {
  const preBy: Record<DamageView, DamageMarker[]> = {
    LEFT: [],
    RIGHT: [],
    FRONT: [],
    REAR: [],
  };
  const nowBy: Record<DamageView, DamageMarker[]> = {
    LEFT: [],
    RIGHT: [],
    FRONT: [],
    REAR: [],
  };
  for (const m of pre) preBy[m.view ?? "LEFT"].push(m);
  for (const m of now) nowBy[m.view ?? "LEFT"].push(m);

  const severityColour = (severity: string) => {
    if (severity === "MAJOR") return theme.colors.errorInk;
    if (severity === "MODERATE") return theme.colors.alertBorder;
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
              {nowBy[v].length > 0 ? `  ${nowBy[v].length} new` : ""}
            </Text>
            {preBy[v].map((m, i) => (
              <View
                key={`pre-${v}-${i}`}
                style={{
                  position: "absolute",
                  left: `${m.x * 100}%`,
                  top: `${m.y * 100}%`,
                  width: 8,
                  height: 8,
                  marginLeft: -4,
                  marginTop: -4,
                  borderRadius: 8,
                  backgroundColor: theme.colors.faint,
                  opacity: 0.6,
                }}
              />
            ))}
            {nowBy[v].map((m, i) => (
              <View
                key={`now-${v}-${i}`}
                style={{
                  position: "absolute",
                  left: `${m.x * 100}%`,
                  top: `${m.y * 100}%`,
                  width: 10,
                  height: 10,
                  marginLeft: -5,
                  marginTop: -5,
                  borderRadius: 10,
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
