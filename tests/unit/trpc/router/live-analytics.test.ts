import { describe, expect, test } from "vitest";
import { maxStep, safeReferrerHost, wizardStateToColumns } from "@/server/trpc/router/live";
import { classifyDevice, hashIp } from "@/lib/geo-ip";

describe("maxStep", () => {
  test("prefers the higher of two numbers", () => {
    expect(maxStep(3, 5)).toBe(5);
    expect(maxStep(5, 3)).toBe(5);
  });

  test("returns the non-null value when the other is null", () => {
    expect(maxStep(null, 4)).toBe(4);
    expect(maxStep(4, null)).toBe(4);
  });

  test("returns null when both null", () => {
    expect(maxStep(null, null)).toBeNull();
  });

  test("handles zero correctly (higher wizardStep wins over 0)", () => {
    expect(maxStep(0, 2)).toBe(2);
  });
});

describe("safeReferrerHost", () => {
  test("returns null for missing input", () => {
    expect(safeReferrerHost(null)).toBeNull();
    expect(safeReferrerHost(undefined)).toBeNull();
    expect(safeReferrerHost("")).toBeNull();
  });

  test("extracts host from a full URL", () => {
    expect(safeReferrerHost("https://www.google.com/search?q=scootering")).toBe("www.google.com");
    expect(safeReferrerHost("http://facebook.com/")).toBe("facebook.com");
  });

  test("accepts bare hostnames", () => {
    expect(safeReferrerHost("bing.com")).toBe("bing.com");
    expect(safeReferrerHost("bing.com/ref")).toBe("bing.com");
  });

  test("truncates very long fallback strings", () => {
    const long = "a".repeat(500);
    const out = safeReferrerHost(long);
    expect(out?.length).toBeLessThanOrEqual(200);
  });
});

describe("classifyDevice", () => {
  test("empty UA → DESKTOP", () => {
    expect(classifyDevice(null)).toBe("DESKTOP");
    expect(classifyDevice(undefined)).toBe("DESKTOP");
  });

  test("bot UAs are flagged as BOT", () => {
    expect(classifyDevice("Mozilla/5.0 (compatible; Googlebot/2.1)")).toBe("BOT");
    expect(classifyDevice("Mozilla/5.0 (compatible; bingbot/2.0)")).toBe("BOT");
  });

  test("iPhone → MOBILE", () => {
    const ua =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15";
    expect(classifyDevice(ua)).toBe("MOBILE");
  });

  test("Android phone (mobile) → MOBILE", () => {
    const ua = "Mozilla/5.0 (Linux; Android 14; Pixel 8 Mobile)";
    expect(classifyDevice(ua)).toBe("MOBILE");
  });

  test("iPad → TABLET", () => {
    expect(classifyDevice("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)")).toBe("TABLET");
  });

  test("Android tablet (no Mobile marker) → TABLET", () => {
    expect(classifyDevice("Mozilla/5.0 (Linux; Android 14; Tablet)")).toBe("TABLET");
  });

  test("Desktop Chrome → DESKTOP", () => {
    expect(classifyDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("DESKTOP");
  });
});

describe("wizardStateToColumns", () => {
  test("null snapshot returns empty create + update objects", () => {
    const out = wizardStateToColumns(null);
    expect(out.createData).toEqual({});
    expect(out.updateData).toEqual({});
  });

  test("undefined snapshot returns empty objects", () => {
    const out = wizardStateToColumns(undefined);
    expect(out.createData).toEqual({});
    expect(out.updateData).toEqual({});
  });

  test("populated snapshot maps scalar fields + writes wizardState JSON", () => {
    const snap = {
      step: 3 as const,
      pickupDepotId: "dep_gc",
      returnDepotId: "dep_gc",
      pickupDateTime: "2026-05-01T10:00:00Z",
      returnDateTime: "2026-05-04T10:00:00Z",
      categoryId: "cat_50",
      preferredVehicleId: "veh_honda",
      addons: [{ addonId: "add_helmet", quantity: 1 }],
      insuranceOptionId: "ins_basic",
      discountCode: "SUMMER10",
      isDelivery: false,
      deliveryFee: 0,
      agreedToTerms: false,
      quotedTotalCents: 24900,
    };
    const out = wizardStateToColumns(snap);
    expect(out.createData.pickupDepotId).toBe("dep_gc");
    expect(out.createData.categoryId).toBe("cat_50");
    expect(out.createData.vehicleId).toBe("veh_honda");
    expect(out.createData.discountCode).toBe("SUMMER10");
    expect(out.createData.quotedTotalCents).toBe(24900);
    expect(out.createData.wizardState).toBeDefined();
    // update should mirror create
    expect(out.updateData.pickupDepotId).toBe("dep_gc");
    expect(out.updateData.vehicleId).toBe("veh_honda");
  });

  test("blank discount code becomes null (not empty string)", () => {
    const out = wizardStateToColumns({
      step: 1,
      discountCode: "   ",
    });
    expect(out.createData.discountCode).toBeNull();
    expect(out.updateData.discountCode).toBeNull();
  });

  test("missing optional scalars map to null so columns are cleared", () => {
    const out = wizardStateToColumns({ step: 2 });
    expect(out.updateData.pickupDepotId).toBeNull();
    expect(out.updateData.categoryId).toBeNull();
    expect(out.updateData.vehicleId).toBeNull();
    expect(out.updateData.discountCode).toBeNull();
    expect(out.updateData.quotedTotalCents).toBeNull();
  });
});

describe("hashIp", () => {
  test("returns null when no IP or no salt", () => {
    // Salt may or may not be set in the test env; contract: null input → null.
    expect(hashIp(null)).toBeNull();
    expect(hashIp(undefined)).toBeNull();
    expect(hashIp("")).toBeNull();
  });

  test("when salt is configured, returns a 32-char hex digest", () => {
    if (!process.env.IP_HASH_SALT) return; // skip when unsalted test env
    const out = hashIp("203.0.113.42");
    expect(out).toMatch(/^[a-f0-9]{32}$/);
  });
});
