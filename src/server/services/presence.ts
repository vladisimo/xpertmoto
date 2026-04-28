import IORedis, { type Redis } from "ioredis";
import { getRedis } from "@/lib/redis";
import { logger } from "@/lib/logger";

/**
 * Redis pub/sub backbone for the Live Visitor View. A single "live:presence"
 * channel broadcasts visitor-on/off/update events to every staff reader;
 * per-conversation "live:chat:<id>" channels broadcast new chat messages.
 *
 * The publisher reuses the pooled IORedis client from `getRedis()`; each
 * subscriber creates its own dedicated connection because a connection in
 * Redis subscribe mode cannot run other commands.
 *
 * Every helper is resilient to Redis being disabled (no REDIS_URL) — it
 * logs a debug line and returns a no-op. That keeps local dev and unit
 * tests frictionless, mirroring the pattern in `server/jobs/queue.ts`.
 */

export type PresenceEvent =
  | {
      type: "presence.upsert";
      sessionId: string;
      currentPath: string;
      wizardStep: number | null;
      displayName: string | null;
      userId: string | null;
      startedAt: string;
      lastSeenAt: string;
    }
  | { type: "presence.offline"; sessionId: string }
  | { type: "staff.online"; count: number };

export type ChatEvent = {
  type: "chat.message";
  conversationId: string;
  messageId: string;
  senderRole: "CUSTOMER" | "STAFF" | "AI" | "SYSTEM";
  body: string;
  attachments: unknown[] | null;
  createdAt: string;
};

const PRESENCE_CHANNEL = "live:presence";
const STAFF_ONLINE_KEY = "live:staff-online";
const CHAT_CHANNEL = (conversationId: string) => `live:chat:${conversationId}`;

export async function publishPresence(event: PresenceEvent): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.publish(PRESENCE_CHANNEL, JSON.stringify(event));
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "presence publish failed");
  }
}

export async function publishChat(
  conversationId: string,
  event: ChatEvent,
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.publish(CHAT_CHANNEL(conversationId), JSON.stringify(event));
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "chat publish failed");
  }
}

export async function markStaffOnline(staffId: string): Promise<number> {
  const redis = getRedis();
  if (!redis) return 0;
  await redis.sadd(STAFF_ONLINE_KEY, staffId);
  const count = await redis.scard(STAFF_ONLINE_KEY);
  await publishPresence({ type: "staff.online", count });
  return count;
}

export async function markStaffOffline(staffId: string): Promise<number> {
  const redis = getRedis();
  if (!redis) return 0;
  await redis.srem(STAFF_ONLINE_KEY, staffId);
  const count = await redis.scard(STAFF_ONLINE_KEY);
  await publishPresence({ type: "staff.online", count });
  return count;
}

export async function getStaffOnlineCount(): Promise<number> {
  const redis = getRedis();
  if (!redis) return 0;
  return redis.scard(STAFF_ONLINE_KEY);
}

export type PresenceListener = (payload: PresenceEvent) => void;
export type ChatListener = (payload: ChatEvent) => void;

export type SubscribeHandle = {
  unsubscribe: () => Promise<void>;
};

/**
 * Subscribe to the global presence feed. Returns a handle with an
 * idempotent unsubscribe. Callers MUST call unsubscribe when the stream
 * ends (client disconnect on SSE, test teardown, etc.).
 */
export async function subscribePresence(
  listener: PresenceListener,
): Promise<SubscribeHandle | null> {
  const base = getRedis();
  if (!base) return null;
  const sub = base.duplicate() as Redis;
  await sub.subscribe(PRESENCE_CHANNEL);
  sub.on("message", (_channel, raw) => {
    try {
      listener(JSON.parse(raw) as PresenceEvent);
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "presence decode failed");
    }
  });
  return { unsubscribe: async () => cleanup(sub) };
}

/**
 * Subscribe to per-conversation chat channels. `conversationIds` may be a
 * static list (usual case: a visitor watching their own conversation) or
 * a list that grows over time (staff picking up new conversations — use
 * `expand()` to add more).
 */
export async function subscribeChat(
  conversationIds: string[],
  listener: ChatListener,
): Promise<(SubscribeHandle & { expand: (id: string) => Promise<void> }) | null> {
  const base = getRedis();
  if (!base) return null;
  const sub = base.duplicate() as Redis;
  if (conversationIds.length > 0) {
    await sub.subscribe(...conversationIds.map(CHAT_CHANNEL));
  }
  sub.on("message", (_channel, raw) => {
    try {
      listener(JSON.parse(raw) as ChatEvent);
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "chat decode failed");
    }
  });
  return {
    unsubscribe: async () => cleanup(sub),
    expand: async (id: string) => {
      await sub.subscribe(CHAT_CHANNEL(id));
    },
  };
}

async function cleanup(sub: Redis): Promise<void> {
  try {
    await sub.unsubscribe();
  } catch {
    // already closed
  }
  sub.disconnect();
}

/**
 * Test-only helper. Returns a fresh publisher + subscriber pair against a
 * user-supplied Redis URL, bypassing the pooled singleton. Used by the
 * presence Vitest suite to avoid cross-test leakage.
 */
export function _testPair(url: string): { pub: Redis; sub: Redis } {
  const pub = new IORedis(url, { maxRetriesPerRequest: null });
  const sub = new IORedis(url, { maxRetriesPerRequest: null });
  return { pub, sub };
}
