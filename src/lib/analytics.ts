import { cacheLife, cacheTag } from "next/cache";
import { logger } from "@/lib/logger";
import { getSecret, getString } from "@/lib/integration-config";

export type AnalyticsEvent = {
  event: string;
  distinctId: string;
  properties?: Record<string, unknown>;
  timestamp?: Date;
  /**
   * Person properties to attach. PostHog encodes these as the reserved
   * `$set` key inside `properties` — every occurrence overwrites the
   * person profile field. Use for values that change (lifetime counts,
   * depot affinity, role).
   */
  set?: Record<string, unknown>;
  /**
   * Person properties set only if not already present (`$set_once`).
   * Use for immutable first-touch values (firstSeenAt, signupChannel).
   */
  setOnce?: Record<string, unknown>;
  /**
   * Group analytics association, encoded as `$groups`. Keys are group
   * types (e.g. `depot`), values are the stable group key. The value
   * MUST byte-match the `$group_key` used in group-identify or PostHog
   * forks two groups. We standardise on the depot slug everywhere.
   */
  groups?: Record<string, string>;
  /**
   * Set `false` for events keyed on a non-person `distinctId` (anonymous
   * visitor cookie, vehicle id, the `"system"` sentinel). It emits the
   * reserved `$process_person_profile: false` so PostHog ingests the event
   * WITHOUT minting/updating a billable person profile. Unlike the browser
   * SDK's `person_profiles: 'identified_only'`, server events POSTed to the
   * raw capture API never inherit that setting — every server event with a
   * `distinctId` creates a person profile unless this flag is sent. Defaults
   * to person processing (true) so authenticated `User.id` events still
   * build profiles.
   */
  processPerson?: boolean;
};

export type PostHogPublicConfig = {
  browserKey: string;
  host: string;
};

/**
 * Public PostHog config for the browser. Resolved at request time — callers
 * (server components) should pass this into the PostHog provider as props.
 */
export async function getPostHogPublic(): Promise<PostHogPublicConfig> {
  "use cache";
  cacheLife("hours");
  cacheTag("integration-config");
  const [browserKey, host] = await Promise.all([
    getString("integration:posthog:browserKey", "NEXT_PUBLIC_POSTHOG_KEY"),
    getString("integration:posthog:host", "POSTHOG_HOST"),
  ]);
  return {
    browserKey: browserKey ?? "",
    host: host ?? "https://us.i.posthog.com",
  };
}

export async function posthogServerEnabled(): Promise<boolean> {
  return !!(await getSecret("integration:posthog:serverKey", "POSTHOG_KEY"));
}

const DEFAULT_HOST = "https://us.i.posthog.com";

/** Resolve server key + host together. */
async function posthogCreds(): Promise<{ key: string | null; host: string }> {
  const [key, host] = await Promise.all([
    getSecret("integration:posthog:serverKey", "POSTHOG_KEY"),
    getString("integration:posthog:host", "POSTHOG_HOST"),
  ]);
  return { key: key ?? null, host: host ?? DEFAULT_HOST };
}

/** Build the `properties` bag with PostHog reserved keys merged in. */
function withReservedKeys(event: AnalyticsEvent): Record<string, unknown> {
  const properties: Record<string, unknown> = { ...(event.properties ?? {}) };
  if (event.set) properties.$set = event.set;
  if (event.setOnce) properties.$set_once = event.setOnce;
  if (event.groups) properties.$groups = event.groups;
  // Suppress person-profile creation for non-person distinct_ids. PostHog
  // only honours this on the event itself — there is no project-side
  // equivalent of the browser SDK's `identified_only`.
  if (event.processPerson === false) properties.$process_person_profile = false;
  return properties;
}

/** Shape a single event into the PostHog capture wire format. */
function toCaptureItem(event: AnalyticsEvent): Record<string, unknown> {
  return {
    event: event.event,
    distinct_id: event.distinctId,
    properties: withReservedKeys(event),
    timestamp: (event.timestamp ?? new Date()).toISOString(),
  };
}

/**
 * POST a pre-built body to a PostHog ingestion endpoint. Centralises the
 * key gate, fetch (keepalive), and silent-failure logging so every public
 * helper inherits the same isolation. Analytics is never life-critical —
 * a PostHog outage must never surface to the caller.
 */
async function postCapture(
  path: "/i/v0/e/" | "/batch/",
  build: (key: string) => Record<string, unknown>,
  label: string,
): Promise<void> {
  try {
    // Credential resolution is inside the try so a config-store hiccup can
    // never break the calling mutation — analytics is always best-effort.
    const { key, host } = await posthogCreds();
    if (!key) return;
    await fetch(`${host}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(build(key)),
      keepalive: true,
    });
  } catch (err) {
    logger.debug(
      { err: err instanceof Error ? err.message : String(err), event: label },
      "posthog capture failed",
    );
  }
}

/**
 * Send a server-side event via the PostHog capture endpoint. Uses fetch
 * directly to avoid pulling in the Node SDK as a new dependency.
 * Non-blocking: failures are logged but not thrown. Person properties
 * (`set`/`setOnce`) and group associations (`groups`) are merged into the
 * payload as PostHog's reserved `$set`/`$set_once`/`$groups` keys.
 */
export async function trackServer(event: AnalyticsEvent): Promise<void> {
  await postCapture(
    "/i/v0/e/",
    (key) => ({ api_key: key, ...toCaptureItem(event) }),
    event.event,
  );
}

/**
 * Send many events in a single request to the PostHog `/batch/` endpoint.
 * Used by the visitor-event fan-out so a 100-event flush is one round-trip
 * rather than 100. Each item keeps its own timestamp so historical/queued
 * events land at the right time. Empty array → no-op.
 */
export async function trackServerBatch(events: AnalyticsEvent[]): Promise<void> {
  if (events.length === 0) return;
  await postCapture(
    "/batch/",
    (key) => ({ api_key: key, batch: events.map(toCaptureItem) }),
    `batch:${events.length}`,
  );
}

/**
 * Identify a person and set profile properties. Emits the special
 * `$identify` event. `distinctId` must be the stable id used for that
 * person's events (we use `User.id` for authenticated users).
 */
export async function trackServerIdentify(input: {
  distinctId: string;
  set?: Record<string, unknown>;
  setOnce?: Record<string, unknown>;
}): Promise<void> {
  await trackServer({
    event: "$identify",
    distinctId: input.distinctId,
    set: input.set,
    setOnce: input.setOnce,
  });
}

/**
 * Emit a PostHog LLM-observability `$ai_generation` event for one model
 * call. `$ai_*` is PostHog's reserved convention for its LLM analytics
 * product, so the dashboards (cost, latency, token usage by model/provider)
 * populate without any extra config. Token counts and (for OpenRouter) USD
 * cost are read off the SDK response; `latencySeconds` is measured by the
 * caller around the call. Best-effort like every other helper here — an AI
 * call must never fail because analytics did.
 */
export async function trackAiGeneration(input: {
  distinctId: string;
  /** Model id, e.g. `claude-sonnet-4-6` or `anthropic/claude-haiku-4.5`. */
  model: string;
  /** `anthropic` | `openrouter` — the SDK that made the call. */
  provider: string;
  /** Our own grouping: `support` | `ocr` | `insights`. */
  feature: string;
  inputTokens?: number;
  outputTokens?: number;
  /** Wall-clock latency in seconds (PostHog expects fractional seconds). */
  latencySeconds?: number;
  /** Upstream USD cost when the provider reports it (OpenRouter does). */
  costUsd?: number;
  /** Correlates multiple generations in one logical request. */
  traceId?: string;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  /** Extra non-reserved properties (e.g. conversationId, success flag). */
  properties?: Record<string, unknown>;
  groups?: Record<string, string>;
  /** Whether the call errored — surfaced as PostHog's `$ai_is_error`. */
  isError?: boolean;
  /** Set false when `distinctId` is non-person (e.g. the "system" sentinel). */
  processPerson?: boolean;
}): Promise<void> {
  await trackServer({
    event: "$ai_generation",
    distinctId: input.distinctId,
    ...(input.processPerson === false ? { processPerson: false } : {}),
    properties: {
      $ai_model: input.model,
      $ai_provider: input.provider,
      ...(input.inputTokens != null ? { $ai_input_tokens: input.inputTokens } : {}),
      ...(input.outputTokens != null ? { $ai_output_tokens: input.outputTokens } : {}),
      ...(input.latencySeconds != null ? { $ai_latency: input.latencySeconds } : {}),
      ...(input.costUsd != null ? { $ai_total_cost_usd: input.costUsd } : {}),
      ...(input.traceId ? { $ai_trace_id: input.traceId } : {}),
      ...(input.isError != null ? { $ai_is_error: input.isError } : {}),
      feature: input.feature,
      ...(input.cacheReadTokens != null ? { cacheReadTokens: input.cacheReadTokens } : {}),
      ...(input.cacheCreationTokens != null
        ? { cacheCreationTokens: input.cacheCreationTokens }
        : {}),
      ...(input.properties ?? {}),
    },
    ...(input.groups ? { groups: input.groups } : {}),
  });
}

/**
 * Register/update a group's own properties via the special
 * `$groupidentify` event. Fire sparingly (on group create/update — e.g.
 * depot) and NEVER per event. `groupKey` MUST match the value used in any
 * event's `groups[groupType]` or PostHog forks two groups.
 */
export async function trackServerGroupIdentify(input: {
  groupType: string;
  groupKey: string;
  set: Record<string, unknown>;
}): Promise<void> {
  await postCapture(
    "/i/v0/e/",
    (key) => ({
      api_key: key,
      event: "$groupidentify",
      // Conventional sentinel distinct_id for group-identify.
      distinct_id: `$${input.groupType}_${input.groupKey}`,
      properties: {
        $group_type: input.groupType,
        $group_key: input.groupKey,
        $group_set: input.set,
      },
      timestamp: new Date().toISOString(),
    }),
    `$groupidentify:${input.groupType}`,
  );
}
