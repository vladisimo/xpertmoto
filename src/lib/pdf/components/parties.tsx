import { StyleSheet, Text, View } from "@react-pdf/renderer";

import type { PdfTheme } from "../theme";

export interface SupplierParty {
  legalName: string;
  tradingName?: string | null;
  abn: string;
  postalAddress?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface RecipientParty {
  /** Customer's full name. Always rendered. */
  name: string;
  email?: string | null;
  phone?: string | null;
  /** B2B fields. When `companyName` is set the document is treated as
   * issued to a business and the ABN line below is highlighted. */
  companyName?: string | null;
  abn?: string | null;
  /** Multi-line address; omit lines that are missing. */
  addressLine1?: string | null;
  addressLine2?: string | null;
  suburb?: string | null;
  state?: string | null;
  postcode?: string | null;
  country?: string | null;
}

/**
 * Side-by-side issuer / recipient block, used as the "Bill from / Bill
 * to" header pair on tax invoices and adjustment notes.
 */
export function PartiesBlock({
  theme,
  supplier,
  recipient,
  fromLabel = "Issued by",
  toLabel = "Bill to",
}: {
  theme: PdfTheme;
  supplier: SupplierParty;
  recipient: RecipientParty;
  fromLabel?: string;
  toLabel?: string;
}) {
  const styles = StyleSheet.create({
    wrap: {
      flexDirection: "row",
      gap: theme.spacing.xl,
      marginTop: theme.spacing.md,
    },
    block: {
      flex: 1,
      padding: theme.spacing.lg,
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radii.md,
      borderLeftWidth: 3,
      borderLeftColor: theme.colors.brand,
    },
    label: {
      fontSize: theme.size.caption,
      color: theme.colors.muted,
      textTransform: "uppercase",
      letterSpacing: 0.6,
      marginBottom: theme.spacing.xs,
    },
    name: {
      fontSize: theme.size.h3,
      fontFamily: theme.font.bodyBold,
      color: theme.colors.ink,
      marginBottom: theme.spacing.xs,
    },
    line: {
      fontSize: theme.size.body,
      color: theme.colors.ink,
    },
    abnLine: {
      fontSize: theme.size.body,
      fontFamily: theme.font.bodyBold,
      color: theme.colors.brand,
      marginTop: theme.spacing.xs,
    },
  });

  const recipientAddressLines = [
    recipient.addressLine1,
    recipient.addressLine2,
    [recipient.suburb, recipient.state, recipient.postcode].filter(Boolean).join(" "),
    recipient.country && recipient.country !== "Australia" ? recipient.country : null,
  ].filter(Boolean) as string[];

  return (
    <View style={styles.wrap}>
      {/* Supplier */}
      <View style={styles.block}>
        <Text style={styles.label}>{fromLabel}</Text>
        <Text style={styles.name}>
          {supplier.tradingName ?? supplier.legalName}
        </Text>
        {supplier.tradingName && supplier.tradingName !== supplier.legalName ? (
          <Text style={styles.line}>{supplier.legalName}</Text>
        ) : null}
        {supplier.abn ? <Text style={styles.abnLine}>ABN {supplier.abn}</Text> : null}
        {supplier.postalAddress ? <Text style={styles.line}>{supplier.postalAddress}</Text> : null}
        {supplier.email ? <Text style={styles.line}>{supplier.email}</Text> : null}
        {supplier.phone ? <Text style={styles.line}>{supplier.phone}</Text> : null}
      </View>

      {/* Recipient */}
      <View style={styles.block}>
        <Text style={styles.label}>{toLabel}</Text>
        <Text style={styles.name}>{recipient.companyName ?? recipient.name}</Text>
        {recipient.companyName ? <Text style={styles.line}>Attn: {recipient.name}</Text> : null}
        {recipient.abn ? <Text style={styles.abnLine}>ABN {recipient.abn}</Text> : null}
        {recipient.email ? <Text style={styles.line}>{recipient.email}</Text> : null}
        {recipient.phone ? <Text style={styles.line}>{recipient.phone}</Text> : null}
        {recipientAddressLines.map((line, i) => (
          <Text key={i} style={styles.line}>
            {line}
          </Text>
        ))}
      </View>
    </View>
  );
}
