import { Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { ReactNode } from "react";

import type { PdfTheme } from "../theme";

/**
 * Wraps a single A4 page with the conventional outer margin, base font,
 * and ink colour. Most pages render `<PdfHeader>` then content then
 * `<PdfFooter fixed />` inside this shell.
 */
export function PageShell({
  theme,
  children,
}: {
  theme: PdfTheme;
  children: ReactNode;
}) {
  const styles = StyleSheet.create({
    page: {
      paddingTop: theme.spacing.page,
      paddingBottom: theme.spacing.page + theme.spacing.xxxl, // room for fixed footer
      paddingHorizontal: theme.spacing.page,
      fontSize: theme.size.body,
      fontFamily: theme.font.body,
      color: theme.colors.ink,
      backgroundColor: theme.colors.paper,
      lineHeight: 1.4,
    },
  });
  return (
    <Page size="A4" style={styles.page}>
      {children}
    </Page>
  );
}

/**
 * Section heading + body wrapper used for "Bill to", "Rental details",
 * "Adjustment", "Settlement summary" etc. Provides consistent rhythm
 * (24 above, 12 below) across every PDF.
 */
export function PdfSection({
  theme,
  title,
  eyebrow,
  children,
}: {
  theme: PdfTheme;
  title?: string;
  eyebrow?: string;
  children: ReactNode;
}) {
  const styles = StyleSheet.create({
    section: {
      marginTop: theme.spacing.xxl,
    },
    eyebrow: {
      fontSize: theme.size.caption,
      fontFamily: theme.font.bodyBold,
      color: theme.colors.muted,
      letterSpacing: 0.6,
      textTransform: "uppercase",
      marginBottom: theme.spacing.xs,
    },
    title: {
      fontSize: theme.size.h2,
      fontFamily: theme.font.display,
      color: theme.colors.ink,
      marginBottom: theme.spacing.md,
    },
  });
  return (
    <View style={styles.section}>
      {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {children}
    </View>
  );
}

/**
 * Two-column block — "Bill to" + "Issued by", "Pickup depot" + "Return
 * depot", etc. Each column expands equally.
 */
export function TwoColRow({
  theme,
  children,
}: {
  theme: PdfTheme;
  children: ReactNode;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        gap: theme.spacing.xl,
      }}
    >
      {children}
    </View>
  );
}

export function Col({ children }: { children: ReactNode }) {
  return <View style={{ flex: 1 }}>{children}</View>;
}

/**
 * Compact label + value pair used inside parties / metadata blocks.
 */
export function Field({
  theme,
  label,
  value,
}: {
  theme: PdfTheme;
  label: string;
  value: string | null | undefined;
}) {
  if (!value) return null;
  return (
    <View style={{ marginBottom: theme.spacing.sm }}>
      <Text
        style={{
          fontSize: theme.size.caption,
          color: theme.colors.muted,
          textTransform: "uppercase",
          letterSpacing: 0.5,
        }}
      >
        {label}
      </Text>
      <Text style={{ fontSize: theme.size.bodyLg }}>{value}</Text>
    </View>
  );
}
