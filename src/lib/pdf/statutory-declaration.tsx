import { Document, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";

import { getBranding } from "@/lib/branding";
import {
  nomineeAddressLine,
  nomineeFullName,
  type NominationArtefactInput,
} from "@/server/services/nomination-artefacts";

import { Col, Field, PageShell, PdfSection, TwoColRow } from "./components/page-shell";
import { resolvePdfLogoSrc } from "./logo-resolver";
import { makePdfTheme, type PdfTheme } from "./theme";

/**
 * Pre-filled NSW statutory declaration nominating the driver of a vehicle for
 * a penalty notice (Road Transport Act 2013 s.186; Oaths Act 1900 (NSW) s.27A
 * statutory declaration). The registered operator's authorised officer signs
 * before a witness — online audio-visual witnessing is permitted under Oaths
 * Act 1900 (NSW) s.14G — and the signed document is mailed to Revenue NSW.
 *
 * Every nominee/offence field is pre-filled from the immutable submission
 * snapshot; the declarant, signature, date, and witness blocks are left blank
 * to be completed at signing. LEGAL: the exact declaration wording must be
 * reviewed/approved by the operator's solicitor before live use.
 */
export async function renderStatutoryDeclarationPdf(
  input: NominationArtefactInput,
): Promise<Buffer> {
  const branding = await getBranding();
  const theme = makePdfTheme(branding);
  const logoUrl = resolvePdfLogoSrc(branding);

  const fullName = nomineeFullName(input.nominee);
  const address = nomineeAddressLine(input.nominee);
  const licence = [
    input.nominee.licenceNumber,
    input.nominee.licenceState ?? input.nominee.licenceCountry,
  ]
    .filter(Boolean)
    .join("  ·  ");
  const dob = input.nominee.dob
    ? input.nominee.dob.toLocaleDateString("en-AU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        timeZone: "Australia/Sydney",
      })
    : "";
  const offenceDate = input.offenceDate.toLocaleString("en-AU", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Australia/Sydney",
  });

  return renderToBuffer(
    <Document
      title={`Statutory declaration — nomination — ${input.penaltyNoticeNumber}`}
    >
      <PageShell theme={theme}>
        <BrandBand
          theme={theme}
          logoUrl={logoUrl}
          brandName={branding.siteName}
          legalName={branding.legalName}
          abn={branding.abn}
        />

        <PdfSection theme={theme} eyebrow="Oaths Act 1900 (NSW)" title="Statutory Declaration">
          <Text style={{ fontSize: theme.size.body, color: theme.colors.muted }}>
            Nomination of the responsible driver of a vehicle for a penalty notice,
            under section 186 of the Road Transport Act 2013 (NSW).
          </Text>
        </PdfSection>

        <PdfSection theme={theme} title="Penalty notice">
          <TwoColRow theme={theme}>
            <Col>
              <Field theme={theme} label="Penalty notice number" value={input.penaltyNoticeNumber} />
              <Field theme={theme} label="Issuing authority" value={input.issuer} />
              <Field theme={theme} label="Vehicle registration" value={input.vehicleRego} />
            </Col>
            <Col>
              <Field theme={theme} label="Offence date / time" value={offenceDate} />
              <Field theme={theme} label="Offence" value={input.offenceDescription ?? input.offenceCode ?? "—"} />
              <Field theme={theme} label="Location" value={input.offenceLocation ?? "—"} />
            </Col>
          </TwoColRow>
        </PdfSection>

        <PdfSection theme={theme} title="Nominated driver">
          <TwoColRow theme={theme}>
            <Col>
              <Field theme={theme} label="Full name" value={fullName || "—"} />
              <Field theme={theme} label="Date of birth" value={dob || "—"} />
            </Col>
            <Col>
              <Field theme={theme} label="Driver licence" value={licence || "—"} />
              <Field theme={theme} label="Residential address" value={address || "—"} />
            </Col>
          </TwoColRow>
        </PdfSection>

        <PdfSection theme={theme} title="Declaration">
          <Text style={{ fontSize: theme.size.body, lineHeight: 1.6 }}>
            I, the authorised officer of {branding.legalName} (ABN {branding.abn}), the
            registered operator of the vehicle described above, sincerely declare that at
            the date and time of the offence the vehicle was being driven by, or was in the
            possession of, the nominated driver named above, and that the particulars of
            that person set out in this declaration are true and correct to the best of my
            knowledge and belief.
          </Text>
          <Text
            style={{
              fontSize: theme.size.caption,
              color: theme.colors.muted,
              marginTop: theme.spacing.md,
              lineHeight: 1.5,
            }}
          >
            I make this solemn declaration conscientiously believing it to be true, and by
            virtue of the Oaths Act 1900 (NSW). I understand that a person who makes a false
            statement in a statutory declaration is guilty of an offence.
          </Text>
        </PdfSection>

        <SigningBlocks theme={theme} />

        <FixedFooter theme={theme} legalName={branding.legalName} abn={branding.abn} reference={input.penaltyNoticeNumber} />
      </PageShell>
    </Document>,
  );
}

function BrandBand({
  theme,
  logoUrl: _logoUrl,
  brandName,
  legalName,
  abn,
}: {
  theme: PdfTheme;
  logoUrl: string | null;
  brandName: string;
  legalName: string;
  abn: string;
}) {
  const styles = StyleSheet.create({
    wrap: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
      paddingBottom: theme.spacing.lg,
      borderBottomWidth: 2,
      borderBottomColor: theme.colors.brand,
    },
    wordmark: { fontSize: theme.size.doc, fontFamily: theme.font.display, color: theme.colors.brand },
    legalLine: { fontSize: theme.size.caption, color: theme.colors.muted, marginTop: theme.spacing.xs },
    docType: {
      fontSize: theme.size.h3,
      fontFamily: theme.font.bodyBold,
      textTransform: "uppercase",
      letterSpacing: 0.6,
      color: theme.colors.ink,
    },
  });
  return (
    <View style={styles.wrap} fixed>
      <View style={{ flex: 1 }}>
        <Text style={styles.wordmark}>{brandName}</Text>
        <Text style={styles.legalLine}>
          {legalName}
          {abn ? ` · ABN ${abn}` : ""}
        </Text>
      </View>
      <Text style={styles.docType}>Statutory Declaration</Text>
    </View>
  );
}

function SigningBlocks({ theme }: { theme: PdfTheme }) {
  const styles = StyleSheet.create({
    blank: {
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.ink,
      height: 18,
      marginTop: theme.spacing.xl,
    },
    label: {
      fontSize: theme.size.caption,
      color: theme.colors.muted,
      marginTop: theme.spacing.xs,
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    note: {
      fontSize: theme.size.micro,
      color: theme.colors.faint,
      marginTop: theme.spacing.md,
      lineHeight: 1.5,
    },
  });
  return (
    <PdfSection theme={theme} title="Signatures">
      <TwoColRow theme={theme}>
        <Col>
          <Text style={{ fontSize: theme.size.caption, fontFamily: theme.font.bodyBold }}>Declarant (authorised officer)</Text>
          <View style={styles.blank} />
          <Text style={styles.label}>Signature</Text>
          <View style={styles.blank} />
          <Text style={styles.label}>Full name &amp; position</Text>
          <View style={styles.blank} />
          <Text style={styles.label}>Place &amp; date of declaration</Text>
        </Col>
        <Col>
          <Text style={{ fontSize: theme.size.caption, fontFamily: theme.font.bodyBold }}>Witness</Text>
          <View style={styles.blank} />
          <Text style={styles.label}>Signature</Text>
          <View style={styles.blank} />
          <Text style={styles.label}>Full name &amp; qualification (JP / lawyer / authorised witness)</Text>
          <View style={styles.blank} />
          <Text style={styles.label}>Date</Text>
        </Col>
      </TwoColRow>
      <Text style={styles.note}>
        If witnessed remotely, the witness must confirm the declarant&apos;s identity and the
        document should bear the notation: &quot;This declaration was signed and witnessed
        by audio-visual link in accordance with s 14G of the Oaths Act 1900 (NSW).&quot; Mail
        the signed original to Revenue NSW before the nomination deadline.
      </Text>
    </PdfSection>
  );
}

function FixedFooter({
  theme,
  legalName,
  abn,
  reference,
}: {
  theme: PdfTheme;
  legalName: string;
  abn: string;
  reference: string;
}) {
  const styles = StyleSheet.create({
    wrap: {
      position: "absolute",
      bottom: theme.spacing.xxl,
      left: theme.spacing.page,
      right: theme.spacing.page,
      flexDirection: "row",
      justifyContent: "space-between",
      borderTopWidth: 1,
      borderTopColor: theme.colors.divider,
      paddingTop: theme.spacing.md,
    },
    line: { fontSize: theme.size.micro, color: theme.colors.faint },
  });
  return (
    <View style={styles.wrap} fixed>
      <Text style={styles.line}>
        {legalName}
        {abn ? ` · ABN ${abn}` : ""} · Penalty notice {reference}
      </Text>
      <Text
        style={styles.line}
        render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
      />
    </View>
  );
}
