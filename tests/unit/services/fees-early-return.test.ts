import { describe, expect, test } from "vitest";
import { calcEarlyReturnRefund } from "@/server/services/fees";

const d = (iso: string) => new Date(iso);

describe("calcEarlyReturnRefund", () => {
  test("returns zero when customer is on-time", () => {
    const r = calcEarlyReturnRefund({
      scheduledReturn: d("2026-05-01T10:00:00Z"),
      actualReturn: d("2026-05-01T10:00:00Z"),
      dailyRate: 79,
    });
    expect(r.refund).toBe(0);
    expect(r.unusedDays).toBe(0);
  });

  test("returns zero when customer is late", () => {
    const r = calcEarlyReturnRefund({
      scheduledReturn: d("2026-05-01T10:00:00Z"),
      actualReturn: d("2026-05-02T10:00:00Z"),
      dailyRate: 79,
    });
    expect(r.refund).toBe(0);
    expect(r.unusedDays).toBeLessThanOrEqual(0);
  });

  test("returns zero below the whole-day threshold (23h early)", () => {
    const r = calcEarlyReturnRefund({
      scheduledReturn: d("2026-05-01T10:00:00Z"),
      actualReturn: d("2026-04-30T11:00:00Z"),
      dailyRate: 79,
    });
    expect(r.refund).toBe(0);
    expect(r.unusedDays).toBe(0);
  });

  test("refunds exactly the daily rate for one unused day", () => {
    const r = calcEarlyReturnRefund({
      scheduledReturn: d("2026-05-02T10:00:00Z"),
      actualReturn: d("2026-05-01T10:00:00Z"),
      dailyRate: 79,
    });
    expect(r.unusedDays).toBe(1);
    expect(r.refund).toBe(79);
  });

  test("includes per-day addons and insurance in the refund", () => {
    const r = calcEarlyReturnRefund({
      scheduledReturn: d("2026-05-04T10:00:00Z"),
      actualReturn: d("2026-05-01T10:00:00Z"),
      dailyRate: 79,
      perDayAddonsTotal: 8,
      perDayInsuranceRate: 12,
    });
    expect(r.unusedDays).toBe(3);
    expect(r.refund).toBe((79 + 8 + 12) * 3);
  });

  test("deducts admin fee when configured", () => {
    const r = calcEarlyReturnRefund({
      scheduledReturn: d("2026-05-03T10:00:00Z"),
      actualReturn: d("2026-05-01T10:00:00Z"),
      dailyRate: 79,
      adminFee: 10,
    });
    expect(r.unusedDays).toBe(2);
    expect(r.refund).toBe(79 * 2 - 10);
    expect(r.adminFee).toBe(10);
  });

  test("admin fee never takes refund negative", () => {
    const r = calcEarlyReturnRefund({
      scheduledReturn: d("2026-05-02T10:00:00Z"),
      actualReturn: d("2026-05-01T10:00:00Z"),
      dailyRate: 5,
      adminFee: 50,
    });
    expect(r.refund).toBe(0);
    expect(r.adminFee).toBe(5);
  });

  test("respects a custom minUnusedDays threshold", () => {
    const r = calcEarlyReturnRefund({
      scheduledReturn: d("2026-05-04T10:00:00Z"),
      actualReturn: d("2026-05-02T10:00:00Z"),
      dailyRate: 79,
      minUnusedDays: 3,
    });
    expect(r.unusedDays).toBe(2);
    expect(r.refund).toBe(0);
  });
});
