/**
 * Upserts all notification templates from the authoritative definitions in
 * `prisma/seed.ts` without wiping the rest of the database. Use this after
 * editing a template body or the HTML shell to apply changes to an
 * already-populated dev or staging database.
 *
 * Run: `npx tsx scripts/update-notification-templates.ts`
 */
import { PrismaClient, type NotificationType, type NotificationCategory, type NotificationChannel } from "@prisma/client";
import { paragraphs, renderEmailShell, summaryTable } from "../src/lib/email-shell";

const prisma = new PrismaClient();

type Def = {
  key: string;
  type: NotificationType;
  category: NotificationCategory;
  name: string;
  description: string;
  channels: NotificationChannel[];
  subject: string | null;
  bodyTemplate: string;
  emailBodyHtml?: string;
  variables: string[];
};

/**
 * Single source of truth for notification-template content. Kept in sync
 * with `prisma/seed.ts` by import rather than duplication would require a
 * seed refactor; for now, this file carries the same list and both paths
 * upsert the same rows. If you change one, change the other.
 */
const templateDefs: Def[] = [
  {
    key: "booking-confirmation",
    type: "BOOKING_CONFIRMATION",
    category: "TRANSACTIONAL",
    name: "Booking confirmed",
    description: "Sent when a booking is paid and confirmed.",
    channels: ["EMAIL", "SMS"],
    subject: "Your booking {{bookingReference}} is confirmed",
    bodyTemplate:
      "Hi {{firstName}}, your {{siteName}} booking {{bookingReference}} is confirmed. Pickup {{pickupAt}} at {{depotName}}, return {{returnAt}}. Total A${{totalAud}}.",
    emailBodyHtml: renderEmailShell({
      preheader: "Pickup {{pickupAt}} at {{depotName}}",
      eyebrow: "Booking confirmed",
      title: "You're booked in, {{firstName}}!",
      body:
        paragraphs("Thanks for booking with {{siteName}}. We've locked in your ride and we'll see you at pickup.") +
        summaryTable([
          { label: "Reference", value: "{{bookingReference}}" },
          { label: "Pickup", value: "{{pickupAt}}" },
          { label: "Return", value: "{{returnAt}}" },
          { label: "Depot", value: "{{depotName}}" },
          { label: "Total (inc. GST)", value: "A${{totalAud}}" },
        ]) +
        paragraphs("Bring your physical driver's licence and a helmet if you have one (we'll provide one if you don't)."),
      cta: { label: "View booking", url: "{{appUrl}}/dashboard/bookings" },
      ctaFootnote: "Need to change anything? Reply to this email or contact {{supportEmail}}.",
    }),
    variables: ["firstName", "bookingReference", "pickupAt", "returnAt", "depotName", "totalAud"],
  },
  {
    key: "booking-reminder",
    type: "BOOKING_REMINDER",
    category: "TRANSACTIONAL",
    name: "Booking reminder (24h)",
    description: "Pickup reminder sent 24 hours before the booking starts.",
    channels: ["EMAIL", "SMS"],
    subject: "See you tomorrow — {{bookingReference}}",
    bodyTemplate:
      "Hi {{firstName}}, reminder: your {{siteName}} pickup is tomorrow at {{pickupAt}} at {{depotName}}. Don't forget your licence!",
    emailBodyHtml: renderEmailShell({
      preheader: "Pickup tomorrow at {{pickupAt}}",
      eyebrow: "See you tomorrow",
      title: "Your ride starts in 24 hours",
      body:
        paragraphs("Hi {{firstName}}, just a heads-up that your {{siteName}} pickup is tomorrow. Here's everything you'll need:") +
        summaryTable([
          { label: "Reference", value: "{{bookingReference}}" },
          { label: "When", value: "{{pickupAt}}" },
          { label: "Where", value: "{{depotName}}" },
        ]) +
        paragraphs("Bring your <strong>physical driver's licence</strong> — we can't legally hire without it. Running late or need to reschedule? Tap below."),
      cta: { label: "Manage booking", url: "{{appUrl}}/dashboard/bookings" },
    }),
    variables: ["firstName", "bookingReference", "pickupAt", "depotName"],
  },
  {
    key: "payment-received",
    type: "PAYMENT_RECEIVED",
    category: "TRANSACTIONAL",
    name: "Payment received",
    description: "Sent on successful Stripe charge.",
    channels: ["EMAIL"],
    subject: "Payment received — {{paymentReference}}",
    bodyTemplate:
      "Hi {{firstName}}, we've received your payment of A${{amountAud}}. Reference: {{paymentReference}}.",
    emailBodyHtml: renderEmailShell({
      preheader: "A${{amountAud}} received. Reference {{paymentReference}}",
      eyebrow: "Payment received",
      title: "Thanks, {{firstName}}!",
      body:
        paragraphs("We've received your payment. Keep this email as a record — an official tax invoice is available in your account.") +
        summaryTable([
          { label: "Amount", value: "A${{amountAud}}" },
          { label: "Reference", value: "{{paymentReference}}" },
        ]),
      cta: { label: "View receipts", url: "{{appUrl}}/dashboard/documents" },
    }),
    variables: ["firstName", "amountAud", "paymentReference"],
  },
  {
    key: "invoice-issued",
    type: "INVOICE_ISSUED",
    category: "TRANSACTIONAL",
    name: "Invoice issued",
    description: "Attached PDF invoice.",
    channels: ["EMAIL"],
    subject: "Invoice {{invoiceNumber}} from {{siteName}}",
    bodyTemplate:
      "Hi {{firstName}}, your {{siteName}} invoice {{invoiceNumber}} for A${{totalAud}} is attached.",
    emailBodyHtml: renderEmailShell({
      preheader: "Invoice {{invoiceNumber}} · A${{totalAud}}",
      eyebrow: "Invoice issued",
      title: "Invoice {{invoiceNumber}}",
      body:
        paragraphs("Hi {{firstName}}, your tax invoice is attached to this email for your records. The total includes GST.") +
        summaryTable([
          { label: "Invoice", value: "{{invoiceNumber}}" },
          { label: "Amount", value: "A${{totalAud}}" },
        ]) +
        paragraphs("Any questions about charges? Reply to this email or contact {{supportEmail}}."),
      cta: { label: "View all invoices", url: "{{appUrl}}/dashboard/documents" },
    }),
    variables: ["firstName", "invoiceNumber", "totalAud"],
  },
  {
    key: "bond-released",
    type: "BOND_RELEASED",
    category: "TRANSACTIONAL",
    name: "Bond released",
    description: "Sent when the bond hold is released back to the customer.",
    channels: ["EMAIL"],
    subject: "Your {{siteName}} bond has been released",
    bodyTemplate:
      "Hi {{firstName}}, good news — your A${{amount}} bond hold for booking {{bookingReference}} has been released.",
    emailBodyHtml: renderEmailShell({
      preheader: "A${{amount}} returned to your card",
      eyebrow: "Bond released",
      title: "Your bond is back on your card",
      body:
        paragraphs("Hi {{firstName}}, your bond hold from booking {{bookingReference}} has been released. Depending on your bank it can take 3–5 business days to clear.") +
        summaryTable([
          { label: "Bond released", value: "A${{amount}}" },
          { label: "Booking", value: "{{bookingReference}}" },
        ]) +
        paragraphs("Thanks for riding with us. We hope to see you again soon."),
      cta: { label: "Book your next ride", url: "{{appUrl}}/fleet" },
    }),
    variables: ["firstName", "amount", "bookingReference"],
  },
  {
    key: "lease-agreement-copy",
    type: "LEASE_AGREEMENT_COPY",
    category: "TRANSACTIONAL",
    name: "Lease agreement copy",
    description: "On-demand copy of the signed rental agreement.",
    channels: ["EMAIL"],
    subject: "Copy of your rental agreement — {{bookingReference}}",
    bodyTemplate:
      "Hi {{firstName}}, attached is a copy of your signed rental agreement for booking {{bookingReference}}.",
    emailBodyHtml: renderEmailShell({
      preheader: "Signed rental agreement for {{bookingReference}}",
      eyebrow: "Rental agreement",
      title: "Your signed agreement",
      body:
        paragraphs("Hi {{firstName}}, a signed copy of your rental agreement for booking <strong>{{bookingReference}}</strong> is attached to this email. Keep it handy while your hire is active.") +
        paragraphs("Need another copy later? You can always download it from your account."),
      cta: { label: "Open my documents", url: "{{appUrl}}/dashboard/documents" },
    }),
    variables: ["firstName", "bookingReference"],
  },
  {
    key: "return-paperwork-copy",
    type: "RETURN_PAPERWORK_COPY",
    category: "TRANSACTIONAL",
    name: "Return paperwork copy",
    description: "On-demand copy of return inspection + final invoice.",
    channels: ["EMAIL"],
    subject: "Return paperwork — {{bookingReference}}",
    bodyTemplate:
      "Hi {{firstName}}, attached is the return paperwork for booking {{bookingReference}}, including the post-hire inspection and final statement.",
    emailBodyHtml: renderEmailShell({
      preheader: "Post-hire inspection + final statement",
      eyebrow: "Return paperwork",
      title: "Your return pack",
      body:
        paragraphs("Hi {{firstName}}, attached is your post-hire inspection and final statement for booking <strong>{{bookingReference}}</strong>. It includes any outstanding charges or bond adjustments.") +
        paragraphs("Questions about a line on the statement? Hit reply or email {{supportEmail}} — we'll walk you through it."),
    }),
    variables: ["firstName", "bookingReference"],
  },
  {
    key: "profile-updated-self",
    type: "PROFILE_UPDATED_SELF",
    category: "ACCOUNT",
    name: "Profile updated (self)",
    description: "Confirms the customer's own changes to their profile.",
    channels: ["EMAIL"],
    subject: "Your {{siteName}} profile was updated",
    bodyTemplate:
      "Hi {{firstName}}, this confirms changes to your profile: {{fields}}. If this wasn't you, please contact us.",
    emailBodyHtml: renderEmailShell({
      preheader: "Confirming changes to your account",
      eyebrow: "Account update",
      title: "Profile changes confirmed",
      body:
        paragraphs("Hi {{firstName}}, this is just a heads-up that the following were updated on your account: <strong>{{fields}}</strong>.") +
        paragraphs("If you made these changes, there's nothing to do. If you didn't, please reset your password and contact {{supportEmail}} straight away."),
      cta: { label: "Review my account", url: "{{appUrl}}/dashboard/profile" },
    }),
    variables: ["firstName", "fields"],
  },
  {
    key: "profile-updated-staff",
    type: "PROFILE_UPDATED_STAFF",
    category: "ACCOUNT",
    name: "Profile updated (by staff)",
    description: "Alerts the customer that staff edited their profile.",
    channels: ["EMAIL"],
    subject: "Your {{siteName}} profile was updated by our team",
    bodyTemplate:
      "Hi {{firstName}}, our team updated the following on your account: {{fields}}. If this wasn't expected, please contact us.",
    emailBodyHtml: renderEmailShell({
      preheader: "Our team made changes to your account",
      eyebrow: "Account update",
      title: "Our team updated your profile",
      body:
        paragraphs("Hi {{firstName}}, our team made the following changes to your account: <strong>{{fields}}</strong>. This is usually to reflect information you gave us over the phone, at pickup, or during a support chat.") +
        paragraphs("If you weren't expecting this, reply to this email or contact {{supportEmail}} and we'll sort it out."),
      cta: { label: "Review my account", url: "{{appUrl}}/dashboard/profile" },
    }),
    variables: ["firstName", "fields"],
  },
  {
    key: "licence-expiring",
    type: "LICENCE_EXPIRING",
    category: "ACCOUNT",
    name: "Licence expiring",
    description: "Flags a licence that's within 30 days of expiry.",
    channels: ["EMAIL"],
    subject: "Your driver's licence is expiring soon",
    bodyTemplate:
      "Hi {{firstName}}, our records show your driver's licence expires on {{expiryDate}}. Please update us before your next booking.",
    emailBodyHtml: renderEmailShell({
      preheader: "Your licence expires {{expiryDate}}",
      eyebrow: "Action required",
      title: "Your licence is about to expire",
      body: paragraphs(
        "Hi {{firstName}}, our records show your driver's licence expires on <strong>{{expiryDate}}</strong>. To keep riding with us, please upload your renewed licence before your next booking — we can't legally hire without a current licence.",
      ),
      cta: { label: "Upload renewed licence", url: "{{appUrl}}/dashboard/profile" },
      ctaFootnote: "Already renewed? Upload the new card and you're all set.",
    }),
    variables: ["firstName", "expiryDate"],
  },
  {
    key: "infringement-nominated",
    type: "INFRINGEMENT_NOMINATED",
    category: "TRANSACTIONAL",
    name: "Infringement nominated",
    description: "Tells the customer they've been nominated as the driver on an infringement.",
    channels: ["EMAIL"],
    subject: "Action required: infringement nominated to you",
    bodyTemplate:
      "Hi {{firstName}}, infringement {{referenceNumber}} issued on {{offenceDate}} during your hire has been nominated to you. Charge: A${{amount}}. See your portal for details.",
    emailBodyHtml: renderEmailShell({
      preheader: "Infringement {{referenceNumber}} has been nominated to you",
      eyebrow: "Action required",
      title: "We've nominated you as the driver",
      body:
        paragraphs("Hi {{firstName}}, we've received an infringement notice from the issuing authority for an offence during your hire. By law, the registered operator must nominate the person driving at the time — that was you.") +
        summaryTable([
          { label: "Reference", value: "{{referenceNumber}}" },
          { label: "Offence date", value: "{{offenceDate}}" },
          { label: "Amount", value: "A${{amount}}" },
        ]) +
        paragraphs("Full details, including a copy of the original notice, are available in your portal. If you believe the nomination is in error, contact us within 14 days — after that, the authority considers it final."),
      cta: { label: "Open infringement", url: "{{appUrl}}/dashboard" },
    }),
    variables: ["firstName", "referenceNumber", "offenceDate", "amount"],
  },
  {
    key: "marketing-promotional",
    type: "MARKETING_PROMOTIONAL",
    category: "MARKETING",
    name: "Generic promo",
    description: "Shell for ad-hoc promotional broadcasts.",
    channels: ["EMAIL", "SMS"],
    subject: "{{subject}}",
    bodyTemplate: "{{body}}",
    emailBodyHtml: renderEmailShell({
      preheader: "{{subject}}",
      title: "{{subject}}",
      body: paragraphs("{{{body}}}"),
      cta: { label: "Book your next ride", url: "{{appUrl}}/fleet" },
      footerNote:
        `You're receiving this because you opted in to {{siteName}} marketing. <a href="{{unsubscribeUrl}}" style="color:#666;text-decoration:underline;">Unsubscribe</a>.`,
    }),
    variables: ["subject", "body"],
  },
  {
    key: "marketing-birthday",
    type: "MARKETING_BIRTHDAY",
    category: "MARKETING",
    name: "Birthday discount",
    description: "Wishes customers a happy birthday + 10% off next hire.",
    channels: ["EMAIL"],
    subject: "Happy birthday from {{siteName}}",
    bodyTemplate:
      "Hi {{firstName}}, happy birthday! Use code SCOOT10 for 10% off your next hire this month.",
    emailBodyHtml: renderEmailShell({
      preheader: "10% off your next ride, on us",
      eyebrow: "Happy birthday",
      title: "It's your day, {{firstName}}",
      body:
        paragraphs("Here's a little something from us: <strong>10% off your next {{siteName}} hire</strong>, any depot, any bike.") +
        paragraphs("Use code <strong>SCOOT10</strong> at checkout. Valid this month only."),
      cta: { label: "Find your ride", url: "{{appUrl}}/fleet" },
      footerNote:
        `Birthdays aren't spam, but if you'd rather not get them <a href="{{unsubscribeUrl}}" style="color:#666;text-decoration:underline;">update your preferences</a>.`,
    }),
    variables: ["firstName"],
  },
  {
    key: "marketing-winback",
    type: "MARKETING_WINBACK",
    category: "MARKETING",
    name: "Winback — 180d",
    description: "Targets customers who haven't rented in 180+ days.",
    channels: ["EMAIL"],
    subject: "We miss you — 15% off your next ride",
    bodyTemplate:
      "Hi {{firstName}}, it's been a while! Use WELCOMEBACK15 for 15% off your next hire in any depot.",
    emailBodyHtml: renderEmailShell({
      preheader: "15% off to bring you back on the road",
      eyebrow: "We miss you",
      title: "Been a while, {{firstName}}",
      body:
        paragraphs("It's been six months since your last ride with {{siteName}}. We'd love to have you back on the road.") +
        paragraphs("Use code <strong>WELCOMEBACK15</strong> for <strong>15% off your next hire</strong>, any depot. Valid for the next 30 days."),
      cta: { label: "Browse the fleet", url: "{{appUrl}}/fleet" },
      footerNote:
        `Not for you any more? <a href="{{unsubscribeUrl}}" style="color:#666;text-decoration:underline;">Unsubscribe</a> from marketing anytime.`,
    }),
    variables: ["firstName"],
  },
  {
    key: "support_ticket_assigned",
    type: "SUPPORT_TICKET_ASSIGNED",
    category: "OPERATIONAL",
    name: "Support — ticket assigned",
    description: "Sent to the assignee when a support ticket is created or assigned.",
    channels: ["EMAIL", "IN_APP"],
    subject: "Support ticket assigned — {{ticketNumber}}",
    bodyTemplate:
      "Ticket {{ticketNumber}} ({{category}}) from {{customerName}} ({{depotName}}): {{summary}}. Open: {{ticketUrl}}",
    emailBodyHtml: renderEmailShell({
      preheader: "{{category}} ticket from {{customerName}}",
      eyebrow: "Support",
      title: "Ticket {{ticketNumber}} assigned to you",
      body: summaryTable([
        { label: "Customer", value: "{{customerName}}" },
        { label: "Depot", value: "{{depotName}}" },
        { label: "Category", value: "{{category}}" },
        { label: "Summary", value: "{{summary}}" },
      ]),
      cta: { label: "Open ticket", url: "{{ticketUrl}}" },
    }),
    variables: ["ticketNumber", "category", "customerName", "summary", "depotName", "ticketUrl"],
  },
  {
    key: "support_ticket_urgent_paging",
    type: "SUPPORT_TICKET_URGENT",
    category: "OPERATIONAL",
    name: "Support — urgent on-call paging",
    description: "SMS + EMAIL fanned to on-call for URGENT breakdown / abandoned tickets.",
    channels: ["SMS", "EMAIL", "IN_APP"],
    subject: "URGENT — {{category}} {{ticketNumber}}",
    bodyTemplate:
      "URGENT {{siteName}}: {{customerName}} — {{summary}}. Respond now: {{ticketUrl}}",
    emailBodyHtml: renderEmailShell({
      preheader: "URGENT — respond now",
      eyebrow: "URGENT · On-call page",
      title: "{{category}} — {{ticketNumber}}",
      body:
        paragraphs("<strong>Immediate response required.</strong>") +
        summaryTable([
          { label: "Customer", value: "{{customerName}}" },
          { label: "Summary", value: "{{summary}}" },
        ]),
      cta: { label: "Open ticket now", url: "{{ticketUrl}}" },
    }),
    variables: ["ticketNumber", "category", "customerName", "summary", "ticketUrl"],
  },
  {
    key: "support_ticket_customer_reply",
    type: "SUPPORT_TICKET_CUSTOMER_REPLY",
    category: "TRANSACTIONAL",
    name: "Support — staff replied",
    description: "Sent to the customer when support staff reply on their ticket.",
    channels: ["EMAIL", "IN_APP"],
    subject: "Reply on your {{siteName}} support ticket {{ticketNumber}}",
    bodyTemplate:
      "Hi {{customerName}}, our team replied on {{ticketNumber}}: {{replyBody}}. View: {{portalUrl}}",
    emailBodyHtml: renderEmailShell({
      preheader: "New reply on ticket {{ticketNumber}}",
      eyebrow: "Support reply",
      title: "We've got back to you",
      body:
        paragraphs("Hi {{customerName}}, our team replied on your ticket <strong>{{ticketNumber}}</strong>:") +
        `<blockquote style="margin:0 0 16px 0;padding:12px 16px;border-left:3px solid #1B6B4A;background:#F4F4F1;color:#111;font-size:14px;">{{{replyBody}}}</blockquote>` +
        paragraphs("Pick up the conversation in your customer portal — you can reply from there and we'll get back to you."),
      cta: { label: "Open ticket", url: "{{portalUrl}}" },
    }),
    variables: ["ticketNumber", "customerName", "replyBody", "portalUrl"],
  },
  {
    key: "support_ticket_resolved",
    type: "SUPPORT_TICKET_RESOLVED",
    category: "TRANSACTIONAL",
    name: "Support — ticket resolved",
    description: "Customer confirmation when a support ticket is resolved, with CSAT CTA.",
    channels: ["EMAIL", "IN_APP"],
    subject: "Your {{siteName}} support ticket is resolved ({{ticketNumber}})",
    bodyTemplate:
      "Hi {{customerName}}, we've resolved your ticket {{ticketNumber}} ({{summary}}). How did we do? {{feedbackUrl}}",
    emailBodyHtml: renderEmailShell({
      preheader: "Ticket {{ticketNumber}} resolved",
      eyebrow: "Resolved",
      title: "All sorted",
      body:
        paragraphs("Hi {{customerName}}, we've marked your ticket <strong>{{ticketNumber}}</strong> as resolved.") +
        summaryTable([{ label: "What was it about", value: "{{summary}}" }]) +
        paragraphs("One quick favour — tell us how we did. It takes under a minute and genuinely helps us get better."),
      cta: { label: "Leave feedback", url: "{{feedbackUrl}}" },
    }),
    variables: ["ticketNumber", "customerName", "summary", "feedbackUrl"],
  },
];

async function main() {
  console.log(`Upserting ${templateDefs.length} notification templates…`);
  for (const t of templateDefs) {
    await prisma.notificationTemplate.upsert({
      where: { key: t.key },
      create: {
        key: t.key,
        type: t.type,
        category: t.category,
        name: t.name,
        description: t.description,
        channels: t.channels,
        subject: t.subject,
        bodyTemplate: t.bodyTemplate,
        emailBodyHtml: t.emailBodyHtml ?? null,
        format: "PLAIN_TEXT",
        variables: t.variables,
        isActive: true,
      },
      update: {
        name: t.name,
        description: t.description,
        category: t.category,
        type: t.type,
        channels: t.channels,
        subject: t.subject,
        bodyTemplate: t.bodyTemplate,
        emailBodyHtml: t.emailBodyHtml ?? null,
        format: "PLAIN_TEXT",
        variables: t.variables,
      },
    });
    console.log(`  ✓ ${t.key}`);
  }
  console.log("Done.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
