import {
  BOOKING_RULES,
  CANCELLATION_POLICY,
  GST_RATE,
  BRAND,
  NO_SHOW_RULES,
} from "@/lib/constants";

/**
 * Central runtime defaults for every operator-editable SystemSetting.
 * Consumers read via getSetting(key, SETTING_DEFAULTS[key]) so that an
 * unseeded or deleted row falls back to these values. This module is
 * safe to import from client components — it contains no database
 * access. Runtime readers live in `@/lib/settings` (server-only).
 */
export const SETTING_DEFAULTS = {
  // Organisation
  "org.abn": BRAND.abn,
  "org.invoiceFooter": "",
  "org.tradingName": BRAND.name,
  "org.legalName": BRAND.legalName,
  "org.siteTagline": BRAND.tagline,
  "org.supportEmail": "",
  "org.supportPhone": "",
  "org.privacyEmail": "",
  "org.postalAddress": "",
  "org.logoWideUrl": "",
  "org.logoBlackUrl": "",
  "org.logoSquareUrl": "",
  "org.faviconUrl": "",
  "org.facebookUrl": "",
  "org.instagramUrl": "",
  "org.tiktokUrl": "",
  "org.youtubeUrl": "",
  // Brand colour applied to PDF accents and email CTAs. Hex with leading
  // hash. Falls back to the legacy BRAND.primary green when blank.
  "org.brandColor": BRAND.primary,
  // Issue prefix for monotonic, FY-scoped tax document numbers.
  "org.invoicePrefix": "INV",
  "org.adjustmentPrefix": "ADJ",
  "org.receiptPrefix": "RCT",
  // Free-text remittance block rendered on tax invoices when non-empty
  // (BSB / account number / payment reference instructions).
  "org.remittanceDetails": "",
  // Default invoice payment terms in days. 0 = "due on issue" (the rental
  // model — payment captured up-front). Ancillary adjustment notes use a
  // 14-day default unless an admin overrides this.
  "org.invoiceTermsDays": 0,
  "org.adjustmentTermsDays": 14,

  // Booking rules
  "booking.minDays": BOOKING_RULES.minDurationDays,
  "booking.maxDays": BOOKING_RULES.maxDurationDays,
  "booking.advanceWindowDays": BOOKING_RULES.advanceWindowDays,
  "booking.bufferHours": BOOKING_RULES.bufferHoursBetweenBookings,
  "booking.requireLicenceVerification": true,

  // Checkout
  "booking.allowGuestCheckout": false,
  "booking.pendingPaymentTimeoutHours": 24,
  "booking.lateReturnGraceHours": BOOKING_RULES.lateReturnGraceHours,
  "booking.fuelChargePerLitre": 2.5,
  "booking.noShowGraceHours": NO_SHOW_RULES.graceHours,
  "booking.noShowReminderMinutesBefore": NO_SHOW_RULES.reminderMinutesBefore,

  // Cancellation
  "cancellation.fullRefundHours": CANCELLATION_POLICY.fullRefundHours,
  "cancellation.halfRefundHours": CANCELLATION_POLICY.halfRefundHours,
  "cancellation.adminFee": CANCELLATION_POLICY.adminFee,
  "cancellation.noShowFee": CANCELLATION_POLICY.noShowFee,

  // Payment & tax
  "tax.gstRate": GST_RATE,
  "payment.bondHoldDays": 14,
  "payment.bondReleaseDays": 14,
  "payment.bondReauthLeadDays": 2,
  "payment.walkInBondEnabled": true,
  "payment.acceptCash": true,

  // Backups
  "backup.schedule": "0 3 * * *",
  "backup.retentionDays": 30,
  "backup.alertOnFailure": true,

  // Loyalty
  "loyalty.pointsPerDollar": 1,
  "loyalty.pointsPerReview": 500,
  "loyalty.pointsPerReferral": 1000,
  "loyalty.goldThreshold": 2000,
  "loyalty.platinumThreshold": 10000,

  // Notifications
  "notification.reminderHoursBefore": 24,
  "notification.pauseAll": false,
  "notification.enableEmail": true,
  "notification.enableSms": true,
  "notification.enablePush": true,
  "notification.enableInApp": true,
  "notification.managerDailySummary": true,

  // Authentication
  "auth.oauthAllowedForBackOffice": true,

  // Pricing levers — both default to ON to preserve historical behaviour.
  // Disable yieldEnabled to suppress the "Demand adjustment" line and quote
  // every booking at the seasoned base rate. Disable durationDiscountEnabled
  // to suppress the legacy 10%/25% week/month ladder (PricingTier ladders
  // already replace it where configured).
  "pricing.yieldEnabled": true,
  "pricing.durationDiscountEnabled": true,

  // Audit
  "audit.retention": {
    enabled: false,
    retention: {
      PAGE_VIEW: 30,
      QUERY: 30,
      MUTATION: 730,
      AUTH: 365,
      JOB: 90,
      API: 365,
      WEBHOOK: 365,
    },
  },

  // Privacy — identity-document destruction (APP 11.2). Off and in dry-run by
  // default: an operator must consciously arm both flags. 2555 days = 7 years,
  // the Australian financial-records horizon.
  "privacy.identityRetention": {
    enabled: false,
    dryRun: true,
    retentionDays: 2555,
  },
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;

export const SETTING_GROUP_FOR: Record<SettingKey, string> = {
  "org.abn": "organisation",
  "org.invoiceFooter": "organisation",
  "org.tradingName": "organisation",
  "org.legalName": "organisation",
  "org.siteTagline": "organisation",
  "org.supportEmail": "organisation",
  "org.supportPhone": "organisation",
  "org.privacyEmail": "organisation",
  "org.postalAddress": "organisation",
  "org.logoWideUrl": "organisation",
  "org.logoBlackUrl": "organisation",
  "org.logoSquareUrl": "organisation",
  "org.faviconUrl": "organisation",
  "org.facebookUrl": "organisation",
  "org.instagramUrl": "organisation",
  "org.tiktokUrl": "organisation",
  "org.youtubeUrl": "organisation",
  "org.brandColor": "organisation",
  "org.invoicePrefix": "invoicing",
  "org.adjustmentPrefix": "invoicing",
  "org.receiptPrefix": "invoicing",
  "org.remittanceDetails": "invoicing",
  "org.invoiceTermsDays": "invoicing",
  "org.adjustmentTermsDays": "invoicing",

  "booking.minDays": "booking",
  "booking.maxDays": "booking",
  "booking.advanceWindowDays": "booking",
  "booking.bufferHours": "booking",
  "booking.requireLicenceVerification": "booking",

  "booking.allowGuestCheckout": "checkout",
  "booking.pendingPaymentTimeoutHours": "checkout",
  "booking.lateReturnGraceHours": "checkout",
  "booking.fuelChargePerLitre": "checkout",
  "booking.noShowGraceHours": "checkout",
  "booking.noShowReminderMinutesBefore": "notifications",

  "cancellation.fullRefundHours": "cancellation",
  "cancellation.halfRefundHours": "cancellation",
  "cancellation.adminFee": "cancellation",
  "cancellation.noShowFee": "cancellation",

  "tax.gstRate": "payment",
  "payment.bondHoldDays": "payment",
  "payment.bondReleaseDays": "payment",
  "payment.bondReauthLeadDays": "payment",
  "payment.walkInBondEnabled": "payment",
  "payment.acceptCash": "payment",

  "backup.schedule": "backup",
  "backup.retentionDays": "backup",
  "backup.alertOnFailure": "backup",

  "loyalty.pointsPerDollar": "loyalty",
  "loyalty.pointsPerReview": "loyalty",
  "loyalty.pointsPerReferral": "loyalty",
  "loyalty.goldThreshold": "loyalty",
  "loyalty.platinumThreshold": "loyalty",

  "notification.reminderHoursBefore": "notifications",
  "notification.pauseAll": "notifications",
  "notification.enableEmail": "notifications",
  "notification.enableSms": "notifications",
  "notification.enablePush": "notifications",
  "notification.enableInApp": "notifications",
  "notification.managerDailySummary": "notifications",

  "auth.oauthAllowedForBackOffice": "authentication",

  "pricing.yieldEnabled": "pricing",
  "pricing.durationDiscountEnabled": "pricing",

  "audit.retention": "audit",
  "privacy.identityRetention": "audit",
};

export const SETTING_DESCRIPTIONS: Partial<Record<SettingKey, string>> = {
  "org.abn": "Australian Business Number shown on invoices and rental agreements.",
  "org.invoiceFooter": "Free-text block appended to the bottom of every invoice PDF.",
  "org.tradingName": "Public-facing brand name used in emails and page titles.",
  "org.legalName": "Registered legal entity name. Appears in invoice headers and legal documents.",
  "org.siteTagline": "Short strapline shown next to the site name in page metadata.",
  "org.supportEmail": "Customer support inbox shown in transactional emails.",
  "org.supportPhone": "Customer support phone number shown in transactional emails.",
  "org.privacyEmail": "Privacy Officer inbox for access, correction and complaint requests under the Australian Privacy Principles. Shown on the privacy policy. Falls back to the support email when blank.",
  "org.postalAddress": "Single-line postal address for written privacy correspondence (APP 1/APP 12). Example: 'Privacy Officer, Level 2, 798 Parramatta Rd, Lewisham NSW 2049, Australia'.",
  "org.logoWideUrl": "Horizontal logo displayed on dark surfaces (sidebar expanded, header, footer). Leave blank to use the bundled default.",
  "org.logoBlackUrl": "Dark-on-transparent horizontal logo for light surfaces — tax invoice and contractual PDFs, light-mode marketing. Leave blank to fall back to the wide logo (which will be hard to see on white paper if it's a white-on-transparent variant).",
  "org.logoSquareUrl": "Square logo displayed on the collapsed sidebar. Also serves as the default favicon when no favicon is uploaded.",
  "org.faviconUrl": "Explicit browser-tab icon. When blank, the square logo is used instead.",
  "org.facebookUrl": "Public Facebook page URL shown in the site footer. Leave blank to hide the icon.",
  "org.instagramUrl": "Public Instagram profile URL shown in the site footer. Leave blank to hide the icon.",
  "org.tiktokUrl": "Public TikTok profile URL shown in the site footer. Leave blank to hide the icon.",
  "org.youtubeUrl": "Public YouTube channel URL shown in the site footer. Leave blank to hide the icon.",
  "org.brandColor": "Hex colour (with leading hash) used for email CTAs and website branding. PDF documents use a fixed professional accent and ignore this value.",
  "org.invoicePrefix": "Prefix for sequential tax invoice numbers (default INV — produces INV-2026-000001).",
  "org.adjustmentPrefix": "Prefix for sequential adjustment note numbers (default ADJ — produces ADJ-2026-000001).",
  "org.receiptPrefix": "Prefix for sequential branded payment receipt numbers (default RCT).",
  "org.remittanceDetails": "Optional EFT / BSB / account-number block shown on tax invoices when payment is not captured online.",
  "org.invoiceTermsDays": "Days before a rental tax invoice falls overdue. 0 = due on issue (default for up-front rental payment).",
  "org.adjustmentTermsDays": "Days before an adjustment note (post-rental ancillary charge) falls overdue.",

  "booking.minDays": "Minimum rental duration a customer can book.",
  "booking.maxDays": "Maximum rental duration a customer can book in one hire.",
  "booking.advanceWindowDays": "How far in advance customers can book.",
  "booking.bufferHours": "Required gap between bookings for cleaning/inspection.",
  "booking.requireLicenceVerification": "Block check-out until staff have verified the customer licence photos.",

  "booking.allowGuestCheckout": "Let customers complete a booking without registering an account.",
  "booking.pendingPaymentTimeoutHours": "Auto-cancel unpaid PENDING_PAYMENT bookings after this many hours.",
  "booking.lateReturnGraceHours": "Grace window after return time before late fees apply.",
  "booking.fuelChargePerLitre": "AUD charged per missing litre at return (GST-inclusive).",
  "booking.noShowGraceHours": "How long after the scheduled pickup time we wait before marking a booking as a no-show and forfeiting the bond.",
  "booking.noShowReminderMinutesBefore": "Minutes before the no-show cutoff to send a final-warning reminder to the customer.",

  "cancellation.fullRefundHours": "Cancel at least this many hours before pickup to get a full refund (minus admin fee).",
  "cancellation.halfRefundHours": "Cancel at least this many hours before pickup to get a 50% refund.",
  "cancellation.adminFee": "AUD admin fee deducted from every refund.",
  "cancellation.noShowFee": "AUD penalty charged when a customer fails to arrive.",

  "tax.gstRate": "GST rate applied to all quoted prices (Australian default: 0.10).",
  "payment.bondHoldDays": "How many days the Stripe bond authorisation stays valid.",
  "payment.bondReleaseDays": "Days after return before an un-captured bond is auto-released.",
  "payment.bondReauthLeadDays": "Re-authorise a bond hold when fewer than this many days remain before the card-network auth expires.",
  "payment.walkInBondEnabled": "Collect a card + bond hold for walk-in bookings (staff-device card entry).",
  "payment.acceptCash": "Allow staff to accept cash payments at the depot counter.",

  "loyalty.pointsPerDollar": "Loyalty points awarded per AUD spent on a completed booking.",
  "loyalty.pointsPerReview": "Bonus points awarded for a published post-trip review.",
  "loyalty.pointsPerReferral": "Bonus points awarded when a referred customer completes their first booking.",
  "loyalty.goldThreshold": "Lifetime points required to reach Gold tier.",
  "loyalty.platinumThreshold": "Lifetime points required to reach Platinum tier.",

  "notification.reminderHoursBefore": "How many hours before pickup the reminder email/SMS fires.",
  "notification.pauseAll": "Emergency kill-switch. When enabled, every outbound notification (email, SMS, push, in-app) is suppressed — auth emails like password reset and magic link are the only exceptions. Suppressed sends are recorded so ops can audit what didn't go out.",
  "notification.enableEmail": "Master switch for all transactional emails. Disable to stop email sends without touching the other channels.",
  "notification.enableSms": "Master switch for all transactional SMS. Disable to stop SMS sends without touching the other channels.",
  "notification.enablePush": "Master switch for web push notifications to customer browsers and staff devices.",
  "notification.enableInApp": "Master switch for the in-app notification feed (bell icon). Disabling does not affect email/SMS/push.",
  "notification.managerDailySummary": "Email the daily operations summary to depot managers.",

  "audit.retention": "Per-category audit log retention windows. Disabled means no rows are ever deleted.",
  "privacy.identityRetention":
    "Destruction of licence and passport imagery for dormant customers (Australian Privacy Principle 11.2). `retentionDays` is measured from the customer's last booking activity — 2555 days (7 years) matches the financial-records horizon. Only customers with no open booking, no outstanding balance, no held bond, no unsettled payment and no documents awaiting staff verification are ever eligible. Leave `dryRun` on to have the nightly job record what it would destroy without deleting anything.",

  "auth.oauthAllowedForBackOffice":
    "Allow staff, managers, and admins to sign in with Google, Apple, Microsoft, or GitHub. When disabled, back-office users are forced through email + password (still subject to the existing TOTP enforcement). Customers are unaffected.",

  "pricing.yieldEnabled":
    "Apply the depot-and-category demand multiplier on top of the seasoned base rate. When disabled, the 'Demand adjustment' quote line disappears and bookings are priced at the seasonal rate only. Disabling does not delete recorded multipliers — re-enabling restores their effect immediately.",
  "pricing.durationDiscountEnabled":
    "Apply the legacy 10%/25% duration-discount ladder (10% off for 7+ day hires, 25% off for 30+ day hires) when no progressive PricingTier ladder is configured for the category or vehicle. Disable to remove the discount globally. PricingTier ladders are unaffected — they always replace this rule where present.",
};
