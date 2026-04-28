import { Image, StyleSheet, Text, View } from "@react-pdf/renderer";

import type { PdfTheme } from "../theme";

/**
 * The shared document header. Logo on the left, document type + number
 * + issue date on the right, divider line below.
 *
 * `logoUrl` is fetched from `branding.logoWideUrl` at the call site.
 * Pass `null` to fall back to a text wordmark using `siteName`.
 */
export function PdfHeader({
  theme,
  logoUrl,
  siteName,
  legalName,
  abn,
  documentType,
  documentNumber,
  issueLabel,
  issueDate,
  contextNote,
}: {
  theme: PdfTheme;
  logoUrl: string | null;
  siteName: string;
  legalName: string;
  abn: string;
  /** "Tax invoice", "Adjustment note", "Receipt", "Rental agreement". */
  documentType: string;
  documentNumber: string | null;
  /** Defaults to "Issued". Set to "Date" for receipts, etc. */
  issueLabel?: string;
  /** Pre-formatted en-AU date string. */
  issueDate: string;
  /** Optional second line beneath the document number — eg "Booking SCT-12345" or "Adjusts INV-2026-000099". */
  contextNote?: string;
}) {
  const styles = StyleSheet.create({
    wrap: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
      paddingBottom: theme.spacing.lg,
      borderBottomWidth: 2,
      borderBottomColor: theme.colors.brand,
      marginBottom: theme.spacing.xl,
    },
    leftCol: {
      flex: 1,
      flexDirection: "column",
      gap: theme.spacing.xs,
    },
    logo: {
      maxWidth: 180,
      maxHeight: 56,
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
      fontSize: theme.size.h2,
      fontFamily: theme.font.display,
      textTransform: "uppercase",
      letterSpacing: 0.8,
      color: theme.colors.ink,
    },
    docNumber: {
      fontSize: theme.size.h3,
      fontFamily: theme.font.bodyBold,
      color: theme.colors.brand,
    },
    metaRow: {
      flexDirection: "row",
      gap: theme.spacing.md,
      alignItems: "baseline",
    },
    metaLabel: {
      fontSize: theme.size.caption,
      color: theme.colors.muted,
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    metaValue: {
      fontSize: theme.size.body,
      color: theme.colors.ink,
    },
    contextNote: {
      fontSize: theme.size.caption,
      color: theme.colors.muted,
    },
  });

  return (
    <View style={styles.wrap}>
      <View style={styles.leftCol}>
        {logoUrl ? (
          <Image src={logoUrl} style={styles.logo} />
        ) : (
          <Text style={styles.wordmark}>{siteName}</Text>
        )}
        <Text style={styles.legalLine}>
          {legalName}
          {abn ? ` · ABN ${abn}` : ""}
        </Text>
      </View>
      <View style={styles.rightCol}>
        <Text style={styles.docType}>{documentType}</Text>
        {documentNumber ? <Text style={styles.docNumber}>{documentNumber}</Text> : null}
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>{issueLabel ?? "Issued"}</Text>
          <Text style={styles.metaValue}>{issueDate}</Text>
        </View>
        {contextNote ? <Text style={styles.contextNote}>{contextNote}</Text> : null}
      </View>
    </View>
  );
}
