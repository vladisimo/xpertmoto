/**
 * Canonical consent version constants. Single source of truth for the
 * four legal documents customers accept during onboarding (and that older
 * customers may need to re-accept when text changes materially).
 *
 * Version strings appear in:
 *   - Booking.termsVersion (per-booking snapshot of TERMS at payment)
 *   - CustomerProfile.{terms,privacy}Version (last accepted version per user)
 *   - CustomerProfile.onboardingVersion (joint key built by buildOnboardingVersion)
 *   - The signed consent PDFs rendered at /onboarding (and the staff-led
 *     new-customer wizard) — embedded in the footer of every page
 *
 * Bumping rules:
 *   - Cosmetic rewrites with no policy change → keep the version, no need
 *     to re-prompt anyone.
 *   - Material policy change → bump the version constant. Existing
 *     customers' onboardingVersion will no longer match
 *     buildOnboardingVersion() so requiresOnboarding flips true on their
 *     next sign-in. To grandfather them, add the previous version to the
 *     matching grandfather array below.
 */
export const TERMS_VERSION = "v1.0";
export const PRIVACY_VERSION = "v1.0";
export const CANCELLATION_VERSION = "v1.0";
export const MARKETING_VERSION = "v1.0";

/**
 * Versions still considered current per document. A stored version that
 * matches the current constant OR appears in the matching grandfather
 * array is treated as up-to-date — no re-consent prompt. Add an old
 * version here to grandfather it after a bump; leave the array empty (or
 * containing only the current value) to force re-acceptance.
 */
export const GRANDFATHERED_TERMS_VERSIONS: readonly string[] = [
  TERMS_VERSION,
  // Example: "v0.9" — enable if we want to carry pre-launch testers.
];

export const GRANDFATHERED_PRIVACY_VERSIONS: readonly string[] = [
  PRIVACY_VERSION,
];

export const GRANDFATHERED_CANCELLATION_VERSIONS: readonly string[] = [
  CANCELLATION_VERSION,
];

export const GRANDFATHERED_MARKETING_VERSIONS: readonly string[] = [
  MARKETING_VERSION,
];

/**
 * @deprecated Per-doc helper for legacy booking-flow consent gate that
 * only checks TERMS. New code should call needsReonboarding() in
 * onboarding-status.ts which evaluates the full joint key.
 */
export function needsReconsent(lastAccepted: string | null | undefined): boolean {
  if (!lastAccepted) return true;
  return !GRANDFATHERED_TERMS_VERSIONS.includes(lastAccepted);
}
