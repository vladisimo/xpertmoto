import { describe, expect, test } from "vitest";
import {
  readVisitorCookie,
  hashUA,
  displayNameFor,
  toPresenceEvent,
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

  test("extracts scootering_vid when present", () => {
    expect(readVisitorCookie(h("scootering_vid=v_abc123"))).toBe("v_abc123");
  });

  test("extracts among multiple cookies", () => {
    expect(
      readVisitorCookie(h("theme=dark; scootering_vid=v_xyz; cf_bm=foo")),
    ).toBe("v_xyz");
  });

  test("returns null when cookie set but value empty", () => {
    expect(readVisitorCookie(h("scootering_vid="))).toBeNull();
  });

  test("preserves base64 '=' padding in the value", () => {
    expect(readVisitorCookie(h("scootering_vid=abc=="))).toBe("abc==");
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
