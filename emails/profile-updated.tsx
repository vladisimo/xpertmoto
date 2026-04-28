import { Section, Text } from "@react-email/components";
import { EmailLayout } from "./_layout";
import { EMAIL_COLORS } from "./tokens";
import type { ChangeRow } from "@/lib/profile-change-display";

export type ProfileUpdatedProps = {
  customerName: string;
  /** "you" for self-edits, "our team" for staff-driven edits. Drives
   * headline and tone. */
  actor: "you" | "staff";
  /** Optional staff-member name for the staff-driven case. Null when
   * unknown or for self-edits. */
  staffName: string | null;
  changes: ChangeRow[];
  siteName: string;
};

export default function ProfileUpdated(p: ProfileUpdatedProps) {
  const isStaff = p.actor === "staff";
  const heading = isStaff ? "Your profile was updated by our team" : "Profile updated";
  return (
    <EmailLayout
      preview={`Your ${p.siteName} profile was updated`}
      heading={heading}
    >
      <Text style={{ fontSize: 14, color: EMAIL_COLORS.textPrimary, lineHeight: 1.6 }}>
        Hi {p.customerName},{" "}
        {isStaff ? (
          <>
            {p.staffName ? <strong>{p.staffName}</strong> : <>a {p.siteName} staff member</>}{" "}
            has updated the following details on your account:
          </>
        ) : (
          <>this confirms the following changes were just made on your account:</>
        )}
      </Text>

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
        <table
          cellPadding={0}
          cellSpacing={0}
          style={{ width: "100%", borderCollapse: "collapse" }}
        >
          <thead>
            <tr style={{ backgroundColor: EMAIL_COLORS.background }}>
              <th
                style={{
                  fontSize: 11,
                  color: EMAIL_COLORS.textSubtle,
                  textTransform: "uppercase",
                  textAlign: "left",
                  padding: "10px 14px",
                  borderBottom: `1px solid ${EMAIL_COLORS.border}`,
                  width: "30%",
                }}
              >
                Field
              </th>
              <th
                style={{
                  fontSize: 11,
                  color: EMAIL_COLORS.textSubtle,
                  textTransform: "uppercase",
                  textAlign: "left",
                  padding: "10px 14px",
                  borderBottom: `1px solid ${EMAIL_COLORS.border}`,
                  width: "35%",
                }}
              >
                Was
              </th>
              <th
                style={{
                  fontSize: 11,
                  color: EMAIL_COLORS.textSubtle,
                  textTransform: "uppercase",
                  textAlign: "left",
                  padding: "10px 14px",
                  borderBottom: `1px solid ${EMAIL_COLORS.border}`,
                  width: "35%",
                }}
              >
                Now
              </th>
            </tr>
          </thead>
          <tbody>
            {p.changes.map((c, idx) => (
              <tr key={`${c.label}-${idx}`}>
                <td
                  style={{
                    fontSize: 13,
                    color: EMAIL_COLORS.textPrimary,
                    padding: "10px 14px",
                    borderBottom:
                      idx === p.changes.length - 1
                        ? "none"
                        : `1px solid ${EMAIL_COLORS.border}`,
                    fontWeight: 600,
                    verticalAlign: "top",
                  }}
                >
                  {c.label}
                </td>
                <td
                  style={{
                    fontSize: 13,
                    color: EMAIL_COLORS.textMuted,
                    padding: "10px 14px",
                    borderBottom:
                      idx === p.changes.length - 1
                        ? "none"
                        : `1px solid ${EMAIL_COLORS.border}`,
                    verticalAlign: "top",
                    textDecoration: "line-through",
                  }}
                >
                  {c.previous}
                </td>
                <td
                  style={{
                    fontSize: 13,
                    color: EMAIL_COLORS.textPrimary,
                    padding: "10px 14px",
                    borderBottom:
                      idx === p.changes.length - 1
                        ? "none"
                        : `1px solid ${EMAIL_COLORS.border}`,
                    verticalAlign: "top",
                    fontWeight: 600,
                  }}
                >
                  {c.current}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section
        style={{
          backgroundColor: EMAIL_COLORS.warningSurface,
          borderLeft: `4px solid ${EMAIL_COLORS.secondary}`,
          padding: 12,
          marginTop: 16,
        }}
      >
        <Text style={{ fontSize: 13, margin: 0, color: EMAIL_COLORS.warningText, lineHeight: 1.5 }}>
          {isStaff ? (
            <>
              <strong>Wasn&apos;t expecting this?</strong> Reply to this email
              or contact us straight away. We log every change with the staff
              member who made it for your safety.
            </>
          ) : (
            <>
              <strong>Wasn&apos;t you?</strong> Sign in and reset your password
              immediately, then contact us so we can lock your account.
            </>
          )}
        </Text>
      </Section>
    </EmailLayout>
  );
}
