"use client";

import { Button } from "@/components/ui/button";
import { clearAnalyticsConsent, useAnalyticsConsent } from "./analytics-consent";

/**
 * "Change your choice" affordance for the privacy page: reports the visitor's
 * current analytics-cookie choice and clears it, which brings the consent
 * banner (rendered from the root layout) straight back so they can answer
 * again. Renders nothing until hydration, since the choice lives in
 * `localStorage`.
 */
export function AnalyticsConsentReset() {
  const consent = useAnalyticsConsent();
  if (consent === null) return null;

  if (consent === "unset") {
    return (
      <p className="caption">
        You haven&rsquo;t answered the analytics banner yet, so analytics cookies are off.
      </p>
    );
  }

  return (
    <p className="flex flex-wrap items-center gap-3">
      <span className="caption">
        {consent === "granted"
          ? "You have accepted analytics cookies."
          : "You have declined analytics cookies."}
      </span>
      <Button size="sm" variant="secondary" onClick={() => clearAnalyticsConsent()}>
        Change my choice
      </Button>
    </p>
  );
}
