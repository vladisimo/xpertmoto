"use client";

import { useReportWebVitals } from "next/web-vitals";
import { reportWebVital } from "@/lib/seo/web-vitals";

/**
 * Reports Core Web Vitals (LCP, CLS, INP, FCP, TTFB) to PostHog so field
 * performance is trackable alongside product analytics. Mounted in the root
 * layout only when a PostHog browser key is configured.
 */
export function WebVitalsReporter() {
  useReportWebVitals((metric) => reportWebVital(metric));
  return null;
}
