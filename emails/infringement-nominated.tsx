import { Button, Hr, Section, Text } from "@react-email/components";
import { EmailLayout } from "./_layout";
import { EMAIL_COLORS } from "./tokens";

export type InfringementNominatedProps = {
  customerName: string;
  bookingReference: string;
  referenceNumber: string;
  /** Human-readable infringement category (e.g. "Speeding", "Toll", "Parking"). */
  type: string;
  issuer: string;
  /** Already-formatted date string (en-AU). */
  offenceDate: string;
  /** Already-formatted currency string for the issuer fine. */
  amount: string;
  /** Already-formatted date string for the issuer's due date, or null. */
  dueDate: string | null;
  /** Customer-portal deep-link to the infringement detail. */
  portalUrl: string;
  siteName: string;

  // --- NSW formal-nomination workflow (all optional; older callers omit) ---
  /** "NOMINATE_DRIVER" (Revenue NSW reissues to the renter) or
   *  "PAY_AND_RECOVER" (we paid and bill the renter). Default pay-and-recover. */
  handling?: "NOMINATE_DRIVER" | "PAY_AND_RECOVER";
  offenceDescription?: string | null;
  offenceLocation?: string | null;
  /** Already-formatted currency string for our administration/handling fee. */
  adminFee?: string | null;
  demeritPoints?: number | null;
  /** Already-formatted statutory nomination deadline (en-AU), if known. */
  nominationDeadline?: string | null;
  /** Masked licence used to nominate, e.g. "NSW ••••1234". */
  licenceMasked?: string | null;
  /** Contact for queries (operator support inbox). */
  supportEmail?: string | null;
};

function Row({
  label,
  value,
  emphasise,
  last,
}: {
  label: string;
  value: string;
  emphasise?: boolean;
  last?: boolean;
}) {
  const border = last ? "none" : `1px solid ${EMAIL_COLORS.warningBorder}`;
  return (
    <tr>
      <td
        style={{
          fontSize: 11,
          color: EMAIL_COLORS.warningAccentText,
          textTransform: "uppercase",
          padding: "10px 14px",
          borderBottom: border,
          width: "42%",
          verticalAlign: "top",
        }}
      >
        {label}
      </td>
      <td
        style={{
          fontSize: emphasise ? 16 : 13,
          color: emphasise ? EMAIL_COLORS.warningAccentText : EMAIL_COLORS.warningText,
          padding: "10px 14px",
          borderBottom: border,
          fontWeight: emphasise ? 700 : 600,
        }}
      >
        {value}
      </td>
    </tr>
  );
}

export default function InfringementNominated(p: InfringementNominatedProps) {
  const handling = p.handling ?? "PAY_AND_RECOVER";
  const isNominate = handling === "NOMINATE_DRIVER";
  const points = p.demeritPoints ?? 0;

  return (
    <EmailLayout
      preview={`Action required: ${p.type} infringement ${p.referenceNumber}`}
      heading="Infringement during your hire"
    >
      <Text style={{ fontSize: 14, color: EMAIL_COLORS.textPrimary, lineHeight: 1.6 }}>
        Hi {p.customerName}, {p.issuer} issued a {p.type.toLowerCase()} infringement that
        occurred during your hire on booking{" "}
        <strong style={{ color: EMAIL_COLORS.primary }}>{p.bookingReference}</strong>. Our
        records identify you as the driver responsible at the time of the offence.
      </Text>

      <Section
        style={{
          backgroundColor: EMAIL_COLORS.warningSurface,
          border: `1px solid ${EMAIL_COLORS.warningBorder}`,
          borderRadius: 8,
          padding: 0,
          marginTop: 16,
          overflow: "hidden",
        }}
      >
        <table cellPadding={0} cellSpacing={0} style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            <Row label="Reference" value={p.referenceNumber} />
            <Row label="Issuer" value={p.issuer} />
            {p.offenceDescription ? <Row label="Offence" value={p.offenceDescription} /> : null}
            {p.offenceLocation ? <Row label="Location" value={p.offenceLocation} /> : null}
            <Row label="Offence date" value={p.offenceDate} />
            <Row label="Fine amount" value={p.amount} emphasise />
            {p.adminFee ? <Row label="Handling fee" value={p.adminFee} /> : null}
            {points > 0 ? <Row label="Demerit points" value={String(points)} /> : null}
            {p.dueDate ? <Row label="Pay by" value={p.dueDate} /> : null}
            {p.nominationDeadline ? (
              <Row label="Nomination deadline" value={p.nominationDeadline} last />
            ) : null}
          </tbody>
        </table>
      </Section>

      {isNominate ? (
        <Text style={{ fontSize: 13, color: EMAIL_COLORS.textPrimary, lineHeight: 1.6, marginTop: 18 }}>
          As the registered operator of the vehicle, we are formally nominating you to{" "}
          {p.issuer} as the driver responsible for this offence. Once that nomination is
          processed, the penalty notice{points > 0 ? " and the demerit points" : ""} will be
          <strong> reissued to you directly</strong>, and you will be liable to pay {p.issuer}
          {" "}using the reference above.
          {p.adminFee ? ` We have applied a handling fee of ${p.adminFee} to your booking for processing this nomination.` : ""}
        </Text>
      ) : (
        <Text style={{ fontSize: 13, color: EMAIL_COLORS.textPrimary, lineHeight: 1.6, marginTop: 18 }}>
          Under your hire agreement you are responsible for infringements incurred during your
          booking. We have charged the fine{p.adminFee ? ` plus a ${p.adminFee} handling fee` : ""}
          {" "}to your booking. You can review and pay this through your customer portal.
        </Text>
      )}

      {p.licenceMasked ? (
        <Text style={{ fontSize: 12, color: EMAIL_COLORS.textMuted, lineHeight: 1.5, marginTop: 12 }}>
          The driver licence we hold for you ({p.licenceMasked}) was used for this nomination. If
          any of these details are wrong, or you were not the driver, contact us immediately —
          see below.
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
          View infringement
        </Button>
      </Section>

      <Hr style={{ borderColor: EMAIL_COLORS.border, marginTop: 24, marginBottom: 12 }} />

      <Text style={{ fontSize: 12, color: EMAIL_COLORS.textSubtle, lineHeight: 1.6 }}>
        <strong>If you were not the driver, or believe this is an error:</strong> you have the
        right to have this reviewed. Contact {p.issuer} using the reference number above, and let
        us know{p.supportEmail ? ` at ${p.supportEmail}` : ""} as soon as possible
        {p.nominationDeadline ? `, and no later than ${p.nominationDeadline}` : ""} so the
        nomination can be corrected before the statutory deadline. Acting on a nomination that is
        wrong can have serious consequences, so please check the details carefully.
      </Text>
      <Text style={{ fontSize: 12, color: EMAIL_COLORS.textSubtle, lineHeight: 1.6, marginTop: 8 }}>
        This notice is sent by {p.siteName} in relation to your hire. It is not the penalty
        notice itself — {p.issuer} is the issuing authority.
      </Text>
    </EmailLayout>
  );
}
