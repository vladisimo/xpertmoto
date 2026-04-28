import { describe, it, expect, vi, beforeEach } from "vitest";

const findUnique = vi.fn();
const findMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    systemSetting: {
      findUnique: (...args: unknown[]) => findUnique(...args),
      findMany: (...args: unknown[]) => findMany(...args),
    },
  },
}));

beforeEach(() => {
  findUnique.mockReset();
  findMany.mockReset();
});

describe("getSetting", () => {
  it("returns the stored value when the row exists", async () => {
    findUnique.mockResolvedValue({ key: "booking.minDays", value: 3 });
    const { getSetting } = await import("@/lib/settings");
    await expect(getSetting("booking.minDays", 1)).resolves.toBe(3);
  });

  it("falls back when the row is missing", async () => {
    findUnique.mockResolvedValue(null);
    const { getSetting } = await import("@/lib/settings");
    await expect(getSetting("booking.minDays", 1)).resolves.toBe(1);
  });

  it("falls back when the stored value is null", async () => {
    findUnique.mockResolvedValue({ key: "booking.minDays", value: null });
    const { getSetting } = await import("@/lib/settings");
    await expect(getSetting("booking.minDays", 1)).resolves.toBe(1);
  });

  it("falls back when Prisma throws", async () => {
    findUnique.mockRejectedValue(new Error("db unavailable"));
    const { getSetting } = await import("@/lib/settings");
    await expect(getSetting("booking.minDays", 7)).resolves.toBe(7);
  });

  it("preserves complex JSON shapes", async () => {
    const retention = { enabled: true, retention: { AUTH: 365 } };
    findUnique.mockResolvedValue({ key: "audit.retention", value: retention });
    const { getSetting, SETTING_DEFAULTS } = await import("@/lib/settings");
    const out = await getSetting("audit.retention", SETTING_DEFAULTS["audit.retention"]);
    expect(out).toEqual(retention);
  });
});

describe("getSettings batch", () => {
  it("maps multiple keys in a single query", async () => {
    findMany.mockResolvedValue([
      { key: "booking.minDays", value: 2 },
      { key: "booking.maxDays", value: 60 },
    ]);
    const { getSettings } = await import("@/lib/settings");
    const out = await getSettings(["booking.minDays", "booking.maxDays"] as const);
    expect(out["booking.minDays"]).toBe(2);
    expect(out["booking.maxDays"]).toBe(60);
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it("falls back each key independently when a row is missing", async () => {
    findMany.mockResolvedValue([{ key: "booking.minDays", value: 2 }]);
    const { getSettings, SETTING_DEFAULTS } = await import("@/lib/settings");
    const out = await getSettings(["booking.minDays", "booking.maxDays"] as const);
    expect(out["booking.minDays"]).toBe(2);
    expect(out["booking.maxDays"]).toBe(SETTING_DEFAULTS["booking.maxDays"]);
  });

  it("returns defaults for every key when Prisma throws", async () => {
    findMany.mockRejectedValue(new Error("down"));
    const { getSettings, SETTING_DEFAULTS } = await import("@/lib/settings");
    const out = await getSettings(["cancellation.adminFee", "tax.gstRate"] as const);
    expect(out["cancellation.adminFee"]).toBe(SETTING_DEFAULTS["cancellation.adminFee"]);
    expect(out["tax.gstRate"]).toBe(SETTING_DEFAULTS["tax.gstRate"]);
  });
});
