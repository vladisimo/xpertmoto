/**
 * Single source of truth for the customer-onboarding gate. The JWT
 * callback, the customer-portal layout redirect, and the tRPC procedure
 * gate all call needsOnboarding(profile) — never re-implement the rule
 * elsewhere.
 *
 * The gate state is materialised on CustomerProfile as:
 *   - onboardedAt:       null until the wizard completes once
 *   - onboardingVersion: joint key built by buildOnboardingVersion(),
 *                        captured at completion. When any of the four
 *                        consent constants bumps and the stored value no
 *                        longer matches, the gate flips back on.
 */
import {
  CANCELLATION_VERSION,
  GRANDFATHERED_CANCELLATION_VERSIONS,
  GRANDFATHERED_MARKETING_VERSIONS,
  GRANDFATHERED_PRIVACY_VERSIONS,
  GRANDFATHERED_TERMS_VERSIONS,
  MARKETING_VERSION,
  PRIVACY_VERSION,
  TERMS_VERSION,
} from "./consent-versions";

/**
 * Joint version key encoding the four current consent versions in a
 * fixed order. Stored on CustomerProfile.onboardingVersion at completion;
 * compared against current at every sign-in to detect bumps.
 */
export function buildOnboardingVersion(): string {
  return `${TERMS_VERSION}|${PRIVACY_VERSION}|${CANCELLATION_VERSION}|${MARKETING_VERSION}`;
}

/**
 * Per-doc grandfather check. Returns true when the stored version is
 * either the current version or appears in the per-doc grandfather
 * array. Empty / null stored value never grandfathers.
 */
function isAcceptableVersion(
  stored: string | undefined,
  grandfathered: readonly string[],
): boolean {
  if (!stored) return false;
  return grandfathered.includes(stored);
}

/**
 * Parse a joint key back into its four segments. Returns null for
 * malformed input so callers fall back to "needs onboarding" rather than
 * crash.
 */
function parseJointKey(joint: string | null | undefined): {
  terms: string;
  privacy: string;
  cancellation: string;
  marketing: string;
} | null {
  if (!joint) return null;
  const parts = joint.split("|");
  if (parts.length !== 4) return null;
  const [terms, privacy, cancellation, marketing] = parts;
  if (!terms || !privacy || !cancellation || !marketing) return null;
  return { terms, privacy, cancellation, marketing };
}

/**
 * The shape needsOnboarding cares about. Pass any object with these two
 * fields — typically `customerProfile` from a Prisma query.
 */
export interface OnboardingProfileShape {
  onboardedAt: Date | null;
  onboardingVersion: string | null;
}

/**
 * Returns true iff the customer must be routed through /onboarding before
 * the rest of the customer portal renders. Call sites:
 *   - src/lib/auth.ts JWT callback (sets requiresOnboarding on session)
 *   - src/app/(customer)/layout.tsx (defence in depth)
 *   - src/server/trpc/trpc.ts protectedProcedure (server-side enforcement)
 */
export function needsOnboarding(
  profile: OnboardingProfileShape | null | undefined,
): boolean {
  if (!profile) return true;
  if (!profile.onboardedAt) return true;

  const parsed = parseJointKey(profile.onboardingVersion);
  if (!parsed) return true;

  const allCurrent =
    isAcceptableVersion(parsed.terms, GRANDFATHERED_TERMS_VERSIONS) &&
    isAcceptableVersion(parsed.privacy, GRANDFATHERED_PRIVACY_VERSIONS) &&
    isAcceptableVersion(parsed.cancellation, GRANDFATHERED_CANCELLATION_VERSIONS) &&
    isAcceptableVersion(parsed.marketing, GRANDFATHERED_MARKETING_VERSIONS);

  return !allCurrent;
}
