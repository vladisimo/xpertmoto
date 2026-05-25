import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// getSecret/getString are the only external dependencies of trackServer.
// Default them to a configured PostHog so the happy path posts; individual
// tests override getSecret to null to exercise the disabled gate.
const getSecret = vi.fn();
const getString = vi.fn();

vi.mock("@/lib/integration-config", () => ({
  getSecret: (...args: unknown[]) => getSecret(...args),
  getString: (...args: unknown[]) => getString(...args),
}));

vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

type FetchMock = ReturnType<typeof vi.fn>;

function lastBody(fetchMock: FetchMock): Record<string, unknown> {
  const call = fetchMock.mock.calls.at(-1);
  return JSON.parse((call?.[1] as RequestInit).body as string);
}

let fetchMock: FetchMock;

beforeEach(() => {
  getSecret.mockResolvedValue("phc_server_key");
  getString.mockResolvedValue("https://ph.example.com");
  fetchMock = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("trackServer", () => {
  it("posts a capture event with merged $set, $set_once and $groups", async () => {
    const { trackServer } = await import("@/lib/analytics");
    await trackServer({
      event: "booking.confirmed",
      distinctId: "user_1",
      properties: { bookingId: "b1", totalAud: 100 },
      set: { lifetimeBookings: 3 },
      setOnce: { firstBookingAt: "2024-01-01T00:00:00.000Z" },
      groups: { depot: "brisbane-cbd" },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://ph.example.com/i/v0/e/");
    expect((init as RequestInit).keepalive).toBe(true);

    const body = lastBody(fetchMock);
    expect(body.api_key).toBe("phc_server_key");
    expect(body.event).toBe("booking.confirmed");
    expect(body.distinct_id).toBe("user_1");
    const props = body.properties as Record<string, unknown>;
    expect(props.bookingId).toBe("b1");
    expect(props.$set).toEqual({ lifetimeBookings: 3 });
    expect(props.$set_once).toEqual({ firstBookingAt: "2024-01-01T00:00:00.000Z" });
    expect(props.$groups).toEqual({ depot: "brisbane-cbd" });
    expect(typeof body.timestamp).toBe("string");
  });

  it("omits reserved keys when not provided", async () => {
    const { trackServer } = await import("@/lib/analytics");
    await trackServer({ event: "e", distinctId: "u", properties: { a: 1 } });
    const props = lastBody(fetchMock).properties as Record<string, unknown>;
    expect(props).toEqual({ a: 1 });
    expect("$set" in props).toBe(false);
    expect("$groups" in props).toBe(false);
    // Person processing is the default — no suppression flag emitted.
    expect("$process_person_profile" in props).toBe(false);
  });

  it("emits $process_person_profile:false for non-person distinct ids", async () => {
    const { trackServer } = await import("@/lib/analytics");
    await trackServer({ event: "visitor.click", distinctId: "v_abc", processPerson: false });
    const props = lastBody(fetchMock).properties as Record<string, unknown>;
    expect(props.$process_person_profile).toBe(false);
  });

  it("does not emit the suppression flag when processPerson is true", async () => {
    const { trackServer } = await import("@/lib/analytics");
    await trackServer({ event: "e", distinctId: "user_1", processPerson: true });
    const props = lastBody(fetchMock).properties as Record<string, unknown>;
    expect("$process_person_profile" in props).toBe(false);
  });

  it("no-ops when the server key is not configured", async () => {
    getSecret.mockResolvedValue(null);
    const { trackServer } = await import("@/lib/analytics");
    await trackServer({ event: "e", distinctId: "u" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("swallows fetch failures", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const { trackServer } = await import("@/lib/analytics");
    await expect(trackServer({ event: "e", distinctId: "u" })).resolves.toBeUndefined();
  });

  it("falls back to the default host when none is configured", async () => {
    getString.mockResolvedValue(null);
    const { trackServer } = await import("@/lib/analytics");
    await trackServer({ event: "e", distinctId: "u" });
    expect(fetchMock.mock.calls[0]![0]).toBe("https://us.i.posthog.com/i/v0/e/");
  });
});

describe("trackServerBatch", () => {
  it("posts all events in one /batch/ request, preserving per-item timestamps", async () => {
    const { trackServerBatch } = await import("@/lib/analytics");
    await trackServerBatch([
      { event: "visitor.cta_click", distinctId: "vid", timestamp: new Date("2026-01-01T00:00:00.000Z"), groups: { depot: "d1" } },
      { event: "visitor.scroll_depth", distinctId: "vid", properties: { numericValue: 75 } },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe("https://ph.example.com/batch/");
    const body = lastBody(fetchMock);
    expect(body.api_key).toBe("phc_server_key");
    const batch = body.batch as Array<Record<string, unknown>>;
    expect(batch).toHaveLength(2);
    expect(batch[0]!.event).toBe("visitor.cta_click");
    expect(batch[0]!.timestamp).toBe("2026-01-01T00:00:00.000Z");
    expect((batch[0]!.properties as Record<string, unknown>).$groups).toEqual({ depot: "d1" });
    expect(batch[1]!.event).toBe("visitor.scroll_depth");
  });

  it("is a no-op on an empty array (no fetch)", async () => {
    const { trackServerBatch } = await import("@/lib/analytics");
    await trackServerBatch([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("trackServerIdentify", () => {
  it("emits a $identify event with $set/$set_once", async () => {
    const { trackServerIdentify } = await import("@/lib/analytics");
    await trackServerIdentify({
      distinctId: "user_9",
      set: { email: "a@b.com", name: "Jane", role: "CUSTOMER" },
      setOnce: { firstSeenAt: "2026-01-01T00:00:00.000Z" },
    });
    const body = lastBody(fetchMock);
    expect(body.event).toBe("$identify");
    expect(body.distinct_id).toBe("user_9");
    const props = body.properties as Record<string, unknown>;
    expect(props.$set).toEqual({ email: "a@b.com", name: "Jane", role: "CUSTOMER" });
    expect(props.$set_once).toEqual({ firstSeenAt: "2026-01-01T00:00:00.000Z" });
  });
});

describe("trackAiGeneration", () => {
  it("maps to a $ai_generation event with reserved $ai_* properties", async () => {
    const { trackAiGeneration } = await import("@/lib/analytics");
    await trackAiGeneration({
      distinctId: "user_7",
      model: "claude-sonnet-4-6",
      provider: "anthropic",
      feature: "ocr",
      inputTokens: 1200,
      outputTokens: 64,
      latencySeconds: 1.5,
      costUsd: 0.012,
      traceId: "conv_1",
      cacheReadTokens: 800,
      properties: { kind: "LICENCE" },
      groups: { depot: "brisbane-cbd" },
    });
    const body = lastBody(fetchMock);
    expect(body.event).toBe("$ai_generation");
    expect(body.distinct_id).toBe("user_7");
    const props = body.properties as Record<string, unknown>;
    expect(props.$ai_model).toBe("claude-sonnet-4-6");
    expect(props.$ai_provider).toBe("anthropic");
    expect(props.$ai_input_tokens).toBe(1200);
    expect(props.$ai_output_tokens).toBe(64);
    expect(props.$ai_latency).toBe(1.5);
    expect(props.$ai_total_cost_usd).toBe(0.012);
    expect(props.$ai_trace_id).toBe("conv_1");
    expect(props.feature).toBe("ocr");
    expect(props.cacheReadTokens).toBe(800);
    expect(props.kind).toBe("LICENCE");
    expect(props.$groups).toEqual({ depot: "brisbane-cbd" });
  });

  it("omits optional $ai_* keys when not supplied", async () => {
    const { trackAiGeneration } = await import("@/lib/analytics");
    await trackAiGeneration({
      distinctId: "u",
      model: "m",
      provider: "openrouter",
      feature: "support",
    });
    const props = lastBody(fetchMock).properties as Record<string, unknown>;
    expect(props.$ai_model).toBe("m");
    expect("$ai_input_tokens" in props).toBe(false);
    expect("$ai_total_cost_usd" in props).toBe(false);
    expect("$ai_trace_id" in props).toBe(false);
  });
});

describe("trackServerGroupIdentify", () => {
  it("emits a $groupidentify with matching group key", async () => {
    const { trackServerGroupIdentify } = await import("@/lib/analytics");
    await trackServerGroupIdentify({
      groupType: "depot",
      groupKey: "brisbane-cbd",
      set: { name: "Brisbane CBD", state: "QLD" },
    });
    const body = lastBody(fetchMock);
    expect(body.event).toBe("$groupidentify");
    expect(body.distinct_id).toBe("$depot_brisbane-cbd");
    const props = body.properties as Record<string, unknown>;
    expect(props.$group_type).toBe("depot");
    expect(props.$group_key).toBe("brisbane-cbd");
    expect(props.$group_set).toEqual({ name: "Brisbane CBD", state: "QLD" });
  });
});
