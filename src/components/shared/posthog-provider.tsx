"use client";

import Script from "next/script";

/**
 * Loads the PostHog browser snippet. Rendered only when browser key is
 * configured (checked server-side by the parent layout). Keys come in as
 * props so DB rotations land on the next render, no rebuild needed.
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
  if (!browserKey) return null;
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
