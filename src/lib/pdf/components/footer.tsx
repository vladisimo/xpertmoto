import { StyleSheet, Text, View } from "@react-pdf/renderer";

import type { PdfTheme } from "../theme";

/**
 * Fixed footer rendered on every page. Shows supplier identity, contact
 * details, optional invoice footer text (operator-editable), and a
 * "Page X of Y" counter that's auto-rendered by `@react-pdf/renderer`
 * via the `render` prop on a `<Text>` node.
 */
export function PdfFooter({
  theme,
  legalName,
  abn,
  supportEmail,
  supportPhone,
  postalAddress,
  /** Free-text block from `org.invoiceFooter`. Rendered above the meta line when non-empty. */
  invoiceFooter,
}: {
  theme: PdfTheme;
  legalName: string;
  abn: string;
  supportEmail: string | null;
  supportPhone: string | null;
  postalAddress: string | null;
  invoiceFooter?: string;
}) {
  const styles = StyleSheet.create({
    wrap: {
      position: "absolute",
      bottom: theme.spacing.xxl,
      left: theme.spacing.page,
      right: theme.spacing.page,
      borderTopWidth: 1,
      borderTopColor: theme.colors.divider,
      paddingTop: theme.spacing.md,
    },
    footerNote: {
      fontSize: theme.size.caption,
      color: theme.colors.muted,
      marginBottom: theme.spacing.xs,
    },
    metaRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-end",
    },
    metaLeft: {
      flex: 1,
      fontSize: theme.size.micro,
      color: theme.colors.faint,
    },
    metaRight: {
      fontSize: theme.size.micro,
      color: theme.colors.faint,
    },
  });

  const supplierLine = [
    legalName,
    abn ? `ABN ${abn}` : null,
    postalAddress,
  ]
    .filter(Boolean)
    .join(" · ");
  const contactLine = [supportEmail, supportPhone].filter(Boolean).join(" · ");

  return (
    <View style={styles.wrap} fixed>
      {invoiceFooter ? <Text style={styles.footerNote}>{invoiceFooter}</Text> : null}
      <View style={styles.metaRow}>
        <Text style={styles.metaLeft}>
          {supplierLine}
          {contactLine ? `\n${contactLine}` : ""}
        </Text>
        <Text
          style={styles.metaRight}
          render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
        />
      </View>
    </View>
  );
}
