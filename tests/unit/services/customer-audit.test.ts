import { describe, expect, test } from "vitest";
import {
  evaluateCustomerAudit,
  type CustomerAuditCheckKey,
  type CustomerAuditCounters,
  type CustomerAuditProfileInput,
  type CustomerAuditUserInput,
} from "@/server/services/customer-audit";

const NOW = new Date("2026-04-19T00:00:00.000Z");

function daysFromNow(days: number): Date {
  return new Date(NOW.getTime() + days * 86_400_000);
}

/** A fully-populated, compliant customer. Overrides customise individual fields. */
function makeUser(overrides: Partial<CustomerAuditUserInput> = {}): CustomerAuditUserInput {
  return {
    emailVerified: daysFromNow(-100),
    dateOfBirth: new Date("1990-05-12"),
    ...overrides,
  };
}

function makeProfile(
  overrides: Partial<CustomerAuditProfileInput> = {},
): CustomerAuditProfileInput {
  return {
    licenceNumber: "QLD123456",
    licenceExpiry: daysFromNow(400),
    licenceImageFront: "s3://licence-front.jpg",
    licenceImageBack: "s3://licence-back.jpg",
    licenceVerifiedAt: daysFromNow(-30),
    passportExpiry: daysFromNow(800),
    emergencyContactName: "Sam Smith",
    emergencyContactPhone: "+61400000000",
    termsAcceptedAt: daysFromNow(-90),
    privacyAcceptedAt: daysFromNow(-90),
    addressLine1: "12 Surf St",
    postcode: "4217",
    marketingOptIn: true,
    marketingSmsOptIn: false,
    marketingEmailUnsubscribedAt: null,
    marketingSmsUnsubscribedAt: null,
    notes: "VIP repeat customer",
    riskRating: "LOW",
    blacklistReason: null,
    lifetimePoints: 1500,
    referralCode: "HENRY-A1B2",
    signatureImage: "s3://signature.png",
    stripePaymentMethodExpMonth: 12,
    stripePaymentMethodExpYear: 2030,
    ...overrides,
  };
}

function makeCounters(
  overrides: Partial<CustomerAuditCounters> = {},
): CustomerAuditCounters {
  return {
    activeRentalCount: 0,
    incidentCount: 0,
    totalBookingCount: 5,
    ...overrides,
  };
}

function keys(
  user = makeUser(),
  profile = makeProfile(),
  counters = makeCounters(),
): CustomerAuditCheckKey[] {
  return evaluateCustomerAudit(user, profile, counters, NOW).map((i) => i.checkKey);
}

describe("evaluateCustomerAudit", () => {
  test("fully-populated compliant customer has no issues", () => {
    expect(keys()).toEqual([]);
  });

  // ── critical ─────────────────────────────────────────────────────────
  test("flags LICENCE_EXPIRED_WITH_ACTIVE_RENTAL when on hire and licence expired", () => {
    const profile = makeProfile({ licenceExpiry: daysFromNow(-2) });
    const counters = makeCounters({ activeRentalCount: 1 });
    const ks = keys(makeUser(), profile, counters);
    expect(ks).toContain("LICENCE_EXPIRED_WITH_ACTIVE_RENTAL");
    // does not double-flag the warning version
    expect(ks).not.toContain("LICENCE_EXPIRED");
  });

  test("flags BLACKLISTED_WITH_ACTIVE_RENTAL only when both conditions hold", () => {
    expect(
      keys(makeUser(), makeProfile({ blacklistReason: "fraudulent payment" }), makeCounters({ activeRentalCount: 1 })),
    ).toContain("BLACKLISTED_WITH_ACTIVE_RENTAL");
    // not on hire — does not fire
    expect(
      keys(makeUser(), makeProfile({ blacklistReason: "fraudulent payment" })),
    ).not.toContain("BLACKLISTED_WITH_ACTIVE_RENTAL");
  });

  test("flags MISSING_TERMS_WITH_ACTIVE_RENTAL when on hire without acceptance", () => {
    const ks = keys(
      makeUser(),
      makeProfile({ termsAcceptedAt: null }),
      makeCounters({ activeRentalCount: 1 }),
    );
    expect(ks).toContain("MISSING_TERMS_WITH_ACTIVE_RENTAL");
    // and the info version is suppressed
    expect(ks).not.toContain("MISSING_TERMS_ACCEPTED");
  });

  test("flags MISSING_LICENCE_NUMBER only when customer has bookings", () => {
    expect(
      keys(makeUser(), makeProfile({ licenceNumber: "" }), makeCounters({ totalBookingCount: 1 })),
    ).toContain("MISSING_LICENCE_NUMBER");
    // brand-new customer, no bookings yet — don't nag
    expect(
      keys(makeUser(), makeProfile({ licenceNumber: null }), makeCounters({ totalBookingCount: 0 })),
    ).not.toContain("MISSING_LICENCE_NUMBER");
  });

  // ── warning ──────────────────────────────────────────────────────────
  test("flags LICENCE_EXPIRED (warning) when expired but not on hire", () => {
    const ks = keys(makeUser(), makeProfile({ licenceExpiry: daysFromNow(-5) }));
    expect(ks).toContain("LICENCE_EXPIRED");
    expect(ks).not.toContain("LICENCE_EXPIRED_WITH_ACTIVE_RENTAL");
  });

  test("flags LICENCE_EXPIRING_30D within window", () => {
    const ks = keys(makeUser(), makeProfile({ licenceExpiry: daysFromNow(20) }));
    expect(ks).toContain("LICENCE_EXPIRING_30D");
    expect(ks).not.toContain("LICENCE_EXPIRED");
  });

  test("flags PASSPORT_EXPIRING_90D within wider window", () => {
    expect(
      keys(makeUser(), makeProfile({ passportExpiry: daysFromNow(60) })),
    ).toContain("PASSPORT_EXPIRING_90D");
    expect(
      keys(makeUser(), makeProfile({ passportExpiry: daysFromNow(120) })),
    ).not.toContain("PASSPORT_EXPIRING_90D");
  });

  test("flags LICENCE_NOT_VERIFIED only when images are present without verification", () => {
    expect(
      keys(
        makeUser(),
        makeProfile({ licenceVerifiedAt: null, licenceImageFront: "s3://x", licenceImageBack: null }),
      ),
    ).toContain("LICENCE_NOT_VERIFIED");
    // no images uploaded yet → don't flag (different remediation: ask for images)
    expect(
      keys(
        makeUser(),
        makeProfile({ licenceVerifiedAt: null, licenceImageFront: null, licenceImageBack: null }),
      ),
    ).not.toContain("LICENCE_NOT_VERIFIED");
  });

  test("flags MISSING_SIGNATURE only for customers with bookings", () => {
    expect(
      keys(makeUser(), makeProfile({ signatureImage: null }), makeCounters({ totalBookingCount: 3 })),
    ).toContain("MISSING_SIGNATURE");
    expect(
      keys(makeUser(), makeProfile({ signatureImage: null }), makeCounters({ totalBookingCount: 0 })),
    ).not.toContain("MISSING_SIGNATURE");
  });

  test("flags MISSING_EMERGENCY_CONTACT when both name and phone are blank", () => {
    expect(
      keys(makeUser(), makeProfile({ emergencyContactName: null, emergencyContactPhone: "" })),
    ).toContain("MISSING_EMERGENCY_CONTACT");
    // only name present — still considered partially filled, so don't nag
    expect(
      keys(makeUser(), makeProfile({ emergencyContactName: "Jo", emergencyContactPhone: null })),
    ).not.toContain("MISSING_EMERGENCY_CONTACT");
  });

  test("flags MISSING_ADDRESS when line 1 OR postcode is blank", () => {
    expect(keys(makeUser(), makeProfile({ addressLine1: "" }))).toContain("MISSING_ADDRESS");
    expect(keys(makeUser(), makeProfile({ postcode: null }))).toContain("MISSING_ADDRESS");
  });

  test("flags RISK_HIGH_NO_NOTE when HIGH risk but notes are blank", () => {
    expect(
      keys(makeUser(), makeProfile({ riskRating: "HIGH", notes: null })),
    ).toContain("RISK_HIGH_NO_NOTE");
    expect(
      keys(makeUser(), makeProfile({ riskRating: "HIGH", notes: "Repeated late returns" })),
    ).not.toContain("RISK_HIGH_NO_NOTE");
  });

  test("flags MULTIPLE_INCIDENTS_NO_RATING_CHANGE when 2+ incidents but rating still LOW", () => {
    expect(
      keys(makeUser(), makeProfile({ riskRating: "LOW" }), makeCounters({ incidentCount: 2 })),
    ).toContain("MULTIPLE_INCIDENTS_NO_RATING_CHANGE");
    expect(
      keys(makeUser(), makeProfile({ riskRating: "MEDIUM" }), makeCounters({ incidentCount: 4 })),
    ).not.toContain("MULTIPLE_INCIDENTS_NO_RATING_CHANGE");
  });

  test("flags STRIPE_CARD_EXPIRING within 30 days, using month-end as expiry instant", () => {
    // NOW = 2026-04-19; April 2026 expires 2026-04-30 → 11 days
    expect(
      keys(makeUser(), makeProfile({ stripePaymentMethodExpMonth: 4, stripePaymentMethodExpYear: 2026 })),
    ).toContain("STRIPE_CARD_EXPIRING");
    // Distant future — does not fire
    expect(
      keys(makeUser(), makeProfile({ stripePaymentMethodExpMonth: 12, stripePaymentMethodExpYear: 2030 })),
    ).not.toContain("STRIPE_CARD_EXPIRING");
    // No card on file — does not fire
    expect(
      keys(
        makeUser(),
        makeProfile({ stripePaymentMethodExpMonth: null, stripePaymentMethodExpYear: null }),
      ),
    ).not.toContain("STRIPE_CARD_EXPIRING");
  });

  // ── info ─────────────────────────────────────────────────────────────
  test("flags MISSING_DOB when user has no DOB", () => {
    expect(keys(makeUser({ dateOfBirth: null }))).toContain("MISSING_DOB");
  });

  test("flags EMAIL_NOT_VERIFIED when emailVerified is null", () => {
    expect(keys(makeUser({ emailVerified: null }))).toContain("EMAIL_NOT_VERIFIED");
  });

  test("flags MISSING_TERMS_ACCEPTED only when not on hire (otherwise critical fires)", () => {
    expect(
      keys(makeUser(), makeProfile({ termsAcceptedAt: null }), makeCounters({ activeRentalCount: 0 })),
    ).toContain("MISSING_TERMS_ACCEPTED");
    expect(
      keys(makeUser(), makeProfile({ termsAcceptedAt: null }), makeCounters({ activeRentalCount: 1 })),
    ).not.toContain("MISSING_TERMS_ACCEPTED");
  });

  test("flags MISSING_PRIVACY_ACCEPTED when no privacy consent on file", () => {
    expect(
      keys(makeUser(), makeProfile({ privacyAcceptedAt: null })),
    ).toContain("MISSING_PRIVACY_ACCEPTED");
  });

  test("flags MARKETING_CONSENT_UNRECORDED only when both opts and unsubs are empty", () => {
    const noOptInOrOut = makeProfile({
      marketingOptIn: false,
      marketingSmsOptIn: false,
      marketingEmailUnsubscribedAt: null,
      marketingSmsUnsubscribedAt: null,
    });
    expect(keys(makeUser(), noOptInOrOut)).toContain("MARKETING_CONSENT_UNRECORDED");

    // explicit opt-out is a recorded preference — don't flag
    const optedOut = makeProfile({
      marketingOptIn: false,
      marketingSmsOptIn: false,
      marketingEmailUnsubscribedAt: daysFromNow(-30),
      marketingSmsUnsubscribedAt: null,
    });
    expect(keys(makeUser(), optedOut)).not.toContain("MARKETING_CONSENT_UNRECORDED");
  });

  test("flags NO_LOYALTY_POINTS_BUT_HAS_BOOKINGS only with bookings + zero points", () => {
    expect(
      keys(makeUser(), makeProfile({ lifetimePoints: 0 }), makeCounters({ totalBookingCount: 4 })),
    ).toContain("NO_LOYALTY_POINTS_BUT_HAS_BOOKINGS");
    expect(
      keys(makeUser(), makeProfile({ lifetimePoints: 0 }), makeCounters({ totalBookingCount: 0 })),
    ).not.toContain("NO_LOYALTY_POINTS_BUT_HAS_BOOKINGS");
  });

  test("flags NO_REFERRAL_CODE when referralCode is blank", () => {
    expect(keys(makeUser(), makeProfile({ referralCode: null }))).toContain("NO_REFERRAL_CODE");
  });

  // ── metadata ─────────────────────────────────────────────────────────
  test("issue carries daysDelta and detectedAt for date-based checks", () => {
    const issues = evaluateCustomerAudit(
      makeUser(),
      makeProfile({ licenceExpiry: daysFromNow(-3) }),
      makeCounters(),
      NOW,
    );
    const expired = issues.find((i) => i.checkKey === "LICENCE_EXPIRED");
    expect(expired?.daysDelta).toBe(-3);
    expect(expired?.detectedAt).toBeTypeOf("string");
  });

  test("worst-case customer surfaces every expected check, no duplicates", () => {
    const user: CustomerAuditUserInput = { emailVerified: null, dateOfBirth: null };
    const profile: CustomerAuditProfileInput = {
      licenceNumber: null,
      licenceExpiry: daysFromNow(-10),
      licenceImageFront: "s3://x",
      licenceImageBack: null,
      licenceVerifiedAt: null,
      passportExpiry: daysFromNow(60),
      emergencyContactName: null,
      emergencyContactPhone: null,
      termsAcceptedAt: null,
      privacyAcceptedAt: null,
      addressLine1: null,
      postcode: null,
      marketingOptIn: false,
      marketingSmsOptIn: false,
      marketingEmailUnsubscribedAt: null,
      marketingSmsUnsubscribedAt: null,
      notes: null,
      riskRating: "HIGH",
      blacklistReason: "fraudulent payment",
      lifetimePoints: 0,
      referralCode: null,
      signatureImage: null,
      stripePaymentMethodExpMonth: null,
      stripePaymentMethodExpYear: null,
    };
    const counters: CustomerAuditCounters = {
      activeRentalCount: 1,
      incidentCount: 3,
      totalBookingCount: 5,
    };
    const expected: CustomerAuditCheckKey[] = [
      // critical
      "LICENCE_EXPIRED_WITH_ACTIVE_RENTAL",
      "BLACKLISTED_WITH_ACTIVE_RENTAL",
      "MISSING_TERMS_WITH_ACTIVE_RENTAL",
      "MISSING_LICENCE_NUMBER",
      // warning
      "PASSPORT_EXPIRING_90D",
      "LICENCE_NOT_VERIFIED",
      "MISSING_SIGNATURE",
      "MISSING_EMERGENCY_CONTACT",
      "MISSING_ADDRESS",
      "RISK_HIGH_NO_NOTE",
      // info
      "MISSING_DOB",
      "EMAIL_NOT_VERIFIED",
      "MISSING_PRIVACY_ACCEPTED",
      "MARKETING_CONSENT_UNRECORDED",
      "NO_LOYALTY_POINTS_BUT_HAS_BOOKINGS",
      "NO_REFERRAL_CODE",
    ];
    const actual = evaluateCustomerAudit(user, profile, counters, NOW).map((i) => i.checkKey);
    expect(new Set(actual)).toEqual(new Set(expected));
    // No issue appears twice
    expect(actual).toHaveLength(expected.length);
  });
});
