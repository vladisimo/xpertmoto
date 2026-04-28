import { StyleSheet, Text, View } from "@react-pdf/renderer";

import { formatCurrency } from "@/lib/utils";

import type { PdfTheme } from "../theme";

/**
 * Per-line item rendered in the tax invoice / adjustment note table.
 * Amounts are GST-inclusive; the table renders the GST split per line
 * (description / qty / unit ex GST / GST / total incl GST).
 *
 * Pass `negative` for adjustment-note DECREASE lines so the totals
 * column renders the value in parentheses with destructive ink.
 */
export interface PdfLineItem {
  description: string;
  /** Optional second descriptive line (e.g. "Pickup → Return", dates). */
  detail?: string | null;
  quantity: number;
  /** GST-inclusive unit price. */
  unitPrice: number;
  /** GST-inclusive line total. */
  totalPrice: number;
  /** Per-line GST amount (already calculated; defaults to `totalPrice / 11`). */
  gstAmount?: number;
  /** Decrease lines render parenthesised + ink-red. */
  negative?: boolean;
}

export function LineItemsTable({
  theme,
  items,
  showQuantity = true,
}: {
  theme: PdfTheme;
  items: PdfLineItem[];
  /** Hide the Qty column for adjustment notes that are usually 1 × something. */
  showQuantity?: boolean;
}) {
  const styles = StyleSheet.create({
    head: {
      flexDirection: "row",
      backgroundColor: theme.colors.brand,
      paddingVertical: theme.spacing.md,
      paddingHorizontal: theme.spacing.md,
      borderTopLeftRadius: theme.radii.md,
      borderTopRightRadius: theme.radii.md,
    },
    headCell: {
      fontSize: theme.size.caption,
      fontFamily: theme.font.bodyBold,
      color: theme.colors.paper,
      textTransform: "uppercase",
      letterSpacing: 0.6,
    },
    row: {
      flexDirection: "row",
      paddingVertical: theme.spacing.md,
      paddingHorizontal: theme.spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.divider,
    },
    rowAlt: {
      backgroundColor: theme.colors.surface,
    },
    descCell: {
      flex: 4,
      paddingRight: theme.spacing.md,
    },
    desc: {
      fontSize: theme.size.body,
      color: theme.colors.ink,
    },
    detail: {
      fontSize: theme.size.caption,
      color: theme.colors.muted,
      marginTop: 1,
    },
    qtyCell: {
      flex: 1,
      textAlign: "right",
      paddingRight: theme.spacing.md,
      fontSize: theme.size.body,
    },
    moneyCell: {
      flex: 1.4,
      textAlign: "right",
      fontSize: theme.size.body,
    },
    moneyHead: {
      flex: 1.4,
      textAlign: "right",
    },
    qtyHead: {
      flex: 1,
      textAlign: "right",
      paddingRight: theme.spacing.md,
    },
    descHead: {
      flex: 4,
    },
    negative: {
      color: theme.colors.errorInk,
    },
  });

  const formatMoney = (n: number, negative: boolean): string =>
    negative ? `(${formatCurrency(Math.abs(n))})` : formatCurrency(n);

  const subTotal = items.reduce((acc, l) => acc + l.totalPrice, 0);
  void subTotal; // calculated upstream; kept for future per-section subtotal rows

  return (
    <View>
      <View style={styles.head}>
        <Text style={[styles.headCell, styles.descHead]}>Description</Text>
        {showQuantity ? <Text style={[styles.headCell, styles.qtyHead]}>Qty</Text> : null}
        <Text style={[styles.headCell, styles.moneyHead]}>Unit (ex GST)</Text>
        <Text style={[styles.headCell, styles.moneyHead]}>GST 10%</Text>
        <Text style={[styles.headCell, styles.moneyHead]}>Amount (incl GST)</Text>
      </View>

      {items.map((item, i) => {
        const isAlt = i % 2 === 1;
        const gst = item.gstAmount ?? Math.round((item.totalPrice / 11) * 100) / 100;
        const unitExGst = item.quantity > 0 ? item.unitPrice / 1.1 : 0;
        const rowStyle = isAlt ? [styles.row, styles.rowAlt] : styles.row;
        const descStyle = item.negative ? [styles.desc, styles.negative] : styles.desc;
        const qtyStyle = item.negative ? [styles.qtyCell, styles.negative] : styles.qtyCell;
        const moneyStyle = item.negative ? [styles.moneyCell, styles.negative] : styles.moneyCell;
        const moneyTotalStyle = item.negative
          ? [styles.moneyCell, styles.negative, { fontFamily: theme.font.bodyBold }]
          : [styles.moneyCell, { fontFamily: theme.font.bodyBold }];
        return (
          <View key={i} style={rowStyle}>
            <View style={styles.descCell}>
              <Text style={descStyle}>{item.description}</Text>
              {item.detail ? <Text style={styles.detail}>{item.detail}</Text> : null}
            </View>
            {showQuantity ? <Text style={qtyStyle}>{item.quantity}</Text> : null}
            <Text style={moneyStyle}>{formatMoney(unitExGst, false)}</Text>
            <Text style={moneyStyle}>{formatMoney(gst, item.negative ?? false)}</Text>
            <Text style={moneyTotalStyle}>
              {formatMoney(item.totalPrice, item.negative ?? false)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
