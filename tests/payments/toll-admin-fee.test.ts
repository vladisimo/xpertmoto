import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * G10 — toll admin fee config.
 *
 *   - getTollAdminFee returns the default $2.50 when unset.
 *   - Respects SystemSetting value (via getString fallback path).
 *   - Rejects negative or non-numeric settings (returns 0 defensively).
 *   - tollChargeAmount sums toll + fee and rounds to cents.
 */

const getString = vi.fn();
const setString = vi.fn();

vi.mock("@/lib/integration-config", () => ({
  getString: (...args: unknown[]) => getString(...args),
  setString: (...args: unknown[]) => setString(...args),
}));

beforeEach(() => {
  getString.mockReset();
  setString.mockClear();
});

describe("toll-admin-fee", () => {
  it("returns default $2.50 when no setting is present", async () => {
    getString.mockResolvedValue(null);
    const { getTollAdminFee } = await import("@/server/services/toll-admin-fee");
    expect(await getTollAdminFee()).toBe(2.5);
  });

  it("returns the configured value when present", async () => {
    getString.mockResolvedValue("4.50");
    const { getTollAdminFee } = await import("@/server/services/toll-admin-fee");
    expect(await getTollAdminFee()).toBe(4.5);
  });

  it("returns 0 defensively when setting is malformed", async () => {
    getString.mockResolvedValue("not-a-number");
    const { getTollAdminFee } = await import("@/server/services/toll-admin-fee");
    expect(await getTollAdminFee()).toBe(0);
  });

  it("returns 0 when setting is negative", async () => {
    getString.mockResolvedValue("-5.00");
    const { getTollAdminFee } = await import("@/server/services/toll-admin-fee");
    expect(await getTollAdminFee()).toBe(0);
  });

  it("setTollAdminFee rejects negative values", async () => {
    const { setTollAdminFee } = await import("@/server/services/toll-admin-fee");
    await expect(setTollAdminFee(-1)).rejects.toThrow();
  });

  it("tollChargeAmount is toll + fee rounded to cents", async () => {
    const { tollChargeAmount } = await import("@/server/services/toll-admin-fee");
    expect(tollChargeAmount(10.334, 2.5)).toBeCloseTo(12.83, 2);
    expect(tollChargeAmount(0, 2.5)).toBe(2.5);
  });
});
