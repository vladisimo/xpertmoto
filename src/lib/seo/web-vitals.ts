/**
 * Forwards Core Web Vitals to PostHog (already loaded as `window.posthog` by
 * the PostHog snippet). Kept as a pure-ish function — separate from the React
 * wrapper — so the reporting logic is unit-testable without a DOM.
 */
export interface WebVitalMetric {
  name: string;
  value: number;
  id: string;
  rating?: string;
  navigationType?: string;
}

type PostHogLike = {
  capture: (event: string, properties: Record<string, unknown>) => void;
};

function getPostHog(): PostHogLike | undefined {
  if (typeof window === "undefined") return undefined;
  const ph = (window as unknown as { posthog?: Partial<PostHogLike> }).posthog;
  return ph && typeof ph.capture === "function" ? (ph as PostHogLike) : undefined;
}

export function reportWebVital(
  metric: WebVitalMetric,
  ph: PostHogLike | undefined = getPostHog(),
): void {
  if (!ph) return;
  ph.capture("web_vital", {
    metric_name: metric.name,
    metric_value: metric.value,
    metric_id: metric.id,
    ...(metric.rating ? { metric_rating: metric.rating } : {}),
    ...(metric.navigationType ? { metric_navigation_type: metric.navigationType } : {}),
    $current_url: typeof window !== "undefined" ? window.location.href : undefined,
  });
}
