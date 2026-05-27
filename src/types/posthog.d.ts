/**
 * Minimal typing for the PostHog browser global. We load PostHog via the
 * inline array.js snippet (see components/shared/posthog-provider.tsx) rather
 * than the `posthog-js` npm package, so `window.posthog` is otherwise untyped.
 * Only the methods we actually call from app code are declared here.
 */
interface PostHogBrowser {
  identify(
    distinctId: string,
    setProps?: Record<string, unknown>,
    setOnceProps?: Record<string, unknown>,
  ): void;
  capture(event: string, properties?: Record<string, unknown>): void;
  get_distinct_id?(): string | undefined;
  startSessionRecording?(): void;
  stopSessionRecording?(): void;
  getActiveMatchingSurveys?(callback: (surveys: unknown[]) => void): void;
  renderSurvey?(surveyId: string, selector?: string): void;
  reset?(): void;
}

interface Window {
  posthog?: PostHogBrowser;
}
