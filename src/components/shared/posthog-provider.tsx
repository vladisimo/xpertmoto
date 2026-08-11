"use client";

import { useEffect } from "react";
import Script from "next/script";
import { useAnalyticsConsent } from "./analytics-consent";

/**
 * `window.posthog` is typed in src/types/posthog.d.ts with only the methods
 * app code calls. The opt-in/opt-out pair lives on the loader stub too (it is
 * in the snippet's method list below, so calls queue until array.js lands) —
 * declared here rather than widening the global surface for one call site.
 */
type ConsentCapable = {
  opt_in_capturing?: () => void;
  opt_out_capturing?: () => void;
};

function getLoadedPostHog(): ConsentCapable | undefined {
  if (typeof window === "undefined") return undefined;
  return window.posthog as (NonNullable<Window["posthog"]> & ConsentCapable) | undefined;
}

/**
 * Loads the PostHog browser snippet. Rendered only when a browser key is
 * configured (checked server-side by the parent layout) **and** the visitor
 * has granted analytics consent (see analytics-consent.ts). Keys come in as
 * props so DB rotations land on the next render, no rebuild needed.
 *
 * We gate the loader itself rather than initialising with
 * `opt_out_capturing_by_default`: `posthog-js` is not a dependency here (the
 * inline array.js snippet is), so opting out after init would still have
 * fetched array.js and touched storage. Once the snippet HAS loaded it can no
 * longer be unloaded, so the effect below falls back to the SDK's opt-out for
 * a mid-session withdrawal — and opts back in on a re-grant, since
 * `next/script` de-duplicates by `id` and won't re-run the snippet.
 *
 * Session replay + heatmaps are enabled here. Because the booking wizard and
 * portal render licence numbers, DOB, addresses, signatures and uploaded
 * document images, the recorder is configured **privacy-maximal by default**:
 *   - `maskAllInputs` masks every form-field value,
 *   - `maskTextSelector: '*'` masks ALL on-screen text (so no PII text ever
 *     leaves the browser, even on pages we haven't audited),
 *   - `blockSelector: 'canvas, img, video'` blocks the signature pad and any
 *     licence/passport image preview from the recording entirely.
 * The result is a wireframe-grade replay — layout, clicks and rage-clicks are
 * captured, content is not. Relax `maskTextSelector` to a `[data-ph-mask]`
 * opt-in selector ONLY after visually confirming masking in the PostHog
 * replay viewer (the hard PII-QA gate). `capture_heatmaps` powers click/scroll
 * heatmaps; `surveys.autoLoad` lets PostHog-authored NPS/CSAT surveys render
 * for identified customers (see posthog-identify.tsx).
 */
export function PostHogProvider({ browserKey, host }: { browserKey: string; host: string }) {
  const consent = useAnalyticsConsent();
  const granted = consent === "granted";

  useEffect(() => {
    // No-op on the first grant (the snippet has not run yet) and whenever
    // analytics never loaded — only a mid-session change finds a live SDK.
    const posthog = getLoadedPostHog();
    if (!posthog) return;
    if (granted) posthog.opt_in_capturing?.();
    else posthog.opt_out_capturing?.();
  }, [granted]);

  if (!browserKey || !granted) return null;
  const config = JSON.stringify({
    api_host: host,
    person_profiles: "identified_only",
    capture_heatmaps: true,
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: "*",
      blockSelector: "canvas, img, video",
    },
    surveys: { autoLoad: true },
  });
  const snippet = `!function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey getNextSurveyStep identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug getPageViewId".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
posthog.init('${browserKey}',${config});`;
  return (
    <Script id="posthog-init" strategy="afterInteractive">
      {snippet}
    </Script>
  );
}
