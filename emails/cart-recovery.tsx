import { Text, Section, Button, Hr } from "@react-email/components";
import { EmailLayout } from "./_layout";
import { EMAIL_COLORS } from "./tokens";

export type CartRecoveryStage = "HOLD" | "DISCOUNT" | "LAST_CHANCE";

export type CartRecoveryProps = {
  stage: CartRecoveryStage;
  customerName: string;
  bookingReference: string;
  categoryName: string;
  pickupDepotName: string;
  pickupDateTime: string;
  totalAmount: string;
  checkoutUrl: string;
  discountCode?: string;
  discountPercent?: number;
};

const STAGE_COPY: Record<
  CartRecoveryStage,
  { preview: string; heading: string; lead: string; cta: string; tone: string; tail?: string }
> = {
  HOLD: {
    preview: "Your scooter is still held — complete in a few taps.",
    heading: "Your scooter is waiting",
    lead: "We're still holding your vehicle, but you haven't finished checking out. Tap below to complete your booking in under a minute.",
    cta: "Finish booking",
    tone: EMAIL_COLORS.primary,
  },
  DISCOUNT: {
    preview: "Take 10% off — code inside, expires in 1 hour.",
    heading: "Here's 10% off — on us",
    lead: "Still thinking it over? We've popped a one-time discount on your quote. Use the code below to lock it in.",
    cta: "Apply discount & book",
    tone: EMAIL_COLORS.secondary,
    tail: "Your code expires in 1 hour.",
  },
  LAST_CHANCE: {
    preview: "Last chance — we release your scooter soon.",
    heading: "Last chance to keep your scooter",
    lead: "We'll release your scooter to another rider soon. If you still want it, this is the moment.",
    cta: "Complete booking now",
    tone: EMAIL_COLORS.errorText,
  },
};

export default function CartRecoveryEmail(p: CartRecoveryProps) {
  const copy = STAGE_COPY[p.stage];
  return (
    <EmailLayout preview={copy.preview} heading={`${copy.heading}, ${p.customerName}`}>
      <Text style={{ fontSize: 14, color: EMAIL_COLORS.textPrimary, lineHeight: 1.6 }}>{copy.lead}</Text>

      <Section
        style={{
          backgroundColor: EMAIL_COLORS.surface,
          border: `1px solid ${EMAIL_COLORS.border}`,
          borderRadius: 8,
          padding: 16,
          marginTop: 16,
        }}
      >
        <Text style={{ fontSize: 13, margin: 0 }}>
          <strong>Booking:</strong> {p.bookingReference}
          <br />
          <strong>Vehicle:</strong> {p.categoryName}
          <br />
          <strong>Pickup:</strong> {p.pickupDateTime} — {p.pickupDepotName}
          <br />
          <strong>Total:</strong> {p.totalAmount}
        </Text>
      </Section>

      {p.discountCode ? (
        <Section
          style={{
            backgroundColor: EMAIL_COLORS.warningSurface,
            border: `2px dashed ${copy.tone}`,
            borderRadius: 8,
            padding: 16,
            marginTop: 16,
            textAlign: "center",
          }}
        >
          <Text style={{ fontSize: 11, color: EMAIL_COLORS.warningAccentText, textTransform: "uppercase", margin: 0 }}>
            Your discount code
          </Text>
          <Text
            style={{
              fontSize: 22,
              fontWeight: 700,
              color: copy.tone,
              letterSpacing: 2,
              margin: "4px 0",
            }}
          >
            {p.discountCode}
          </Text>
          {p.discountPercent ? (
            <Text style={{ fontSize: 12, color: EMAIL_COLORS.warningText, margin: 0 }}>
              Takes {p.discountPercent}% off this booking.
            </Text>
          ) : null}
        </Section>
      ) : null}

      <Section style={{ textAlign: "center", marginTop: 24 }}>
        <Button
          href={p.checkoutUrl}
          style={{
            backgroundColor: copy.tone,
            color: EMAIL_COLORS.surface,
            padding: "12px 24px",
            borderRadius: 6,
            fontSize: 14,
            textDecoration: "none",
          }}
        >
          {copy.cta}
        </Button>
      </Section>

      {copy.tail ? (
        <>
          <Hr style={{ borderColor: EMAIL_COLORS.border, margin: "24px 0 12px" }} />
          <Text style={{ fontSize: 12, color: EMAIL_COLORS.textSubtle }}>{copy.tail}</Text>
        </>
      ) : null}
    </EmailLayout>
  );
}
