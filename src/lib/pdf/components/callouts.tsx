import { StyleSheet, Text, View } from "@react-pdf/renderer";
import type { ReactNode } from "react";

import { formatCurrency } from "@/lib/utils";

import type { PdfTheme } from "../theme";

/**
 * Amber-tinted information panel used for bond holds, ATO disclosures,
 * "this document adjusts INV-..." reference notes, and other non-line-
 * item context. Use sparingly so each one stands out.
 */
export function NoticeCallout({
  theme,
  title,
  children,
  tone = "info",
}: {
  theme: PdfTheme;
  title?: string;
  children: ReactNode;
  tone?: "info" | "warn" | "success";
}) {
  const accent =
    tone === "warn"
      ? theme.colors.alertBorder
      : tone === "success"
        ? theme.colors.successInk
        : theme.colors.brand;
  const bg =
    tone === "warn" ? theme.colors.alertBg : theme.colors.surface;

  const styles = StyleSheet.create({
    wrap: {
      backgroundColor: bg,
      borderLeftWidth: 3,
      borderLeftColor: accent,
      paddingVertical: theme.spacing.md,
      paddingHorizontal: theme.spacing.lg,
      borderRadius: theme.radii.md,
      marginTop: theme.spacing.lg,
    },
    title: {
      fontSize: theme.size.caption,
      fontFamily: theme.font.bodyBold,
      color: accent,
      textTransform: "uppercase",
      letterSpacing: 0.6,
      marginBottom: theme.spacing.xs,
    },
    body: {
      fontSize: theme.size.body,
      color: theme.colors.ink,
    },
  });
  return (
    <View style={styles.wrap}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      <Text style={styles.body}>{children}</Text>
    </View>
  );
}

/**
 * Bond disclosure shown on rental tax invoices. The bond is NEVER
 * included in the invoice's GST-taxable totals (it's a security hold,
 * not consideration for a supply). This callout makes that explicit.
 */
export function BondNotice({
  theme,
  bondAmount,
  releaseDays = 14,
}: {
  theme: PdfTheme;
  bondAmount: number;
  releaseDays?: number;
}) {
  if (bondAmount <= 0) return null;
  return (
    <NoticeCallout theme={theme} title="Security bond" tone="warn">
      A refundable security hold of {formatCurrency(bondAmount)} is
      authorised against your card. It is not a charge and is not part
      of the GST-taxable totals above. The hold is released in full
      within {releaseDays} days of return less any deductions for damage,
      cleaning, fuel shortfall, late return, infringements, or other
      legitimate charges, each of which is documented as a separate
      adjustment note.
    </NoticeCallout>
  );
}

/**
 * "This adjustment note relates to tax invoice ..." reference, ATO §29-75.
 */
export function AdjustmentRefNotice({
  theme,
  originalInvoiceNumber,
  originalIssuedAt,
  bookingReference,
}: {
  theme: PdfTheme;
  originalInvoiceNumber: string;
  originalIssuedAt: string;
  bookingReference?: string | null;
}) {
  return (
    <NoticeCallout theme={theme} title="Adjusts" tone="info">
      This adjustment note relates to tax invoice{" "}
      <Text style={{ fontFamily: theme.font.bodyBold }}>{originalInvoiceNumber}</Text>{" "}
      issued on {originalIssuedAt}
      {bookingReference ? ` for booking ${bookingReference}` : ""}. It is
      issued under section 29-75 of the A New Tax System (Goods and
      Services Tax) Act 1999 to reflect a change in the consideration
      for the original taxable supply.
    </NoticeCallout>
  );
}

/**
 * Payment instructions block. Renders only when the invoicing config
 * has a non-empty `remittanceDetails`. Conventionally placed above the
 * footer on tax invoices that aren't paid online up-front.
 */
export function RemittanceBlock({
  theme,
  remittanceDetails,
  invoiceNumber,
  amountDue,
  dueDate,
}: {
  theme: PdfTheme;
  remittanceDetails: string;
  invoiceNumber: string;
  amountDue: number;
  dueDate: string | null;
}) {
  if (!remittanceDetails.trim()) return null;
  const styles = StyleSheet.create({
    wrap: {
      marginTop: theme.spacing.xl,
      padding: theme.spacing.lg,
      borderWidth: 1,
      borderColor: theme.colors.divider,
      borderRadius: theme.radii.md,
    },
    label: {
      fontSize: theme.size.caption,
      fontFamily: theme.font.bodyBold,
      color: theme.colors.muted,
      textTransform: "uppercase",
      letterSpacing: 0.6,
      marginBottom: theme.spacing.sm,
    },
    body: {
      fontSize: theme.size.body,
      color: theme.colors.ink,
    },
    meta: {
      flexDirection: "row",
      gap: theme.spacing.xl,
      marginTop: theme.spacing.md,
    },
    metaCell: {
      flex: 1,
    },
    metaLabel: {
      fontSize: theme.size.caption,
      color: theme.colors.muted,
    },
    metaValue: {
      fontSize: theme.size.body,
      fontFamily: theme.font.bodyBold,
      color: theme.colors.ink,
    },
  });
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Payment instructions</Text>
      <Text style={styles.body}>{remittanceDetails}</Text>
      <View style={styles.meta}>
        <View style={styles.metaCell}>
          <Text style={styles.metaLabel}>Reference</Text>
          <Text style={styles.metaValue}>{invoiceNumber}</Text>
        </View>
        <View style={styles.metaCell}>
          <Text style={styles.metaLabel}>Amount due</Text>
          <Text style={styles.metaValue}>{formatCurrency(amountDue)}</Text>
        </View>
        {dueDate ? (
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Due date</Text>
            <Text style={styles.metaValue}>{dueDate}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}
