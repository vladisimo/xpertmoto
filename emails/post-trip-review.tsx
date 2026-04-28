import { Text, Section, Button, Hr, Row, Column } from "@react-email/components";
import { EmailLayout } from "./_layout";
import { EMAIL_COLORS } from "./tokens";

export type PostTripReviewProps = {
  customerName: string;
  bookingReference: string;
  categoryName: string;
  depotName: string;
  reviewUrl: string;
  nextBookingDiscountCode: string;
  nextBookingDiscountPct: number;
  giftCardUrl: string;
  referralCode?: string;
  referralUrl?: string;
  referralReward?: string;
  siteName: string;
};

/**
 * Lever 5 + Lever 10 combined email. Sent ~24 hours after a booking
 * transitions to COMPLETED. Triple-header: review prompt, next-booking
 * discount, referral code. We bundle them into one send because the
 * post-trip moment is the highest-emotion touchpoint and stacking the
 * CTAs here is higher-converting than fragmenting them across emails.
 */
export default function PostTripReviewEmail(p: PostTripReviewProps) {
  return (
    <EmailLayout
      preview={`Thanks for riding, ${p.customerName} — leave a review in 30 seconds.`}
      heading={`Thanks for riding with us, ${p.customerName}! 🛵`}
    >
      <Text style={{ fontSize: 14, color: EMAIL_COLORS.textPrimary, lineHeight: 1.6 }}>
        How was your {p.categoryName} hire ({p.bookingReference}) at our{" "}
        <strong>{p.depotName}</strong> depot?
      </Text>

      {/* Review prompt — primary ask */}
      <Section
        style={{
          backgroundColor: EMAIL_COLORS.successSurface,
          borderRadius: 8,
          padding: 20,
          marginTop: 16,
          textAlign: "center",
        }}
      >
        <Text style={{ fontSize: 16, fontWeight: 600, color: EMAIL_COLORS.successText, margin: 0 }}>
          ⭐ Leave a review in 30 seconds
        </Text>
        <Text style={{ fontSize: 13, color: EMAIL_COLORS.successText, margin: "8px 0 16px" }}>
          It genuinely helps other riders — and helps us keep doing what we do.
        </Text>
        <Button
          href={p.reviewUrl}
          style={{
            backgroundColor: EMAIL_COLORS.primary,
            color: "#ffffff",
            padding: "10px 20px",
            borderRadius: 6,
            fontSize: 14,
            textDecoration: "none",
          }}
        >
          Rate your ride
        </Button>
      </Section>

      <Hr style={{ borderColor: EMAIL_COLORS.border, margin: "28px 0 16px" }} />

      {/* Next-booking discount */}
      <Section
        style={{
          backgroundColor: EMAIL_COLORS.warningSurface,
          border: `2px dashed ${EMAIL_COLORS.secondary}`,
          borderRadius: 8,
          padding: 16,
          marginTop: 8,
          textAlign: "center",
        }}
      >
        <Text style={{ fontSize: 11, color: EMAIL_COLORS.warningAccentText, textTransform: "uppercase", margin: 0 }}>
          Book again — save {p.nextBookingDiscountPct}%
        </Text>
        <Text
          style={{
            fontSize: 22,
            fontWeight: 700,
            color: EMAIL_COLORS.warningAccentText,
            letterSpacing: 2,
            margin: "4px 0",
          }}
        >
          {p.nextBookingDiscountCode}
        </Text>
        <Text style={{ fontSize: 12, color: EMAIL_COLORS.warningText, margin: 0 }}>
          Valid 60 days. Applies to any category at any depot.
        </Text>
      </Section>

      <Hr style={{ borderColor: EMAIL_COLORS.border, margin: "28px 0 16px" }} />

      {/* Referral + gift card split */}
      <Row>
        <Column style={{ padding: "0 8px" }}>
          <Text style={{ fontSize: 12, color: EMAIL_COLORS.textSubtle, textTransform: "uppercase", margin: 0 }}>
            Share &amp; earn
          </Text>
          {p.referralCode && p.referralUrl ? (
            <>
              <Text style={{ fontSize: 13, margin: "4px 0 8px", color: EMAIL_COLORS.textPrimary }}>
                Refer a mate — they get {p.referralReward ?? "$20 off"} and so do you.
              </Text>
              <Text
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: EMAIL_COLORS.primary,
                  fontFamily: "monospace",
                  margin: "0 0 8px",
                }}
              >
                {p.referralCode}
              </Text>
              <a
                href={p.referralUrl}
                style={{
                  color: EMAIL_COLORS.primary,
                  textDecoration: "underline",
                  fontSize: 13,
                }}
              >
                Copy referral link
              </a>
            </>
          ) : null}
        </Column>
        <Column style={{ padding: "0 8px" }}>
          <Text style={{ fontSize: 12, color: EMAIL_COLORS.textSubtle, textTransform: "uppercase", margin: 0 }}>
            Gift a ride
          </Text>
          <Text style={{ fontSize: 13, margin: "4px 0 8px", color: EMAIL_COLORS.textPrimary }}>
            Know someone visiting the coast? A {p.siteName} gift card lands in their
            inbox, ready to ride.
          </Text>
          <a
            href={p.giftCardUrl}
            style={{
              color: EMAIL_COLORS.primary,
              textDecoration: "underline",
              fontSize: 13,
            }}
          >
            Send a gift card →
          </a>
        </Column>
      </Row>
    </EmailLayout>
  );
}
