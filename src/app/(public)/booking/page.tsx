import { headers } from "next/headers";
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

export default async function BookingPage() {
  // Reading `headers()` opts this route out of build-time prerender, which
  // satisfies Next 16's guard against `Date.now()` reads in server
  // components without first touching a dynamic data source — the
  // in-process flag cache uses `Date.now()` for its TTL math. Compatible
  // with `nextConfig.cacheComponents`, unlike the `force-dynamic` export.
  await headers();
  const flags = await getFeatureFlags(WIZARD_FLAG_KEYS);
  return (
    <BookingWizardClient
      flags={{
        wizard_mobile_shell: flags.wizard_mobile_shell,
        wizard_inline_auth: flags.wizard_inline_auth,
        wizard_intl_licence_flow: flags.wizard_intl_licence_flow,
        allOAuthProviders: [...OAUTH_PROVIDER_IDS],
        enabledOAuthProviders: getEnabledOAuthProviders(),
      }}
    />
  );
}
