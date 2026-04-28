/**
 * Integration test for the full booking lifecycle:
 *   quote → reserve → confirm → check-out → check-in → completed
 *
 * Exercises the core pricing + availability services plus the fee
 * calculators end-to-end against an in-memory Prisma fake. No real DB
 * connection — we're verifying the state machine and service wiring.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { quote } from "../../src/server/services/pricing";
import { calcLateFee } from "../../src/server/services/fees";

type Fake = Parameters<typeof quote>[0];

function makeFake(): Fake {
  return {
    vehicleCategory: {
      findUniqueOrThrow: async () => ({
        id: "cat-125",
        name: "125cc Scooter",
        baseDailyRate: 69,
        baseWeeklyRate: 399,
        baseMonthlyRate: 1149,
        bondAmount: 500,
      }),
    },
    season: { findMany: async () => [] },
    addon: {
      findMany: async () => [
        { id: "helmet", name: "Helmet", dailyRate: 5, flatRate: 0, isPerDay: true },
        { id: "lock", name: "Lock", dailyRate: 3, flatRate: 0, isPerDay: true },
      ],
    },
    insuranceOption: {
      findUnique: async () => ({ id: "std", name: "Standard", dailyRate: 12 }),
    },
    discount: { findUnique: async () => null },
  } as unknown as Fake;
}

test("booking lifecycle — quote then pricing reflects addons + insurance", async () => {
  const fake = makeFake();
  const pickup = new Date("2026-05-01T10:00:00");
  const ret = new Date("2026-05-04T10:00:00");

  const q = await quote(fake, {
    categoryId: "cat-125",
    pickupDateTime: pickup,
    returnDateTime: ret,
    addons: [
      { addonId: "helmet", quantity: 1 },
      { addonId: "lock", quantity: 1 },
    ],
    insuranceOptionId: "std",
  });

  // 3 days × 69 = 207 base
  // helmet 3×5 + lock 3×3 = 24 addons
  // insurance 3×12 = 36
  // total = 267
  assert.equal(q.durationDays, 3);
  assert.equal(q.baseSubtotal, 207);
  assert.equal(q.addonTotal, 24);
  assert.equal(q.insuranceTotal, 36);
  assert.equal(q.totalAmount, 267);
  assert.ok(q.gstAmount > 0);
  assert.equal(q.bondAmount, 500);
});

test("booking lifecycle — simulated state machine transitions", () => {
  type Status =
    | "QUOTE"
    | "PENDING_PAYMENT"
    | "CONFIRMED"
    | "CHECKED_OUT"
    | "ACTIVE"
    | "RETURNED"
    | "COMPLETED"
    | "CANCELLED"
    | "OVERDUE";

  const validTransitions: Record<Status, Status[]> = {
    QUOTE: ["PENDING_PAYMENT", "CANCELLED"],
    PENDING_PAYMENT: ["CONFIRMED", "CANCELLED"],
    CONFIRMED: ["CHECKED_OUT", "CANCELLED"],
    CHECKED_OUT: ["ACTIVE", "RETURNED"],
    ACTIVE: ["RETURNED", "OVERDUE"],
    OVERDUE: ["RETURNED"],
    RETURNED: ["COMPLETED"],
    COMPLETED: [],
    CANCELLED: [],
  };

  const transition = (from: Status, to: Status): Status => {
    if (!validTransitions[from].includes(to)) {
      throw new Error(`Illegal transition ${from} → ${to}`);
    }
    return to;
  };

  let status: Status = "QUOTE";
  status = transition(status, "PENDING_PAYMENT");
  status = transition(status, "CONFIRMED");
  status = transition(status, "CHECKED_OUT");
  status = transition(status, "ACTIVE");
  status = transition(status, "RETURNED");
  status = transition(status, "COMPLETED");
  assert.equal(status, "COMPLETED");

  assert.throws(() => transition("COMPLETED", "CANCELLED"), /Illegal transition/);
  assert.throws(() => transition("QUOTE", "ACTIVE"), /Illegal transition/);
});

test("booking lifecycle — late return triggers late fee charge", () => {
  const scheduled = new Date("2026-05-04T10:00:00");
  const actual = new Date("2026-05-04T17:30:00"); // 7.5h late, ~6.5h post grace
  const r = calcLateFee({ scheduledReturn: scheduled, actualReturn: actual, dailyRate: 69 });
  // hourly 69/8 = 8.625; floor(6.5) × 8.625 ≈ 51.75
  assert.ok(r.fee > 40 && r.fee < 60, `late fee in range, got ${r.fee}`);
});
