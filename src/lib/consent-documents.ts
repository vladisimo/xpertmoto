/**
 * Consent document bodies presented to customers during the staff-led
 * "New Customer" onboarding flow. Each doc becomes a signed PDF stored
 * against the customer profile (see `renderConsentDocumentPdf`).
 *
 * Body text contains deployment-neutral `{{placeholder}}` tokens that are
 * resolved at render time against the current deployment's
 * `getBranding()` / `SystemSetting` configuration. Use
 * `interpolateConsentBody(body, branding)` to resolve them before display
 * or PDF rendering. Supported tokens: `{{siteName}}`, `{{legalName}}`,
 * `{{abn}}`, `{{supportEmail}}`, `{{privacyEmail}}`.
 *
 * Copy lives here as a versioned fallback. When Admin → System Settings →
 * Legal ships a WYSIWYG editor, that settings value will take precedence
 * and this file becomes the seed/fallback only. The version string is
 * what's embedded on each signed PDF — bump it whenever the text changes
 * so audit trails remain interpretable.
 */

import {
  CANCELLATION_VERSION,
  MARKETING_VERSION,
  PRIVACY_VERSION,
  TERMS_VERSION,
} from "./consent-versions";

export interface ConsentBranding {
  siteName: string;
  legalName: string;
  abn: string;
  supportEmail: string | null;
  privacyEmail: string | null;
}

/**
 * Resolve `{{token}}` placeholders in a consent-doc body against the
 * deployed customer's branding. Unknown tokens are left untouched so an
 * unexpected placeholder doesn't silently disappear.
 */
export function interpolateConsentBody(body: string, branding: ConsentBranding): string {
  const abnSuffix = branding.abn ? `, ABN ${branding.abn}` : "";
  return body.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    switch (key) {
      case "siteName":
        return branding.siteName;
      case "legalName":
        return branding.legalName;
      case "abn":
        return branding.abn;
      case "legalNameAbn":
        return `${branding.legalName}${abnSuffix}`;
      case "supportEmail":
        return branding.supportEmail ?? "";
      case "privacyEmail":
        return branding.privacyEmail ?? branding.supportEmail ?? "";
      default:
        return match;
    }
  });
}

export const CONSENT_DOC_KEYS = [
  "TERMS",
  "PRIVACY",
  "CANCELLATION",
  "MARKETING",
] as const;

export type ConsentDocKey = (typeof CONSENT_DOC_KEYS)[number];

export type ConsentDocument = {
  key: ConsentDocKey;
  title: string;
  version: string;
  /** Plain-text body. Blank lines separate paragraphs. */
  body: string;
};

const TERMS_BODY = `Terms of Hire

These Terms of Hire govern your rental of a scooter or motorbike from {{siteName}} ({{legalNameAbn}}). By signing below you confirm that you have read and accepted each of the terms set out in this document.

1. Eligibility
You hold a current, valid driver licence appropriate for the vehicle class being hired. You are at or above the minimum age published for that class. You have truthfully represented your identity, address, and driving history to {{siteName}} staff.

2. Authorised use
The hired vehicle may only be operated by you or an additional driver you have named and who has been approved in writing by {{siteName}}. The vehicle must be used lawfully and in accordance with Australian Road Rules. Off-road use, racing, track use, riding tuition, delivery work, and ride-share use are prohibited unless a written variation is agreed.

3. Condition, fuel and kilometres
The vehicle is provided in roadworthy condition with a full tank of fuel and a pre-hire inspection record signed by both parties. You must return the vehicle in the same condition, with a full tank, and within the agreed kilometre allowance (where applicable). Excess kilometres, missing fuel, and additional cleaning are charged at the rates shown on your booking summary.

4. Damage, theft and infringements
You are responsible for the vehicle while it is in your possession. Any damage, loss, theft, or traffic infringement incurred during the hire is your responsibility. {{siteName}} may recover costs from the bond, the customer's registered card, or by direct invoice. Infringements lodged with {{siteName}} will be nominated to you as the responsible driver.

5. Bond
A refundable bond is held on your card at the start of the hire. The bond is released after the vehicle is returned and inspected, typically within 14 days. Deductions are itemised and provided to you in writing.

6. Insurance and excess
Basic insurance is included in every hire, with a standard excess as shown on your booking. Reduced-excess options are available at time of hire. Insurance does not cover wilful damage, operation under the influence, or breach of these terms.

7. Late returns
Returning the vehicle later than the agreed time attracts a late fee. The fee schedule is shown on your booking. Repeated or extended late returns may result in the hire being terminated and the vehicle recovered.

8. Termination
{{siteName}} may terminate the hire at any time if these terms are breached, if the vehicle is being used unlawfully, or if the hire poses a risk to the customer or public.

9. Governing law
These terms are governed by the laws of Queensland, Australia. Any dispute will be submitted to the courts of that jurisdiction.

Your signature below confirms that you have read, understood, and accepted these Terms of Hire.`;

const PRIVACY_BODY = `Privacy Policy

{{siteName}} ({{legalNameAbn}}) handles your personal information in accordance with the Australian Privacy Principles contained in the Privacy Act 1988 (Cth).

1. What we collect
Identity documents you provide (driver licence, passport, visa), contact details, emergency contact details, home address, date of birth, photographs taken during onboarding, signatures provided during onboarding and at check-out/check-in, vehicle usage records, payment card tokens held by our PCI-DSS compliant payment processor, and correspondence you send us.

2. Why we collect it
To verify your identity and eligibility to operate the vehicle class you have hired, to process payments and bonds, to communicate with you about your hire, to comply with legal and insurance obligations, to investigate incidents and infringements, and — if you opt in separately — to send you marketing material.

3. How we store it
Your information is stored in secure servers located in Australia. Access is restricted to authorised {{siteName}} staff. Sensitive identifiers (licence number, passport number) are encrypted at rest.

4. Who we share it with
We share your information with our payment processor (Stripe), our insurance underwriter, law enforcement and regulatory bodies where required by law, and with depot staff involved in your hire. We do not sell your personal information.

5. Retention
We keep records for as long as required by Australian Consumer Law, taxation law, and our insurance obligations — typically seven years after your most recent hire. You may request earlier deletion subject to those legal obligations.

6. Your rights
You can ask to see the personal information we hold about you, correct it if it is inaccurate, withdraw consent to marketing communications at any time, and request a copy of your data in a machine-readable format. Contact our Privacy Officer at {{privacyEmail}} or ask any {{siteName}} staff member.

7. Complaints
If you believe {{siteName}} has mishandled your personal information, contact us first. If your complaint is not resolved, you may escalate to the Office of the Australian Information Commissioner (oaic.gov.au).

Your signature below confirms that you have read and acknowledged this Privacy Policy and consent to {{siteName}} collecting and handling your personal information as described.`;

const CANCELLATION_BODY = `Cancellation Policy

This policy applies to cancellations, no-shows, and shortenings of a confirmed hire.

1. More than 72 hours before pickup
Full refund, less a $25 administration fee.

2. Between 24 and 72 hours before pickup
50% refund of the hire total. Bond authorisations are released.

3. Less than 24 hours before pickup
No refund of the hire total. Bond authorisations are released.

4. No-show
If you do not arrive at the depot within 2 hours of your booked pickup time and have not contacted us, the hire is treated as a no-show. No refund applies, and a $50 no-show fee may be charged against your card.

5. Early returns
Returning the vehicle earlier than the agreed end date does not entitle you to a refund of unused days unless an extraordinary circumstance applies and is agreed in writing by depot management.

6. Cancellations by {{siteName}}
If {{siteName}} cancels your hire due to vehicle unavailability, mechanical issue, weather, or safety concerns, you will receive a full refund including the administration fee, and — where available — an offer to hire an equivalent or upgraded vehicle at no additional cost.

7. Disputes
If you believe a cancellation charge has been applied in error, contact {{supportEmail}} within 30 days of the charge. We will respond within 10 business days.

Your signature below confirms that you have read and accepted this Cancellation Policy.`;

const MARKETING_BODY = `Marketing Consent

{{siteName}} ({{legalName}}) occasionally sends its customers news, offers, and seasonal promotions by email and SMS. Providing your consent is entirely optional and has no impact on your current or future hires.

You can withdraw your consent at any time by clicking the "Unsubscribe" link in any marketing email, replying STOP to any marketing SMS, updating your preferences in your customer portal, or asking any {{siteName}} staff member.

By signing below, you acknowledge the marketing channel choices recorded on this form (email and/or SMS, or none). If both options are left unchecked, you will not receive marketing communications — you will still receive transactional messages such as booking confirmations, reminders, invoices, and safety notices.`;

export const CONSENT_DOCUMENTS: Record<ConsentDocKey, ConsentDocument> = {
  TERMS: {
    key: "TERMS",
    title: "Terms of Hire",
    version: TERMS_VERSION,
    body: TERMS_BODY,
  },
  PRIVACY: {
    key: "PRIVACY",
    title: "Privacy Policy",
    version: PRIVACY_VERSION,
    body: PRIVACY_BODY,
  },
  CANCELLATION: {
    key: "CANCELLATION",
    title: "Cancellation Policy",
    version: CANCELLATION_VERSION,
    body: CANCELLATION_BODY,
  },
  MARKETING: {
    key: "MARKETING",
    title: "Marketing Consent",
    version: MARKETING_VERSION,
    body: MARKETING_BODY,
  },
};

export function getConsentDocument(key: ConsentDocKey): ConsentDocument {
  return CONSENT_DOCUMENTS[key];
}

/**
 * Map a `ConsentDocKey` to the matching `CustomerDocumentType` enum value
 * used when the signed PDF is persisted as a `CustomerDocument` row.
 */
export const CONSENT_DOC_TYPE_MAP = {
  TERMS: "CONSENT_TERMS",
  PRIVACY: "CONSENT_PRIVACY",
  CANCELLATION: "CONSENT_CANCELLATION",
  MARKETING: "CONSENT_MARKETING",
} as const satisfies Record<ConsentDocKey, string>;
