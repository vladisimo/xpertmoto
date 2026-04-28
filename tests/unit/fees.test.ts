import { test, expect } from "vitest";
import { calcLateFee, calcCancellationRefund } from "../../src/server/services/fees";

test("late fee — within grace period, no charge", () => {
  const scheduled = new Date("2026-04-10T10:00:00");
  const actual = new Date("2026-04-10T10:45:00");
  const r = calcLateFee({ scheduledReturn: scheduled, actualReturn: actual, dailyRate: 80 });
  expect(r.fee).toBe(0);
});

test("late fee — 3 hours late (after grace) charges hourly rate", () => {
  const scheduled = new Date("2026-04-10T10:00:00");
  const actual = new Date("2026-04-10T14:00:00"); // 4h late, 3h post-grace
  const r = calcLateFee({ scheduledReturn: scheduled, actualReturn: actual, dailyRate: 80 });
  // hourly = 80/8 = 10; floor(3) * 10 = 30
  expect(r.fee).toBe(30);
});

test("late fee — capped at daily rate per 24h period", () => {
  const scheduled = new Date("2026-04-10T10:00:00");
  const actual = new Date("2026-04-11T10:00:00"); // 24h late
  const r = calcLateFee({ scheduledReturn: scheduled, actualReturn: actual, dailyRate: 80 });
  // uncapped: floor(23) * 10 = 230, cap: ceil(23/24) * 80 = 80
  expect(r.fee).toBe(80);
});

test("cancellation — >72h before pickup → full refund less admin fee", () => {
  const pickup = new Date(Date.now() + 96 * 3_600_000);
  const r = calcCancellationRefund({ pickupDateTime: pickup, amountPaid: 300 });
  expect(r.refundPct).toBe(1);
  expect(r.refund).toBe(275);
  expect(r.adminFee).toBe(25);
});

test("cancellation — 48h before pickup → 50% refund less admin fee", () => {
  const pickup = new Date(Date.now() + 48 * 3_600_000);
  const r = calcCancellationRefund({ pickupDateTime: pickup, amountPaid: 300 });
  expect(r.refundPct).toBe(0.5);
  expect(r.refund).toBe(125); // 150 - 25
});

test("cancellation — under 24h → no refund", () => {
  const pickup = new Date(Date.now() + 6 * 3_600_000);
  const r = calcCancellationRefund({ pickupDateTime: pickup, amountPaid: 300 });
  expect(r.refundPct).toBe(0);
  expect(r.refund).toBe(0);
});

test("cancellation — admin fee never exceeds gross refund", () => {
  const pickup = new Date(Date.now() + 96 * 3_600_000);
  const r = calcCancellationRefund({ pickupDateTime: pickup, amountPaid: 10 });
  expect(r.refund).toBe(0);
  expect(r.adminFee).toBe(10);
});
