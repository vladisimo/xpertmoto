"use client";

import { useReportWebVitals } from "next/web-vitals";
import { reportWebVital } from "@/lib/seo/web-vitals";
import { isAnalyticsGranted } from "./analytics-consent";

/**
 * Reports Core Web Vitals (LCP, CLS, INP, FCP, TTFB) to PostHog so field
 * performance is trackable alongside product analytics. Mounted in the root
 * layout only when a PostHog browser key is configured.
 *
 * Consent is read inside the callback (not via the hook) because metrics fire
 * from browser callbacks long after render — a fresh read can't go stale, and
 * vitals recorded before the visitor accepts are simply dropped.
 */
export function WebVitalsReporter() {
  useReportWebVitals((metric) => {
    if (!isAnalyticsGranted()) return;
    reportWebVital(metric);
  });
  return null;
}
