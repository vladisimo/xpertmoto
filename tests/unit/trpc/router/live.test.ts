import { describe, expect, test, vi, beforeEach } from "vitest";

const posthogServerEnabled = vi.fn();
const trackServerBatch = vi.fn();
vi.mock("@/lib/analytics", () => ({
  posthogServerEnabled: (...a: unknown[]) => posthogServerEnabled(...a),
  trackServerBatch: (...a: unknown[]) => trackServerBatch(...a),
}));

import {
  readVisitorCookie,
  hashUA,
  displayNameFor,
  toPresenceEvent,
  fanOutVisitorEvents,
} from "@/server/trpc/router/live";

function h(cookieValue: string | null): { headers: Headers } {
  const headers = new Headers();
  if (cookieValue) headers.set("cookie", cookieValue);
  return { headers };
}

describe("readVisitorCookie", () => {
  test("returns null when cookie header missing", () => {
    expect(readVisitorCookie(h(null))).toBeNull();
  });

  test("extracts xpertmoto_vid when present", () => {
    expect(readVisitorCookie(h("xpertmoto_vid=v_abc123"))).toBe("v_abc123");
  });

  test("extracts among multiple cookies", () => {
    expect(
      readVisitorCookie(h("theme=dark; xpertmoto_vid=v_xyz; cf_bm=foo")),
    ).toBe("v_xyz");
  });

  test("returns null when cookie set but value empty", () => {
    expect(readVisitorCookie(h("xpertmoto_vid="))).toBeNull();
  });

  test("preserves base64 '=' padding in the value", () => {
    expect(readVisitorCookie(h("xpertmoto_vid=abc=="))).toBe("abc==");
  });
});

describe("hashUA", () => {
  test("always returns a 32-char hex string", () => {
    const out = hashUA("Mozilla/5.0 (X11; Linux)");
    expect(out).toMatch(/^[a-f0-9]{32}$/);
  });

  test("is deterministic for same input", () => {
    expect(hashUA("Mozilla/5.0")).toBe(hashUA("Mozilla/5.0"));
  });

  test("differs by input", () => {
    expect(hashUA("A")).not.toBe(hashUA("B"));
  });

  test("tolerates null / undefined", () => {
    expect(hashUA(null)).toMatch(/^[a-f0-9]{32}$/);
    expect(hashUA(undefined)).toMatch(/^[a-f0-9]{32}$/);
    expect(hashUA(null)).toBe(hashUA(undefined));
  });
});

describe("displayNameFor", () => {
  test("null user → null", () => {
    expect(displayNameFor(null)).toBeNull();
  });

  test("all empty → null", () => {
    expect(displayNameFor({ firstName: "", lastName: "" })).toBeNull();
    expect(displayNameFor({ firstName: null, lastName: null })).toBeNull();
  });

  test("first + last composes with space", () => {
    expect(displayNameFor({ firstName: "Ada", lastName: "Lovelace" })).toBe("Ada Lovelace");
  });

  test("first only trims trailing space", () => {
    expect(displayNameFor({ firstName: "Ada", lastName: null })).toBe("Ada");
  });
});

describe("toPresenceEvent", () => {
  const row = {
    id: "v_abc",
    currentPath: "/booking",
    wizardStep: 3 as number | null,
    userId: null as string | null,
    startedAt: new Date("2026-04-18T00:00:00Z"),
    lastSeenAt: new Date("2026-04-18T00:00:30Z"),
    user: null as { firstName: string | null; lastName: string | null } | null,
  };

  test("emits upsert type and ISO timestamps", () => {
    const event = toPresenceEvent(row);
    expect(event.type).toBe("presence.upsert");
    expect(event.sessionId).toBe("v_abc");
    expect(event.startedAt).toBe("2026-04-18T00:00:00.000Z");
    expect(event.lastSeenAt).toBe("2026-04-18T00:00:30.000Z");
  });

  test("includes display name when user joined", () => {
    const event = toPresenceEvent({
      ...row,
      user: { firstName: "Nick", lastName: "Dalton" },
    });
    expect(event.displayName).toBe("Nick Dalton");
  });

  test("null user → null display name", () => {
    const event = toPresenceEvent(row);
    expect(event.displayName).toBeNull();
  });

  test("wizardStep null when not in booking", () => {
    const event = toPresenceEvent({ ...row, wizardStep: null, currentPath: "/" });
    expect(event.wizardStep).toBeNull();
    expect(event.currentPath).toBe("/");
  });
});

describe("fanOutVisitorEvents", () => {
  const depotFindUnique = vi.fn();
  const prisma = { depot: { findUnique: depotFindUnique } };

  beforeEach(() => {
    posthogServerEnabled.mockReset().mockResolvedValue(true);
    trackServerBatch.mockReset().mockResolvedValue(undefined);
    depotFindUnique.mockReset().mockResolvedValue({ slug: "brisbane-cbd" });
  });

  test("maps kinds to visitor.* names and attaches the depot group", async () => {
    await fanOutVisitorEvents(
      prisma,
      [
        { kind: "CTA_CLICK", path: "/booking", target: "hero-book", wizardStep: 2 },
        { kind: "SCROLL_DEPTH", path: "/", numericValue: 75 },
      ],
      "v_abc",
      "depot_1",
    );

    expect(trackServerBatch).toHaveBeenCalledTimes(1);
    const batch = trackServerBatch.mock.calls[0]![0] as Array<Record<string, unknown>>;
    expect(batch).toHaveLength(2);
    expect(batch[0]!.event).toBe("visitor.cta_click");
    expect(batch[0]!.distinctId).toBe("v_abc");
    expect(batch[0]!.groups).toEqual({ depot: "brisbane-cbd" });
    expect((batch[0]!.properties as Record<string, unknown>).target).toBe("hero-book");
    expect((batch[0]!.properties as Record<string, unknown>).wizardStep).toBe(2);
    expect(batch[1]!.event).toBe("visitor.scroll_depth");
    expect((batch[1]!.properties as Record<string, unknown>).numericValue).toBe(75);
  });

  test("omits groups when no depot is on the session", async () => {
    await fanOutVisitorEvents(prisma, [{ kind: "CLICK", path: "/" }], "v_abc", null);
    expect(depotFindUnique).not.toHaveBeenCalled();
    const batch = trackServerBatch.mock.calls[0]![0] as Array<Record<string, unknown>>;
    expect(batch[0]!.groups).toBeUndefined();
  });

  test("no-ops when PostHog is disabled", async () => {
    posthogServerEnabled.mockResolvedValue(false);
    await fanOutVisitorEvents(prisma, [{ kind: "CLICK", path: "/" }], "v_abc", "depot_1");
    expect(trackServerBatch).not.toHaveBeenCalled();
  });

  test("never throws when the batch send fails", async () => {
    trackServerBatch.mockRejectedValue(new Error("boom"));
    await expect(
      fanOutVisitorEvents(prisma, [{ kind: "CLICK", path: "/" }], "v_abc", "depot_1"),
    ).resolves.toBeUndefined();
  });
});

describe("live.events — dedup-constraint safety", () => {
  test("same-batch events without client timestamps get distinct occurredAt fallbacks", async () => {
    const { liveRouter } = await import("@/server/trpc/router/live");
    const createMany = vi.fn().mockResolvedValue({ count: 2 });
    const ctx = {
      headers: h("xpertmoto_vid=v_1").headers,
      prisma: {
        visitorSession: {
          findUnique: vi
            .fn()
            .mockResolvedValue({ id: "v_1", deviceType: "DESKTOP", pickupDepotId: null }),
        },
        visitorEvent: { createMany },
      },
    };
    posthogServerEnabled.mockResolvedValue(false);

    const caller = liveRouter.createCaller(ctx as never);
    const res = await caller.events({
      events: [
        { kind: "RAGE_CLICK", path: "/book" },
        { kind: "RAGE_CLICK", path: "/book" },
      ],
    });

    expect(res.ok).toBe(true);
    const rows = createMany.mock.calls[0]![0].data as Array<{ occurredAt: Date }>;
    // Without distinct fallbacks the (sessionId, kind, occurredAt) unique
    // constraint + skipDuplicates would silently drop the second event.
    expect(rows[0]!.occurredAt.getTime()).not.toBe(rows[1]!.occurredAt.getTime());
  });
});

describe("live.heartbeat — concurrent first-heartbeat create race", () => {
  test("a P2002 on visitorSession.create falls back to a touch update instead of 500ing", async () => {
    const { liveRouter } = await import("@/server/trpc/router/live");
    const { Prisma } = await import("@prisma/client");
    const p2002 = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "5.22.0",
    });
    const now = new Date();
    const update = vi.fn().mockResolvedValue({
      id: "v_race",
      user: null,
      userId: null,
      currentPath: "/booking",
      wizardStep: 1,
      deviceType: "DESKTOP",
      startedAt: now,
      lastSeenAt: now,
    });
    const ctx = {
      headers: h("xpertmoto_vid=v_race").headers,
      ipAddress: null,
      userAgent: "vitest",
      session: null,
      prisma: {
        visitorSession: {
          // No existing row → create branch; the create then loses the race.
          findUnique: vi.fn().mockResolvedValue(null),
          count: vi.fn().mockResolvedValue(0),
          create: vi.fn().mockRejectedValue(p2002),
          update,
        },
        visitorPageView: { create: vi.fn().mockResolvedValue({}) },
      },
    };
    posthogServerEnabled.mockResolvedValue(false);

    const caller = liveRouter.createCaller(ctx as never);
    const res = await caller.heartbeat({ path: "/booking" });

    expect(res.ok).toBe(true);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "v_race" } }),
    );
  });
});
