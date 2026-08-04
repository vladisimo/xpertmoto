import type { Metadata } from "next";
import { headers } from "next/headers";
import { buildMetadata } from "@/lib/seo/metadata";
import { BookingWizardClient } from "@/components/booking/booking-wizard-client";
import { getFeatureFlags } from "@/server/services/feature-flags";
import {
  OAUTH_PROVIDER_IDS,
  getEnabledOAuthProviders,
} from "@/lib/auth-providers";

const WIZARD_FLAG_KEYS = [
  "wizard_mobile_shell",
  "wizard_inline_auth",
  "wizard_intl_licence_flow",
] as const;

// Transactional funnel page (stateful wizard, hidden chrome) — noindex.
export function generateMetadata(): Promise<Metadata> {
  return buildMetadata({
    title: "Book your hire",
    description:
      "Book your scooter or motorbike hire online — choose dates and depot, pick a vehicle, add cover and pay securely with an instant GST-inclusive quote.",
    path: "/booking",
    noindex: true,
  });
}

export default async function BookingPage() {
  // Reading `headers()` opts this route out of build-time prerender, which
  // satisfies Next 16's guard against `Date.now()` reads in server
  // components without first touching a dynamic data source — the
  // in-process flag cache uses `Date.now()` for its TTL math. Compatible
  // with `nextConfig.cacheComponents`, unlike the `force-dynamic` export.
  await headers();
  const flags = await getFeatureFlags(WIZARD_FLAG_KEYS);
  return (
    <>
      {/* M-9/M-11: the wizard steps use <h2> headings, so the page needs a
       *  single screen-reader-only <h1>. sr-only is position:absolute, so it
       *  doesn't disturb the wizard's full-height shell layout. */}
      <h1 className="sr-only">Book your hire</h1>
      <BookingWizardClient
        flags={{
          wizard_mobile_shell: flags.wizard_mobile_shell,
          wizard_inline_auth: flags.wizard_inline_auth,
          wizard_intl_licence_flow: flags.wizard_intl_licence_flow,
          allOAuthProviders: [...OAUTH_PROVIDER_IDS],
          enabledOAuthProviders: getEnabledOAuthProviders(),
        }}
      />
    </>
  );
}
