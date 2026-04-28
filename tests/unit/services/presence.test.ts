import { describe, expect, test, vi, beforeEach } from "vitest";

/**
 * Tests for the presence pub/sub helpers. We avoid spinning up a real
 * Redis by mocking `@/lib/redis` — the helpers should be no-ops when
 * `getRedis()` returns null, and should call through to
 * `publish` / `subscribe` / `sadd` etc. when a client is present.
 */

const mockRedis = {
  publish: vi.fn(async () => 1),
  sadd: vi.fn(async () => 1),
  srem: vi.fn(async () => 1),
  scard: vi.fn(async () => 0),
  subscribe: vi.fn(async () => undefined),
  unsubscribe: vi.fn(async () => undefined),
  disconnect: vi.fn(() => undefined),
  on: vi.fn(),
  duplicate: vi.fn(() => mockRedis),
};

const getRedisMock = vi.fn<() => typeof mockRedis | null>(() => mockRedis);

vi.mock("@/lib/redis", () => ({
  getRedis: () => getRedisMock(),
}));

vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

beforeEach(() => {
  vi.clearAllMocks();
  getRedisMock.mockReturnValue(mockRedis);
});

describe("publishPresence", () => {
  test("publishes JSON to the live:presence channel", async () => {
    const { publishPresence } = await import("@/server/services/presence");
    await publishPresence({
      type: "presence.upsert",
      sessionId: "v_abc",
      currentPath: "/",
      wizardStep: null,
      displayName: null,
      userId: null,
      startedAt: "2026-04-18T00:00:00.000Z",
      lastSeenAt: "2026-04-18T00:00:30.000Z",
    });
    expect(mockRedis.publish).toHaveBeenCalledWith(
      "live:presence",
      expect.stringContaining("presence.upsert"),
    );
  });

  test("no-ops when Redis is unavailable", async () => {
    getRedisMock.mockReturnValue(null);
    const { publishPresence } = await import("@/server/services/presence");
    await publishPresence({ type: "presence.offline", sessionId: "v_abc" });
    expect(mockRedis.publish).not.toHaveBeenCalled();
  });
});

describe("publishChat", () => {
  test("publishes to per-conversation channel", async () => {
    const { publishChat } = await import("@/server/services/presence");
    await publishChat("conv_1", {
      type: "chat.message",
      conversationId: "conv_1",
      messageId: "m1",
      senderRole: "STAFF",
      body: "hi",
      attachments: null,
      createdAt: "2026-04-18T00:00:00.000Z",
    });
    expect(mockRedis.publish).toHaveBeenCalledWith(
      "live:chat:conv_1",
      expect.stringContaining("chat.message"),
    );
  });
});

describe("staff online set", () => {
  test("mark online adds to set and returns count", async () => {
    mockRedis.scard.mockResolvedValueOnce(2);
    const { markStaffOnline } = await import("@/server/services/presence");
    const count = await markStaffOnline("staff_1");
    expect(mockRedis.sadd).toHaveBeenCalledWith("live:staff-online", "staff_1");
    expect(count).toBe(2);
    expect(mockRedis.publish).toHaveBeenCalledWith(
      "live:presence",
      expect.stringContaining("staff.online"),
    );
  });

  test("mark offline removes from set", async () => {
    mockRedis.scard.mockResolvedValueOnce(0);
    const { markStaffOffline } = await import("@/server/services/presence");
    const count = await markStaffOffline("staff_1");
    expect(mockRedis.srem).toHaveBeenCalledWith("live:staff-online", "staff_1");
    expect(count).toBe(0);
  });

  test("getStaffOnlineCount returns 0 when Redis is absent", async () => {
    getRedisMock.mockReturnValue(null);
    const { getStaffOnlineCount } = await import("@/server/services/presence");
    expect(await getStaffOnlineCount()).toBe(0);
  });
});

describe("subscribePresence", () => {
  test("returns null when Redis is absent", async () => {
    getRedisMock.mockReturnValue(null);
    const { subscribePresence } = await import("@/server/services/presence");
    expect(await subscribePresence(() => {})).toBeNull();
  });

  test("subscribes to the live:presence channel and decodes frames", async () => {
    const received: unknown[] = [];
    const { subscribePresence } = await import("@/server/services/presence");

    // Capture the message listener so we can invoke it synthetically.
    type MessageCb = (channel: string, raw: string) => void;
    const listenerRef: { current: MessageCb | null } = { current: null };
    mockRedis.on.mockImplementation((event: string, cb: MessageCb) => {
      if (event === "message") listenerRef.current = cb;
    });

    const handle = await subscribePresence((event) => received.push(event));
    expect(handle).not.toBeNull();
    expect(mockRedis.subscribe).toHaveBeenCalledWith("live:presence");

    listenerRef.current?.(
      "live:presence",
      JSON.stringify({ type: "presence.offline", sessionId: "v_abc" }),
    );
    expect(received).toEqual([{ type: "presence.offline", sessionId: "v_abc" }]);

    await handle?.unsubscribe();
    expect(mockRedis.unsubscribe).toHaveBeenCalled();
    expect(mockRedis.disconnect).toHaveBeenCalled();
  });
});
