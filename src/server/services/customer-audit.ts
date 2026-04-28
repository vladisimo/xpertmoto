/**
 * Customer audit — evaluates data-quality, compliance and consent issues on
 * a customer profile.
 *
 * Pure: no I/O, no time source other than the `now` argument. The tRPC
 * handler loads users + profiles + booking/incident counters, then passes
 * each one through `evaluateCustomerAudit`. Downstream UI groups the
 * returned `CustomerAuditIssue[]` by customer and renders them as
 * actionable rows.
 *
 * The 30-day expiry window mirrors `EXPIRY_WINDOW_DAYS` in
 * `src/server/services/fleet-audit.ts` so the audit panels never disagree
 * about what "near expiry" means. Passport uses a 90-day window because
 * passport renewals routinely take 6+ weeks.
 */

export type CustomerAuditSeverity = "critical" | "warning" | "info";

/** Which fix-sheet section to navigate to when the user clicks Fix. */
export type CustomerAuditRemedy = "identity" | "compliance" | "consent" | "contact";

export type CustomerAuditCheckKey =
  // critical — active rental with a blocking compliance issue
  | "LICENCE_EXPIRED_WITH_ACTIVE_RENTAL"
  | "BLACKLISTED_WITH_ACTIVE_RENTAL"
  | "MISSING_TERMS_WITH_ACTIVE_RENTAL"
  | "MISSING_LICENCE_NUMBER"
  // warning — soon-to-expire or hygiene gaps with operational impact
  | "LICENCE_EXPIRED"
  | "LICENCE_EXPIRING_30D"
  | "PASSPORT_EXPIRING_90D"
  | "LICENCE_NOT_VERIFIED"
  | "MISSING_SIGNATURE"
  | "MISSING_EMERGENCY_CONTACT"
  | "MISSING_ADDRESS"
  | "RISK_HIGH_NO_NOTE"
  | "MULTIPLE_INCIDENTS_NO_RATING_CHANGE"
  | "STRIPE_CARD_EXPIRING"
  // info — nice-to-have profile completeness
  | "MISSING_DOB"
  | "EMAIL_NOT_VERIFIED"
  | "MISSING_TERMS_ACCEPTED"
  | "MISSING_PRIVACY_ACCEPTED"
  | "MARKETING_CONSENT_UNRECORDED"
  | "NO_LOYALTY_POINTS_BUT_HAS_BOOKINGS"
  | "NO_REFERRAL_CODE";

export interface CustomerAuditCheckMeta {
  key: CustomerAuditCheckKey;
  severity: CustomerAuditSeverity;
  remedy: CustomerAuditRemedy;
  label: string;
  description: string;
}

export const CUSTOMER_AUDIT_CHECKS: Record<CustomerAuditCheckKey, CustomerAuditCheckMeta> = {
  LICENCE_EXPIRED_WITH_ACTIVE_RENTAL: { key: "LICENCE_EXPIRED_WITH_ACTIVE_RENTAL", severity: "critical", remedy: "identity",   label: "Expired licence on active rental", description: "Customer has an active rental but their licence has expired." },
  BLACKLISTED_WITH_ACTIVE_RENTAL:     { key: "BLACKLISTED_WITH_ACTIVE_RENTAL",     severity: "critical", remedy: "compliance", label: "Blacklisted with active rental",   description: "Customer is blacklisted yet has a vehicle currently on hire." },
  MISSING_TERMS_WITH_ACTIVE_RENTAL:   { key: "MISSING_TERMS_WITH_ACTIVE_RENTAL",   severity: "critical", remedy: "consent",    label: "No terms acceptance on active rental", description: "Customer is on rental but has never accepted T&Cs." },
  MISSING_LICENCE_NUMBER:             { key: "MISSING_LICENCE_NUMBER",             severity: "critical", remedy: "identity",   label: "Licence number missing",           description: "Customer has bookings on file but no licence number recorded." },

  LICENCE_EXPIRED:                    { key: "LICENCE_EXPIRED",                    severity: "warning",  remedy: "identity",   label: "Licence expired",                  description: "Driver licence expiry date is in the past." },
  LICENCE_EXPIRING_30D:               { key: "LICENCE_EXPIRING_30D",               severity: "warning",  remedy: "identity",   label: "Licence expiring soon",            description: "Driver licence expires within 30 days." },
  PASSPORT_EXPIRING_90D:              { key: "PASSPORT_EXPIRING_90D",              severity: "warning",  remedy: "identity",   label: "Passport expiring soon",           description: "Passport expires within 90 days." },
  LICENCE_NOT_VERIFIED:               { key: "LICENCE_NOT_VERIFIED",               severity: "warning",  remedy: "identity",   label: "Licence not verified",             description: "Licence images are on file but no staff member has verified them." },
  MISSING_SIGNATURE:                  { key: "MISSING_SIGNATURE",                  severity: "warning",  remedy: "identity",   label: "Signature missing",                description: "No persisted signature image — required at next check-out." },
  MISSING_EMERGENCY_CONTACT:          { key: "MISSING_EMERGENCY_CONTACT",          severity: "warning",  remedy: "contact",    label: "Emergency contact missing",        description: "Neither name nor phone number recorded for next-of-kin." },
  MISSING_ADDRESS:                    { key: "MISSING_ADDRESS",                    severity: "warning",  remedy: "contact",    label: "Address missing",                  description: "Postal address line 1 or postcode is blank." },
  RISK_HIGH_NO_NOTE:                  { key: "RISK_HIGH_NO_NOTE",                  severity: "warning",  remedy: "compliance", label: "High risk without a note",         description: "Customer is flagged HIGH risk but no reason has been recorded." },
  MULTIPLE_INCIDENTS_NO_RATING_CHANGE:{ key: "MULTIPLE_INCIDENTS_NO_RATING_CHANGE",severity: "warning",  remedy: "compliance", label: "Multiple incidents, low risk",     description: "Customer has 2+ incidents but is still rated LOW risk — review." },
  STRIPE_CARD_EXPIRING:               { key: "STRIPE_CARD_EXPIRING",               severity: "warning",  remedy: "compliance", label: "Saved card expiring soon",         description: "Default payment method expires within 30 days — recoveries may fail." },

  MISSING_DOB:                        { key: "MISSING_DOB",                        severity: "info",     remedy: "identity",   label: "Date of birth missing",            description: "DOB is required for age-based eligibility checks." },
  EMAIL_NOT_VERIFIED:                 { key: "EMAIL_NOT_VERIFIED",                 severity: "info",     remedy: "contact",    label: "Email not verified",               description: "Customer has not confirmed ownership of their email address." },
  MISSING_TERMS_ACCEPTED:             { key: "MISSING_TERMS_ACCEPTED",             severity: "info",     remedy: "consent",    label: "T&Cs not accepted",                description: "No record of terms-and-conditions acceptance on file." },
  MISSING_PRIVACY_ACCEPTED:           { key: "MISSING_PRIVACY_ACCEPTED",           severity: "info",     remedy: "consent",    label: "Privacy policy not accepted",      description: "No record of privacy-policy acceptance on file." },
  MARKETING_CONSENT_UNRECORDED:       { key: "MARKETING_CONSENT_UNRECORDED",       severity: "info",     remedy: "consent",    label: "Marketing consent unrecorded",     description: "No opt-in and no opt-out — capture a preference next contact." },
  NO_LOYALTY_POINTS_BUT_HAS_BOOKINGS: { key: "NO_LOYALTY_POINTS_BUT_HAS_BOOKINGS", severity: "info",     remedy: "compliance", label: "No loyalty points despite bookings", description: "Lifetime points is zero even though customer has completed bookings." },
  NO_REFERRAL_CODE:                   { key: "NO_REFERRAL_CODE",                   severity: "info",     remedy: "compliance", label: "No referral code generated",       description: "Customer has never been issued a referral code." },
};

/** Minimum customer-side fields required to evaluate audit checks. */
export interface CustomerAuditUserInput {
  emailVerified: Date | null;
  dateOfBirth: Date | null;
}

export interface CustomerAuditProfileInput {
  licenceNumber: string | null;
  licenceExpiry: Date | null;
  licenceImageFront: string | null;
  licenceImageBack: string | null;
  licenceVerifiedAt: Date | null;
  passportExpiry: Date | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  termsAcceptedAt: Date | null;
  privacyAcceptedAt: Date | null;
  addressLine1: string | null;
  postcode: string | null;
  marketingOptIn: boolean;
  marketingSmsOptIn: boolean;
  marketingEmailUnsubscribedAt: Date | null;
  marketingSmsUnsubscribedAt: Date | null;
  notes: string | null;
  riskRating: "LOW" | "MEDIUM" | "HIGH";
  blacklistReason: string | null;
  lifetimePoints: number;
  referralCode: string | null;
  signatureImage: string | null;
  stripePaymentMethodExpMonth: number | null;
  stripePaymentMethodExpYear: number | null;
}

/** Counters loaded once per customer by the handler. */
export interface CustomerAuditCounters {
  /** Bookings currently in CHECKED_OUT / ACTIVE / OVERDUE — i.e. on hire. */
  activeRentalCount: number;
  /** Distinct incidents linked to this customer, all-time. */
  incidentCount: number;
  /** Bookings of any status — for "no points despite bookings" check. */
  totalBookingCount: number;
}

export interface CustomerAuditIssue {
  checkKey: CustomerAuditCheckKey;
  severity: CustomerAuditSeverity;
  remedy: CustomerAuditRemedy;
  label: string;
  description: string;
  /** ISO string of the relevant expiry date, when the check is date-based. */
  detectedAt: string | null;
  /** Days until expiry (negative = expired). Null when not date-based. */
  daysDelta: number | null;
}

export const LICENCE_EXPIRY_WINDOW_DAYS = 30;
export const PASSPORT_EXPIRY_WINDOW_DAYS = 90;
export const CARD_EXPIRY_WINDOW_DAYS = 30;
const MS_PER_DAY = 86_400_000;

function daysUntil(date: Date, now: Date): number {
  return Math.ceil((date.getTime() - now.getTime()) / MS_PER_DAY);
}

function isBlank(s: string | null | undefined): boolean {
  return s == null || s.trim() === "";
}

function build(
  meta: CustomerAuditCheckMeta,
  detectedAt: Date | null,
  daysDelta: number | null,
): CustomerAuditIssue {
  return {
    checkKey: meta.key,
    severity: meta.severity,
    remedy: meta.remedy,
    label: meta.label,
    description: meta.description,
    detectedAt: detectedAt ? detectedAt.toISOString() : null,
    daysDelta,
  };
}

/**
 * Convert Stripe's `expMonth` (1-12) and `expYear` (4-digit) into the
 * card's effective expiry — last instant of the expiry month, UTC. A
 * card with expMonth=4, expYear=2026 expires 2026-04-30T23:59:59Z.
 */
function stripeCardExpiry(month: number, year: number): Date {
  // new Date(year, month, 0) is the last day of `month` (1-indexed),
  // because day 0 of month+1 == last day of month. Use UTC to stay
  // independent of the server timezone.
  return new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
}

/**
 * Evaluate every audit check against a single customer. Pure — pass the
 * current time for determinism in tests.
 */
export function evaluateCustomerAudit(
  user: CustomerAuditUserInput,
  profile: CustomerAuditProfileInput,
  counters: CustomerAuditCounters,
  now: Date = new Date(),
): CustomerAuditIssue[] {
  const issues: CustomerAuditIssue[] = [];
  const onHire = counters.activeRentalCount > 0;
  const hasBookings = counters.totalBookingCount > 0;

  const licenceExpired =
    profile.licenceExpiry != null && profile.licenceExpiry.getTime() < now.getTime();

  // ─── critical ───
  if (onHire && licenceExpired && profile.licenceExpiry) {
    issues.push(
      build(
        CUSTOMER_AUDIT_CHECKS.LICENCE_EXPIRED_WITH_ACTIVE_RENTAL,
        profile.licenceExpiry,
        daysUntil(profile.licenceExpiry, now),
      ),
    );
  }
  if (onHire && !isBlank(profile.blacklistReason)) {
    issues.push(build(CUSTOMER_AUDIT_CHECKS.BLACKLISTED_WITH_ACTIVE_RENTAL, null, null));
  }
  if (onHire && profile.termsAcceptedAt == null) {
    issues.push(build(CUSTOMER_AUDIT_CHECKS.MISSING_TERMS_WITH_ACTIVE_RENTAL, null, null));
  }
  if (hasBookings && isBlank(profile.licenceNumber)) {
    issues.push(build(CUSTOMER_AUDIT_CHECKS.MISSING_LICENCE_NUMBER, null, null));
  }

  // ─── warning ───
  if (profile.licenceExpiry) {
    const d = daysUntil(profile.licenceExpiry, now);
    if (d < 0 && !onHire) {
      // Don't double-flag: if on-hire we already raised the critical version.
      issues.push(build(CUSTOMER_AUDIT_CHECKS.LICENCE_EXPIRED, profile.licenceExpiry, d));
    } else if (d >= 0 && d <= LICENCE_EXPIRY_WINDOW_DAYS) {
      issues.push(build(CUSTOMER_AUDIT_CHECKS.LICENCE_EXPIRING_30D, profile.licenceExpiry, d));
    }
  }

  if (profile.passportExpiry) {
    const d = daysUntil(profile.passportExpiry, now);
    if (d >= 0 && d <= PASSPORT_EXPIRY_WINDOW_DAYS) {
      issues.push(build(CUSTOMER_AUDIT_CHECKS.PASSPORT_EXPIRING_90D, profile.passportExpiry, d));
    }
  }

  const hasLicenceImages =
    !isBlank(profile.licenceImageFront) || !isBlank(profile.licenceImageBack);
  if (hasLicenceImages && profile.licenceVerifiedAt == null) {
    issues.push(build(CUSTOMER_AUDIT_CHECKS.LICENCE_NOT_VERIFIED, null, null));
  }

  if (isBlank(profile.signatureImage) && hasBookings) {
    issues.push(build(CUSTOMER_AUDIT_CHECKS.MISSING_SIGNATURE, null, null));
  }

  if (isBlank(profile.emergencyContactName) && isBlank(profile.emergencyContactPhone)) {
    issues.push(build(CUSTOMER_AUDIT_CHECKS.MISSING_EMERGENCY_CONTACT, null, null));
  }

  if (isBlank(profile.addressLine1) || isBlank(profile.postcode)) {
    issues.push(build(CUSTOMER_AUDIT_CHECKS.MISSING_ADDRESS, null, null));
  }

  if (profile.riskRating === "HIGH" && isBlank(profile.notes)) {
    issues.push(build(CUSTOMER_AUDIT_CHECKS.RISK_HIGH_NO_NOTE, null, null));
  }

  if (counters.incidentCount >= 2 && profile.riskRating === "LOW") {
    issues.push(build(CUSTOMER_AUDIT_CHECKS.MULTIPLE_INCIDENTS_NO_RATING_CHANGE, null, null));
  }

  if (profile.stripePaymentMethodExpMonth != null && profile.stripePaymentMethodExpYear != null) {
    const cardExpiry = stripeCardExpiry(
      profile.stripePaymentMethodExpMonth,
      profile.stripePaymentMethodExpYear,
    );
    const d = daysUntil(cardExpiry, now);
    if (d >= 0 && d <= CARD_EXPIRY_WINDOW_DAYS) {
      issues.push(build(CUSTOMER_AUDIT_CHECKS.STRIPE_CARD_EXPIRING, cardExpiry, d));
    }
  }

  // ─── info ───
  if (user.dateOfBirth == null) {
    issues.push(build(CUSTOMER_AUDIT_CHECKS.MISSING_DOB, null, null));
  }
  if (user.emailVerified == null) {
    issues.push(build(CUSTOMER_AUDIT_CHECKS.EMAIL_NOT_VERIFIED, null, null));
  }
  if (profile.termsAcceptedAt == null && !onHire) {
    // critical version handles the on-hire case
    issues.push(build(CUSTOMER_AUDIT_CHECKS.MISSING_TERMS_ACCEPTED, null, null));
  }
  if (profile.privacyAcceptedAt == null) {
    issues.push(build(CUSTOMER_AUDIT_CHECKS.MISSING_PRIVACY_ACCEPTED, null, null));
  }
  if (
    !profile.marketingOptIn &&
    !profile.marketingSmsOptIn &&
    profile.marketingEmailUnsubscribedAt == null &&
    profile.marketingSmsUnsubscribedAt == null
  ) {
    issues.push(build(CUSTOMER_AUDIT_CHECKS.MARKETING_CONSENT_UNRECORDED, null, null));
  }
  if (hasBookings && profile.lifetimePoints === 0) {
    issues.push(build(CUSTOMER_AUDIT_CHECKS.NO_LOYALTY_POINTS_BUT_HAS_BOOKINGS, null, null));
  }
  if (isBlank(profile.referralCode)) {
    issues.push(build(CUSTOMER_AUDIT_CHECKS.NO_REFERRAL_CODE, null, null));
  }

  return issues;
}

/** User statuses excluded from the audit. Anonymised/banned customers
 * are terminal dispositions where missing fields are expected. */
export const CUSTOMER_AUDIT_EXCLUDED_STATUSES = ["BANNED"] as const;
