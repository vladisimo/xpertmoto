import { cacheLife, cacheTag } from "next/cache";
import { logger } from "@/lib/logger";
import { getSecret, getString } from "@/lib/integration-config";

export type AnalyticsEvent = {
  event: string;
  distinctId: string;
  properties?: Record<string, unknown>;
  timestamp?: Date;
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

/**
 * Send a server-side event via the PostHog capture endpoint. Uses fetch
 * directly to avoid pulling in the Node SDK as a new dependency.
 * Non-blocking: failures are logged but not thrown.
 */
export async function trackServer(event: AnalyticsEvent): Promise<void> {
  const [key, host] = await Promise.all([
    getSecret("integration:posthog:serverKey", "POSTHOG_KEY"),
    getString("integration:posthog:host", "POSTHOG_HOST"),
  ]);
  if (!key) return;
  try {
    await fetch(`${host ?? "https://us.i.posthog.com"}/i/v0/e/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        event: event.event,
        distinct_id: event.distinctId,
        properties: event.properties ?? {},
        timestamp: (event.timestamp ?? new Date()).toISOString(),
      }),
      keepalive: true,
    });
  } catch (err) {
    logger.debug(
      { err: err instanceof Error ? err.message : String(err), event: event.event },
      "posthog capture failed",
    );
  }
}
