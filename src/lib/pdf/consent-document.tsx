import { Document, Image, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";

import { getBranding } from "@/lib/branding";
import { interpolateConsentBody } from "@/lib/consent-documents";

import { PageShell } from "./components/page-shell";
import { resolvePdfLogoSrc } from "./logo-resolver";
import { makePdfTheme, type PdfTheme } from "./theme";

/**
 * Customer-signed consent document — Terms, Privacy, Cancellation, or
 * Marketing. The customer's signature appears on a fixed footer of every
 * page so each rendered page stands alone as evidence of consent. The
 * generic `<PdfFooter>` is therefore not used here; this document needs
 * its own fixed footer with the signature stamp.
 */
export interface ConsentPdfInput {
  title: string;
  version: string;
  /** Plain-text body. Blank lines split paragraphs. */
  body: string;
  customerFullName: string;
  /** PNG data-URL or HTTP URL for the customer's signature. */
  signatureUrl: string;
  signedAt: Date;
  /** Optional brand override. Default: branding.siteName. */
  brandName?: string;
  /** Optional legal-name override. Default: branding.legalName. */
  legalName?: string;
  /** Optional ABN override. Default: branding.abn. */
  abn?: string;
  /**
   * Marketing flow only — renders the chosen channels above the
   * signature so the signed PDF is a self-contained record of the
   * opt-in state at signing time.
   */
  marketingChoices?: { email: boolean; sms: boolean };
}

export async function renderConsentDocumentPdf(input: ConsentPdfInput): Promise<Buffer> {
  const branding = await getBranding();
  const theme = makePdfTheme(branding);
  const logoUrl = resolvePdfLogoSrc(branding);

  const merged: Required<Pick<ConsentPdfInput, "brandName" | "legalName" | "abn">> & ConsentPdfInput = {
    ...input,
    brandName: input.brandName ?? branding.siteName,
    legalName: input.legalName ?? branding.legalName,
    abn: input.abn ?? branding.abn,
    body: interpolateConsentBody(input.body, {
      siteName: branding.siteName,
      legalName: branding.legalName,
      abn: branding.abn,
      supportEmail: branding.supportEmail,
      privacyEmail: branding.privacyEmail,
    }),
  };

  const paragraphs = splitParagraphs(merged.body);
  const signedAtIso = merged.signedAt.toISOString();
  const signedAtLocal = merged.signedAt.toLocaleString("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Australia/Brisbane",
  });

  return renderToBuffer(
    <Document>
      <PageShell theme={theme}>
        <ConsentBrandBand
          theme={theme}
          logoUrl={logoUrl}
          brandName={merged.brandName}
          legalName={merged.legalName}
          abn={merged.abn}
          title={merged.title}
          version={merged.version}
          signedAtLocal={signedAtLocal}
        />

        <Text
          style={{
            fontSize: theme.size.h1,
            fontFamily: theme.font.display,
            color: theme.colors.ink,
            marginTop: theme.spacing.lg,
            marginBottom: theme.spacing.xl,
          }}
        >
          {merged.title}
        </Text>

        {paragraphs.map((p, i) => (
          <Text
            key={`p-${i}`}
            style={{
              fontSize: theme.size.body,
              lineHeight: 1.5,
              marginBottom: theme.spacing.md,
            }}
          >
            {p}
          </Text>
        ))}

        {merged.marketingChoices ? (
          <MarketingChoicesBlock theme={theme} choices={merged.marketingChoices} />
        ) : null}

        <SignatureBlock
          theme={theme}
          fullName={merged.customerFullName}
          signatureUrl={merged.signatureUrl}
          signedAtLocal={signedAtLocal}
          signedAtIso={signedAtIso}
        />

        <ConsentFixedFooter
          theme={theme}
          legalName={merged.legalName}
          abn={merged.abn}
          title={merged.title}
          version={merged.version}
          customerFullName={merged.customerFullName}
          signatureUrl={merged.signatureUrl}
          signedAtLocal={signedAtLocal}
          signedAtIso={signedAtIso}
        />
      </PageShell>
    </Document>,
  );
}

function splitParagraphs(body: string): string[] {
  return body
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+\n\s+/g, " ").trim())
    .filter((p) => p.length > 0);
}

function ConsentBrandBand({
  theme,
  logoUrl,
  brandName,
  legalName,
  abn,
  title,
  version,
  signedAtLocal,
}: {
  theme: PdfTheme;
  logoUrl: string | null;
  brandName: string;
  legalName: string;
  abn: string;
  title: string;
  version: string;
  signedAtLocal: string;
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
    leftCol: {
      flex: 1,
      gap: theme.spacing.xs,
    },
    logo: {
      maxWidth: 160,
      maxHeight: 48,
      objectFit: "contain",
    },
    wordmark: {
      fontSize: theme.size.doc,
      fontFamily: theme.font.display,
      color: theme.colors.brand,
    },
    legalLine: {
      fontSize: theme.size.caption,
      color: theme.colors.muted,
    },
    rightCol: {
      alignItems: "flex-end",
      gap: theme.spacing.xs,
    },
    docType: {
      fontSize: theme.size.h3,
      fontFamily: theme.font.bodyBold,
      textTransform: "uppercase",
      letterSpacing: 0.6,
      color: theme.colors.ink,
    },
    meta: {
      fontSize: theme.size.caption,
      color: theme.colors.muted,
    },
  });

  return (
    <View style={styles.wrap} fixed>
      <View style={styles.leftCol}>
        {logoUrl ? (
          <Image src={logoUrl} style={styles.logo} />
        ) : (
          <Text style={styles.wordmark}>{brandName}</Text>
        )}
        <Text style={styles.legalLine}>
          {legalName}
          {abn ? ` · ABN ${abn}` : ""}
        </Text>
      </View>
      <View style={styles.rightCol}>
        <Text style={styles.docType}>{title}</Text>
        <Text style={styles.meta}>{version}</Text>
        <Text style={styles.meta}>{signedAtLocal}</Text>
      </View>
    </View>
  );
}

function MarketingChoicesBlock({
  theme,
  choices,
}: {
  theme: PdfTheme;
  choices: { email: boolean; sms: boolean };
}) {
  const styles = StyleSheet.create({
    wrap: {
      marginTop: theme.spacing.xl,
      padding: theme.spacing.lg,
      borderWidth: 1,
      borderColor: theme.colors.divider,
      borderRadius: theme.radii.md,
      backgroundColor: theme.colors.surface,
    },
    title: {
      fontSize: theme.size.caption,
      fontFamily: theme.font.bodyBold,
      color: theme.colors.muted,
      textTransform: "uppercase",
      letterSpacing: 0.6,
      marginBottom: theme.spacing.sm,
    },
    line: {
      fontSize: theme.size.body,
      color: theme.colors.ink,
    },
  });
  return (
    <View style={styles.wrap} wrap={false}>
      <Text style={styles.title}>Recorded channel preferences</Text>
      <Text style={styles.line}>
        Marketing emails: {choices.email ? "YES — opt-in" : "NO"}
      </Text>
      <Text style={styles.line}>
        Marketing SMS: {choices.sms ? "YES — opt-in" : "NO"}
      </Text>
    </View>
  );
}

function SignatureBlock({
  theme,
  fullName,
  signatureUrl,
  signedAtLocal,
  signedAtIso,
}: {
  theme: PdfTheme;
  fullName: string;
  signatureUrl: string;
  signedAtLocal: string;
  signedAtIso: string;
}) {
  const styles = StyleSheet.create({
    wrap: {
      marginTop: theme.spacing.xxxl,
      borderTopWidth: 1,
      borderTopColor: theme.colors.divider,
      paddingTop: theme.spacing.lg,
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
    },
    signature: {
      width: 180,
      height: 64,
      objectFit: "contain",
      marginTop: theme.spacing.sm,
    },
    accepted: {
      fontSize: theme.size.caption,
      color: theme.colors.muted,
      marginTop: theme.spacing.sm,
    },
  });
  return (
    <View style={styles.wrap} wrap={false}>
      <Text style={styles.label}>Signed by</Text>
      <Text style={styles.name}>{fullName}</Text>
      <Image src={signatureUrl} style={styles.signature} />
      <Text style={styles.accepted}>
        Accepted at {signedAtLocal} AEST ({signedAtIso})
      </Text>
    </View>
  );
}

function ConsentFixedFooter({
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
  signatureUrl: string;
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
      <View style={styles.rightCol}>
        <Image src={signatureUrl} style={styles.sigStamp} />
        <Text style={styles.line}>Signed by {customerFullName}</Text>
        <Text style={styles.line}>{signedAtLocal} AEST</Text>
        <Text style={styles.line}>{signedAtIso}</Text>
      </View>
    </View>
  );
}
