"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { setAnalyticsConsent, useAnalyticsConsent } from "./analytics-consent";

/**
 * First-visit analytics consent prompt. Rendered once from the root layout, so
 * it appears at most once per visitor across the public site, the portal and
 * the back-office, and is gone for good on either answer.
 *
 * Deliberately not a modal: no overlay, no cookie-wall — `pointer-events-none`
 * on the positioning wrapper keeps the rest of the page clickable, and it sits
 * below dialogs and sheets (`z-50`) so it can't trap a modal underneath it.
 */
export function AnalyticsConsentBanner() {
  const consent = useAnalyticsConsent();

  // `null` = pre-hydration (no localStorage on the server); anything else
  // means the visitor has already answered.
  if (consent !== "unset") return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:justify-end">
      <section
        aria-labelledby="analytics-consent-heading"
        className="pointer-events-auto w-full max-w-sm space-y-4 rounded-lg border border-border bg-background p-4 shadow-lg"
      >
        <div className="space-y-2">
          <h2 id="analytics-consent-heading" className="h3">
            Analytics cookies
          </h2>
          <p className="caption">
            We&rsquo;d like to measure how the site is used so we can improve it. These
            cookies stay off unless you accept, and we never use them for advertising.
            Read more in our{" "}
            <Link href="/privacy" className="underline hover:text-foreground">
              Privacy Policy
            </Link>
            .
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setAnalyticsConsent("granted")}>
            Accept analytics
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setAnalyticsConsent("denied")}>
            Decline
          </Button>
        </div>
      </section>
    </div>
  );
}
