import { render } from "@react-email/render";
import { createElement, type ReactElement } from "react";

/**
 * Registry of the **code-defined** React Email templates that live in
 * `emails/*.tsx`. These are rendered in code at send time (via
 * `sendEmail({ react })` / `render(createElement(...))`) and have no
 * `NotificationTemplate` row in the database — so they don't appear in the
 * DB-backed templates list on their own.
 *
 * This registry surfaces them in the back-office templates page as read-only
 * entries (preview-only; edited in code). Each entry carries display metadata
 * plus a `render()` that mounts the component with representative sample props
 * so staff can preview the design. Sample values are illustrative only — live
 * sends pass real data and resolve branding via `getBranding()`.
 *
 * When you add a new template under `emails/`, add an entry here so it shows
 * up in the catalogue.
 */

export type CodeTemplateCategory =
  | "TRANSACTIONAL"
  | "ACCOUNT"
  | "OPERATIONAL"
  | "MARKETING";

export type CodeTemplateMeta = {
  /** Stable identifier — matches the `emails/<key>.tsx` filename. */
  key: string;
  name: string;
  description: string;
  /** Source file, so developers know where to edit. */
  file: string;
  category: CodeTemplateCategory;
  /** Channels this template renders for — these are all HTML email templates. */
  channels: ("EMAIL" | "SMS" | "PUSH" | "IN_APP")[];
};

type CodeTemplateEntry = CodeTemplateMeta & {
  /** Mount the component with representative sample props. */
  render: () => Promise<ReactElement>;
};

const SITE = "XPERT Moto";
const PORTAL = "https://example.com/dashboard";
const SAMPLE_DATE = "Sat 25 Apr 2026, 10:00 AM";

const ENTRIES: CodeTemplateEntry[] = [
  // ---- Booking lifecycle (transactional) ----
  {
    key: "booking-confirmation",
    name: "Booking confirmation",
    description: "Sent when a booking is confirmed — vehicle, pickup, pricing breakdown and portal link.",
    file: "emails/booking-confirmation.tsx",
    category: "TRANSACTIONAL",
    channels: ["EMAIL"],
    render: async () =>
      createElement((await import("../../../emails/booking-confirmation")).default, {
        customerName: "Alex Rider",
        bookingReference: "XPM-2026-000123",
        categoryName: "Scooter — 125cc",
        pickupDepotName: "Brisbane CBD",
        pickupDepotAddress: "12 Edward St, Brisbane QLD 4000",
        pickupDateTime: SAMPLE_DATE,
        returnDateTime: "Tue 28 Apr 2026, 10:00 AM",
        durationDays: 3,
        totalAmount: "A$420.00",
        paidOnline: "A$420.00",
        dueAtPickup: null,
        bondAmount: "A$500.00",
        recurringSummary: null,
        portalUrl: PORTAL,
        siteName: SITE,
      }),
  },
  {
    key: "booking-reminder",
    name: "Booking reminder (24h)",
    description: "Pre-pickup reminder sent the day before the hire starts.",
    file: "emails/booking-reminder.tsx",
    category: "TRANSACTIONAL",
    channels: ["EMAIL"],
    render: async () =>
      createElement((await import("../../../emails/booking-reminder")).default, {
        customerName: "Alex Rider",
        bookingReference: "XPM-2026-000123",
        pickupDepotName: "Brisbane CBD",
        pickupDepotAddress: "12 Edward St, Brisbane QLD 4000",
        pickupDateTime: SAMPLE_DATE,
        categoryName: "Scooter — 125cc",
        siteName: SITE,
      }),
  },
  {
    key: "booking-modified",
    name: "Booking modified",
    description: "Sent when a booking's dates change (e.g. an extension).",
    file: "emails/booking-modified.tsx",
    category: "TRANSACTIONAL",
    channels: ["EMAIL"],
    render: async () =>
      createElement((await import("../../../emails/booking-modified")).default, {
        customerName: "Alex Rider",
        bookingReference: "XPM-2026-000123",
        previousReturn: "Sat 25 Apr 2026, 10:00 AM",
        newReturn: "Mon 27 Apr 2026, 10:00 AM",
        extensionDays: 2,
        extensionCharge: "A$280.00",
      }),
  },
  {
    key: "booking-cancelled",
    name: "Booking cancelled",
    description: "Cancellation confirmation with refund / admin-fee / bond breakdown.",
    file: "emails/booking-cancelled.tsx",
    category: "TRANSACTIONAL",
    channels: ["EMAIL"],
    render: async () =>
      createElement((await import("../../../emails/booking-cancelled")).default, {
        customerName: "Alex Rider",
        bookingReference: "XPM-2026-000123",
        refundAmount: "A$395.00",
        refundPct: 100,
        adminFee: "A$25.00",
        bondReleasedAmount: "A$500.00",
        reason: "Change of plans",
        cancelledBy: "you",
      }),
  },
  {
    key: "booking-checked-out",
    name: "Vehicle checked out",
    description: "Confirmation that the vehicle has been picked up, with odometer + fuel.",
    file: "emails/booking-checked-out.tsx",
    category: "TRANSACTIONAL",
    channels: ["EMAIL"],
    render: async () =>
      createElement((await import("../../../emails/booking-checked-out")).default, {
        customerName: "Alex Rider",
        bookingReference: "XPM-2026-000123",
        vehicleLabel: "Honda PCX 150 · 123-AB4",
        pickupAt: SAMPLE_DATE,
        expectedReturnAt: "Tue 28 Apr 2026, 10:00 AM",
        pickupOdometerKm: 4210,
        fuelLevel: 100,
        staffName: "Jordan Lee",
      }),
  },
  {
    key: "booking-returned",
    name: "Vehicle returned",
    description: "End-of-rental summary with final balance and bond status.",
    file: "emails/booking-returned.tsx",
    category: "TRANSACTIONAL",
    channels: ["EMAIL"],
    render: async () =>
      createElement((await import("../../../emails/booking-returned")).default, {
        customerName: "Alex Rider",
        bookingReference: "XPM-2026-000123",
        returnedAt: "Tue 28 Apr 2026, 09:45 AM",
        returnOdometerKm: 4560,
        fuelLevel: 90,
        finalBalance: null,
        bondReleased: "A$500.00",
        hasPendingQuote: false,
      }),
  },
  {
    key: "vehicle-swap",
    name: "Vehicle swap",
    description: "Sent when a booking's vehicle is swapped, with any price adjustment.",
    file: "emails/vehicle-swap.tsx",
    category: "TRANSACTIONAL",
    channels: ["EMAIL"],
    render: async () =>
      createElement((await import("../../../emails/vehicle-swap")).default, {
        customerName: "Alex Rider",
        bookingReference: "XPM-2026-000123",
        incomingVehicleLabel: "Honda PCX 150 · 123-AB4",
        reason: "mechanical fault",
        direction: "NONE",
        deltaAmount: null,
        gstAmount: null,
        refundFallbackToCredit: false,
      }),
  },
  {
    key: "overdue-notice",
    name: "Overdue notice",
    description: "Late-return warning describing the hourly late fee.",
    file: "emails/overdue-notice.tsx",
    category: "OPERATIONAL",
    channels: ["EMAIL"],
    render: async () =>
      createElement((await import("../../../emails/overdue-notice")).default, {
        customerName: "Alex Rider",
        bookingReference: "XPM-2026-000123",
        expectedReturn: "Tue 28 Apr 2026, 10:00 AM",
        lateFeePerHour: "A$17.50",
      }),
  },

  // ---- Payment & finance ----
  {
    key: "payment-receipt",
    name: "Payment receipt",
    description: "Receipt for a successful payment.",
    file: "emails/payment-receipt.tsx",
    category: "TRANSACTIONAL",
    channels: ["EMAIL"],
    render: async () =>
      createElement((await import("../../../emails/payment-receipt")).default, {
        customerName: "Alex Rider",
        bookingReference: "XPM-2026-000123",
        amount: "A$420.00",
        paymentType: "Booking payment",
        paidAt: SAMPLE_DATE,
      }),
  },
  {
    key: "invoice-issued",
    name: "Invoice issued",
    description: "Notifies the customer that a tax invoice is available.",
    file: "emails/invoice-issued.tsx",
    category: "TRANSACTIONAL",
    channels: ["EMAIL"],
    render: async () =>
      createElement((await import("../../../emails/invoice-issued")).default, {
        customerName: "Alex Rider",
        invoiceNumber: "INV-2026-000123",
        bookingReference: "XPM-2026-000123",
        amount: "A$420.00",
        dueDate: "Fri 02 May 2026",
        invoiceUrl: `${PORTAL}/invoices/INV-2026-000123`,
      }),
  },
  {
    key: "adjustment-note-issued",
    name: "Adjustment note issued",
    description: "Credit / debit note notification against an existing invoice.",
    file: "emails/adjustment-note-issued.tsx",
    category: "TRANSACTIONAL",
    channels: ["EMAIL"],
    render: async () =>
      createElement((await import("../../../emails/adjustment-note-issued")).default, {
        customerName: "Alex Rider",
        adjustmentNumber: "ADJ-2026-000045",
        direction: "credit",
        reason: "REFUND",
        totalAmount: "A$80.00",
        bookingReference: "XPM-2026-000123",
        originalInvoiceNumber: "INV-2026-000123",
        description: "Partial refund for unused hire day.",
      }),
  },
  {
    key: "bond-released",
    name: "Bond released",
    description: "Confirms the security deposit has been released back to the card.",
    file: "emails/bond-released.tsx",
    category: "TRANSACTIONAL",
    channels: ["EMAIL"],
    render: async () =>
      createElement((await import("../../../emails/bond-released")).default, {
        customerName: "Alex Rider",
        bookingReference: "XPM-2026-000123",
        amount: "A$500.00",
      }),
  },
  {
    key: "debt-reminder",
    name: "Debt reminder",
    description: "Outstanding-balance reminder across bookings, invoices and infringements.",
    file: "emails/debt-reminder.tsx",
    category: "OPERATIONAL",
    channels: ["EMAIL"],
    render: async () =>
      createElement((await import("../../../emails/debt-reminder")).default, {
        customerName: "Alex Rider",
        totalOwed: "A$150.00",
        bookingDebt: "A$100.00",
        invoiceDebt: "A$50.00",
        infringementDebt: null,
        portalUrl: PORTAL,
        siteName: SITE,
      }),
  },
  {
    key: "gift-card-received",
    name: "Gift card received",
    description: "Sent to a gift-card recipient with their code and redeem link.",
    file: "emails/gift-card-received.tsx",
    category: "TRANSACTIONAL",
    channels: ["EMAIL"],
    render: async () =>
      createElement((await import("../../../emails/gift-card-received")).default, {
        recipientName: "Sam Taylor",
        amount: "A$100.00",
        code: "XPM-GIFT-7F3K",
        personalMessage: "Happy birthday — enjoy the ride!",
        redeemUrl: `${PORTAL}/gift-cards/redeem`,
        siteName: SITE,
      }),
  },
  {
    key: "infringement-nominated",
    name: "Infringement nominated",
    description: "Notifies the hirer of a toll / fine and how it's being handled.",
    file: "emails/infringement-nominated.tsx",
    category: "OPERATIONAL",
    channels: ["EMAIL"],
    render: async () =>
      createElement((await import("../../../emails/infringement-nominated")).default, {
        customerName: "Alex Rider",
        bookingReference: "XPM-2026-000123",
        referenceNumber: "INF-2026-000012",
        type: "Toll",
        issuer: "Linkt",
        offenceDate: "Mon 20 Apr 2026",
        amount: "A$4.20",
        dueDate: "Mon 18 May 2026",
        portalUrl: `${PORTAL}/infringements/INF-2026-000012`,
        siteName: SITE,
      }),
  },

  // ---- Account & auth ----
  {
    key: "magic-link",
    name: "Magic sign-in link",
    description: "Passwordless sign-in link.",
    file: "emails/magic-link.tsx",
    category: "ACCOUNT",
    channels: ["EMAIL"],
    render: async () =>
      createElement((await import("../../../emails/magic-link")).default, {
        url: "https://example.com/auth/callback?token=sample",
        expiresInMinutes: 15,
        email: "a•••@example.com",
        siteName: SITE,
      }),
  },
  {
    key: "password-reset",
    name: "Password reset",
    description: "Time-limited password reset link.",
    file: "emails/password-reset.tsx",
    category: "ACCOUNT",
    channels: ["EMAIL"],
    render: async () =>
      createElement((await import("../../../emails/password-reset")).default, {
        url: "https://example.com/reset?token=sample",
        expiresInMinutes: 30,
        email: "a•••@example.com",
        siteName: SITE,
      }),
  },
  {
    key: "staff-invite",
    name: "Staff invite",
    description: "Invitation for a new back-office team member to set up their account.",
    file: "emails/staff-invite.tsx",
    category: "ACCOUNT",
    channels: ["EMAIL"],
    render: async () =>
      createElement((await import("../../../emails/staff-invite")).default, {
        url: "https://example.com/staff/accept-invite?token=sample",
        email: "jordan@example.com",
        inviterName: "Casey Morgan",
        roleLabel: "Manager",
        expiresInHours: 48,
        siteName: SITE,
      }),
  },
  {
    key: "customer-welcome",
    name: "Customer welcome",
    description: "Onboarding email for a newly registered customer.",
    file: "emails/customer-welcome.tsx",
    category: "ACCOUNT",
    channels: ["EMAIL"],
    render: async () =>
      createElement((await import("../../../emails/customer-welcome")).default, {
        customerName: "Alex Rider",
        siteName: SITE,
        fleetUrl: "https://example.com/fleet",
        signInUrl: "https://example.com/login",
      }),
  },
  {
    key: "profile-updated",
    name: "Profile updated",
    description: "Security notice listing what changed on a customer's profile.",
    file: "emails/profile-updated.tsx",
    category: "ACCOUNT",
    channels: ["EMAIL"],
    render: async () =>
      createElement((await import("../../../emails/profile-updated")).default, {
        customerName: "Alex Rider",
        actor: "you",
        staffName: null,
        changes: [
          { label: "Phone", previous: "0400 000 000", current: "0411 111 111" },
          { label: "Address", previous: "(empty)", current: "1 Test St, Brisbane QLD" },
        ],
        siteName: SITE,
      }),
  },

  // ---- Support ----
  {
    key: "support-ticket-assigned",
    name: "Support ticket assigned",
    description: "Internal notification that a support ticket was assigned to an agent.",
    file: "emails/support-ticket-assigned.tsx",
    category: "OPERATIONAL",
    channels: ["EMAIL"],
    render: async () =>
      createElement((await import("../../../emails/support-ticket-assigned")).default, {
        ticketNumber: "SUP-2026-000087",
        category: "Billing",
        priority: "Normal",
        customerName: "Alex Rider",
        summary: "Question about my final invoice",
        description: "I think I was charged twice for the bond — can you check?",
        depotName: "Brisbane CBD",
        portalUrl: `${PORTAL}/support/SUP-2026-000087`,
      }),
  },
  {
    key: "support-ticket-urgent",
    name: "Support ticket — urgent",
    description: "Escalation page for an urgent support ticket.",
    file: "emails/support-ticket-urgent.tsx",
    category: "OPERATIONAL",
    channels: ["EMAIL"],
    render: async () =>
      createElement((await import("../../../emails/support-ticket-urgent")).default, {
        ticketNumber: "SUP-2026-000088",
        category: "Roadside",
        priority: "Urgent",
        customerName: "Alex Rider",
        summary: "Broken down on the M1",
        description: "Engine warning light, pulled over safely, need assistance.",
        depotName: "Gold Coast",
        portalUrl: `${PORTAL}/support/SUP-2026-000088`,
      }),
  },
  {
    key: "support-ticket-customer-reply",
    name: "Support ticket — customer reply",
    description: "Sent to the customer when staff reply on their ticket.",
    file: "emails/support-ticket-customer-reply.tsx",
    category: "OPERATIONAL",
    channels: ["EMAIL"],
    render: async () =>
      createElement((await import("../../../emails/support-ticket-customer-reply")).default, {
        ticketNumber: "SUP-2026-000087",
        customerName: "Alex Rider",
        replyBody: "Thanks for getting in touch — we've refunded the duplicate bond hold.",
        portalUrl: `${PORTAL}/support/SUP-2026-000087`,
      }),
  },
  {
    key: "support-ticket-resolved",
    name: "Support ticket resolved",
    description: "Confirms a support ticket has been closed, with a feedback link.",
    file: "emails/support-ticket-resolved.tsx",
    category: "OPERATIONAL",
    channels: ["EMAIL"],
    render: async () =>
      createElement((await import("../../../emails/support-ticket-resolved")).default, {
        ticketNumber: "SUP-2026-000087",
        customerName: "Alex Rider",
        summary: "Question about my final invoice",
        feedbackUrl: `${PORTAL}/support/SUP-2026-000087/feedback`,
        siteName: SITE,
      }),
  },

  // ---- Marketing & lifecycle ----
  {
    key: "cart-recovery",
    name: "Abandoned cart recovery",
    description: "Re-engagement email for an abandoned booking (3-stage drip).",
    file: "emails/cart-recovery.tsx",
    category: "MARKETING",
    channels: ["EMAIL"],
    render: async () =>
      createElement((await import("../../../emails/cart-recovery")).default, {
        stage: "DISCOUNT",
        customerName: "Alex Rider",
        bookingReference: "XPM-2026-000123",
        categoryName: "Scooter — 125cc",
        pickupDepotName: "Brisbane CBD",
        pickupDateTime: SAMPLE_DATE,
        totalAmount: "A$420.00",
        checkoutUrl: `${PORTAL}/checkout/resume`,
        discountCode: "COMEBACK10",
        discountPercent: 10,
      }),
  },
  {
    key: "post-trip-review",
    name: "Post-trip review",
    description: "Feedback request after a completed hire, with review + referral CTAs.",
    file: "emails/post-trip-review.tsx",
    category: "MARKETING",
    channels: ["EMAIL"],
    render: async () =>
      createElement((await import("../../../emails/post-trip-review")).default, {
        customerName: "Alex Rider",
        bookingReference: "XPM-2026-000123",
        categoryName: "Scooter — 125cc",
        depotName: "Brisbane CBD",
        reviewUrl: `${PORTAL}/reviews/new`,
        nextBookingDiscountCode: "RIDEAGAIN15",
        nextBookingDiscountPct: 15,
        giftCardUrl: `${PORTAL}/gift-cards`,
        referralCode: "ALEX-REF",
        referralUrl: `${PORTAL}/refer/ALEX-REF`,
        referralReward: "A$25.00",
        siteName: SITE,
      }),
  },
];

/** Catalogue metadata for every code template, sorted by category then name. */
export function listCodeTemplates(): CodeTemplateMeta[] {
  return ENTRIES.map(({ render: _render, ...meta }) => meta).sort(
    (a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name),
  );
}

export function getCodeTemplate(key: string): CodeTemplateEntry | undefined {
  return ENTRIES.find((e) => e.key === key);
}

/**
 * Render a code template to HTML with its sample props, for a read-only
 * preview. Returns `null` when the key is unknown.
 */
export async function renderCodeTemplatePreview(
  key: string,
): Promise<{ meta: CodeTemplateMeta; html: string } | null> {
  const entry = getCodeTemplate(key);
  if (!entry) return null;
  const { render: renderEntry, ...meta } = entry;
  const html = await render(await renderEntry());
  return { meta, html };
}
