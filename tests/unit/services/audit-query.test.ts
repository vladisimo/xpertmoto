import { describe, expect, test } from "vitest";
import { buildAuditWhere } from "@/server/services/audit-query";

describe("buildAuditWhere", () => {
  test("returns empty where for undefined input", () => {
    expect(buildAuditWhere(undefined)).toEqual({});
  });

  test("applies from/to bounds on timestamp", () => {
    const from = new Date("2026-01-01T00:00:00Z");
    const to = new Date("2026-02-01T00:00:00Z");
    expect(buildAuditWhere({ from, to })).toEqual({
      timestamp: { gte: from, lte: to },
    });
  });

  test("categoryIn takes precedence over single category", () => {
    const w = buildAuditWhere({
      category: "AUTH",
      categoryIn: ["MUTATION", "QUERY"],
    });
    expect(w.category).toEqual({ in: ["MUTATION", "QUERY"] });
  });

  test("falls back to single category when categoryIn is empty", () => {
    const w = buildAuditWhere({ category: "AUTH", categoryIn: [] });
    expect(w.category).toBe("AUTH");
  });

  test("action does case-insensitive contains search", () => {
    const w = buildAuditWhere({ action: "booking" });
    expect(w.action).toEqual({ contains: "booking", mode: "insensitive" });
  });

  test("entityId pins the where to a specific record", () => {
    const w = buildAuditWhere({ entity: "User", entityId: "cust-123" });
    expect(w.entity).toBe("User");
    expect(w.entityId).toBe("cust-123");
  });

  test("cursor produces the OR (timestamp<lt) | (timestamp=eq, id<lt) pair", () => {
    const ts = new Date("2026-03-01T12:00:00Z");
    const w = buildAuditWhere({ cursor: { timestamp: ts, id: "row-99" } });
    expect(w.OR).toEqual([
      { timestamp: { lt: ts } },
      { timestamp: ts, id: { lt: "row-99" } },
    ]);
  });

  test("userId and status compose with the other filters", () => {
    const w = buildAuditWhere({
      userId: "u-1",
      status: "FAILURE",
      entity: "User",
      entityId: "u-1",
    });
    expect(w).toMatchObject({
      userId: "u-1",
      status: "FAILURE",
      entity: "User",
      entityId: "u-1",
    });
  });
});
