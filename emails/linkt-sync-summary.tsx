import { Button, Hr, Section, Text } from "@react-email/components";
import { EmailLayout } from "./_layout";
import { EMAIL_COLORS } from "./tokens";

/**
 * Weekly toll-sync digest for back-office (ADMIN / MANAGER). Replaces the old
 * Sentry "no successful etoll-sync completion" alert with a branded report:
 * all-time headline counts (total tolls; matched vs unmatched to a booking;
 * with vs without a registration plate), the latest sync health, and a table
 * of the last 7 days of tolls (matched or otherwise).
 *
 * All values are pre-formatted strings (dates en-AU, currency via
 * formatCurrency) — the caller does the formatting, per house style.
 */
export type LinktSyncSummaryRow = {
  date: string;
  plate: string; // "—" when no plate/tag was on the trip
  location: string;
  amount: string;
  /** "Matched", "No booking", or "Unmatched". */
  status: string;
  /** Booking reference when matched to a hire, else null. */
  booking: string | null;
};

export type LinktSyncSummaryProps = {
  siteName: string;
  /** Window covered by the table, e.g. "9 Jun – 15 Jun 2026". */
  periodLabel: string;
  // --- Headline (all-time) stats, pre-formatted ---
  totalTolls: string;
  matchedToBooking: string;
  unmatchedToBooking: string;
  withPlate: string;
  withoutPlate: string;
  // --- Latest sync health ---
  /** "SUCCESS" | "PARTIAL" | "FAILED" | null (never synced). */
  lastSyncStatus: string | null;
  /** Already-formatted timestamp (en-AU) of the last finished sync, or null. */
  lastSyncAt: string | null;
  /** SUCCESS with no outstanding backlog → green; otherwise amber. */
  healthy: boolean;
  // --- Last-7-days rows (newest first) ---
  rows: LinktSyncSummaryRow[];
  /** True when more than the cap of rows occurred in the window. */
  truncated: boolean;
  /** Back-office deep-link to the fleet tolls page. */
  portalUrl: string;
};

function StatRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  const border = last ? "none" : `1px solid ${EMAIL_COLORS.border}`;
  return (
    <tr>
      <td
        style={{
          fontSize: 11,
          color: EMAIL_COLORS.textMuted,
          textTransform: "uppercase",
          padding: "10px 14px",
          borderBottom: border,
          width: "58%",
          verticalAlign: "top",
        }}
      >
        {label}
      </td>
      <td
        style={{
          fontSize: 15,
          color: EMAIL_COLORS.textPrimary,
          fontWeight: 700,
          padding: "10px 14px",
          borderBottom: border,
          textAlign: "right",
        }}
      >
        {value}
      </td>
    </tr>
  );
}

const TH: React.CSSProperties = {
  fontSize: 11,
  color: EMAIL_COLORS.textMuted,
  textTransform: "uppercase",
  textAlign: "left",
  padding: "8px 10px",
  borderBottom: `2px solid ${EMAIL_COLORS.border}`,
};

const TD: React.CSSProperties = {
  fontSize: 12,
  color: EMAIL_COLORS.textPrimary,
  padding: "8px 10px",
  borderBottom: `1px solid ${EMAIL_COLORS.border}`,
  verticalAlign: "top",
};

export default function LinktSyncSummary(p: LinktSyncSummaryProps) {
  const synced = p.lastSyncStatus
    ? `Last sync: ${p.lastSyncStatus}${p.lastSyncAt ? ` · ${p.lastSyncAt}` : ""}`
    : "No sync has completed yet.";
  const bannerSurface = p.healthy ? EMAIL_COLORS.successSurface : EMAIL_COLORS.warningSurface;
  const bannerBorder = p.healthy ? EMAIL_COLORS.successBorder : EMAIL_COLORS.warningBorder;
  const bannerText = p.healthy ? EMAIL_COLORS.successText : EMAIL_COLORS.warningText;

  return (
    <EmailLayout
      preview={`Weekly toll summary — ${p.totalTolls} tolls, ${p.unmatchedToBooking} unmatched`}
      eyebrow="Toll reconciliation"
      heading="Weekly toll summary"
    >
      <Text style={{ fontSize: 14, color: EMAIL_COLORS.textPrimary, lineHeight: 1.6 }}>
        Here is the Linkt toll-sync summary for {p.siteName}. The figures below are all-time
        totals; the table covers {p.periodLabel}.
      </Text>

      <Section
        style={{
          backgroundColor: bannerSurface,
          border: `1px solid ${bannerBorder}`,
          borderRadius: 8,
          padding: "10px 14px",
          marginTop: 16,
        }}
      >
        <Text style={{ fontSize: 13, color: bannerText, margin: 0, fontWeight: 600 }}>
          {synced}
        </Text>
      </Section>

      <Section
        style={{
          backgroundColor: EMAIL_COLORS.surface,
          border: `1px solid ${EMAIL_COLORS.border}`,
          borderRadius: 8,
          padding: 0,
          marginTop: 16,
          overflow: "hidden",
        }}
      >
        <table cellPadding={0} cellSpacing={0} style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            <StatRow label="Total tolls" value={p.totalTolls} />
            <StatRow label="Matched to a booking" value={p.matchedToBooking} />
            <StatRow label="Not matched to a booking" value={p.unmatchedToBooking} />
            <StatRow label="With a registration plate" value={p.withPlate} />
            <StatRow label="No registration plate" value={p.withoutPlate} last />
          </tbody>
        </table>
      </Section>

      <Text
        style={{
          fontSize: 12,
          color: EMAIL_COLORS.textMuted,
          textTransform: "uppercase",
          marginTop: 24,
          marginBottom: 8,
          fontWeight: 700,
        }}
      >
        Last 7 days · {p.periodLabel}
      </Text>

      {p.rows.length === 0 ? (
        <Text style={{ fontSize: 13, color: EMAIL_COLORS.textMuted, lineHeight: 1.6 }}>
          No tolls were recorded in this period.
        </Text>
      ) : (
        <table cellPadding={0} cellSpacing={0} style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={TH}>Date</th>
              <th style={TH}>Plate</th>
              <th style={TH}>Location</th>
              <th style={{ ...TH, textAlign: "right" }}>Amount</th>
              <th style={TH}>Status</th>
            </tr>
          </thead>
          <tbody>
            {p.rows.map((r, i) => (
              <tr key={i}>
                <td style={TD}>{r.date}</td>
                <td style={TD}>{r.plate || "—"}</td>
                <td style={TD}>{r.location || "—"}</td>
                <td style={{ ...TD, textAlign: "right", fontWeight: 600 }}>{r.amount}</td>
                <td style={TD}>
                  {r.status}
                  {r.booking ? (
                    <span style={{ color: EMAIL_COLORS.textMuted }}> · {r.booking}</span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {p.truncated ? (
        <Text style={{ fontSize: 12, color: EMAIL_COLORS.textSubtle, lineHeight: 1.5, marginTop: 8 }}>
          Showing the most recent {p.rows.length} tolls — more occurred in this period. View the
          full list in the back office.
        </Text>
      ) : null}

      <Section style={{ textAlign: "center", marginTop: 24 }}>
        <Button
          href={p.portalUrl}
          style={{
            backgroundColor: EMAIL_COLORS.primary,
            color: "#ffffff",
            padding: "12px 24px",
            borderRadius: 6,
            fontSize: 14,
            textDecoration: "none",
          }}
        >
          Open toll reconciliation
        </Button>
      </Section>

      <Hr style={{ borderColor: EMAIL_COLORS.border, marginTop: 24, marginBottom: 12 }} />

      <Text style={{ fontSize: 12, color: EMAIL_COLORS.textSubtle, lineHeight: 1.6 }}>
        Unmatched tolls are trips we could not tie to a vehicle or active hire — usually a missing
        registration plate on the Linkt export, or a toll incurred outside any booking window.
        Resolve them from the toll reconciliation page in the back office.
      </Text>
    </EmailLayout>
  );
}
