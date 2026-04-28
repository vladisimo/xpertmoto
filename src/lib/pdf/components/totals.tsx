import { StyleSheet, Text, View } from "@react-pdf/renderer";

import { formatCurrency } from "@/lib/utils";

import type { PdfTheme } from "../theme";

export interface PdfTotalsLine {
  label: string;
  amount: number;
  /** Render with parentheses + destructive ink. */
  negative?: boolean;
  /** Subtle de-emphasis for sub-totals before the grand total. */
  muted?: boolean;
}

/**
 * Right-aligned totals stack used at the bottom of every tax invoice
 * and adjustment note. Always shows: subtotal (ex GST), GST, total
 * (incl GST). Optional rows for "Less amount paid" / "Balance due"
 * passed in as additional lines.
 */
export function PdfTotals({
  theme,
  subtotal,
  gst,
  total,
  totalLabel = "Total (incl GST)",
  extras,
}: {
  theme: PdfTheme;
  subtotal: number;
  gst: number;
  total: number;
  totalLabel?: string;
  extras?: PdfTotalsLine[];
}) {
  const styles = StyleSheet.create({
    wrap: {
      flexDirection: "row",
      justifyContent: "flex-end",
      marginTop: theme.spacing.lg,
    },
    box: {
      minWidth: 240,
      borderWidth: 1,
      borderColor: theme.colors.divider,
      borderRadius: theme.radii.md,
      padding: theme.spacing.lg,
      backgroundColor: theme.colors.paper,
    },
    row: {
      flexDirection: "row",
      justifyContent: "space-between",
      paddingVertical: theme.spacing.xs,
    },
    label: {
      fontSize: theme.size.body,
      color: theme.colors.muted,
    },
    value: {
      fontSize: theme.size.body,
      color: theme.colors.ink,
      textAlign: "right",
    },
    grand: {
      borderTopWidth: 2,
      borderTopColor: theme.colors.brand,
      paddingTop: theme.spacing.md,
      marginTop: theme.spacing.sm,
    },
    grandLabel: {
      fontSize: theme.size.h3,
      fontFamily: theme.font.bodyBold,
      color: theme.colors.ink,
    },
    grandValue: {
      fontSize: theme.size.h3,
      fontFamily: theme.font.bodyBold,
      color: theme.colors.brand,
      textAlign: "right",
    },
    muted: {
      color: theme.colors.muted,
    },
    negative: {
      color: theme.colors.errorInk,
    },
  });

  const fmt = (n: number, negative: boolean) =>
    negative ? `(${formatCurrency(Math.abs(n))})` : formatCurrency(n);

  return (
    <View style={styles.wrap}>
      <View style={styles.box}>
        <View style={styles.row}>
          <Text style={styles.label}>Subtotal (ex GST)</Text>
          <Text style={styles.value}>{formatCurrency(subtotal)}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>GST 10%</Text>
          <Text style={styles.value}>{formatCurrency(gst)}</Text>
        </View>
        <View style={[styles.row, styles.grand]}>
          <Text style={styles.grandLabel}>{totalLabel}</Text>
          <Text style={styles.grandValue}>{formatCurrency(total)}</Text>
        </View>
        {extras?.map((line, i) => {
          const labelStyle = line.muted ? [styles.label, styles.muted] : styles.label;
          // Build the value style by composition; @react-pdf accepts an
          // array of Style objects but rejects nullable entries, so the
          // worst case here is the three-element array.
          const valueStyle =
            line.muted && line.negative
              ? [styles.value, styles.muted, styles.negative]
              : line.muted
                ? [styles.value, styles.muted]
                : line.negative
                  ? [styles.value, styles.negative]
                  : styles.value;
          return (
            <View key={i} style={styles.row}>
              <Text style={labelStyle}>{line.label}</Text>
              <Text style={valueStyle}>{fmt(line.amount, line.negative ?? false)}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}
