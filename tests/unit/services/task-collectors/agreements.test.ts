import { describe, expect, it } from "vitest";
import { collectAgreementTasks } from "../../../../src/server/services/task-collectors/agreements";
import type { PrismaLike } from "../../../../src/server/services/staff-ops-signals";

const now = new Date("2026-04-18T10:00:00Z");

function mockDb(rows: unknown[]): PrismaLike {
  return {
    rentalAgreement: {
      findMany: async () => rows,
    },
  } as unknown as PrismaLike;
}

describe("collectAgreementTasks", () => {
  it("emits RENTAL_AGREEMENT_SIGN with URGENT tier when pickup is past", async () => {
    const db = mockDb([
      {
        id: "a1",
        agreementNumber: "AGR-001-v1",
        createdAt: new Date("2026-04-18T08:00:00Z"),
        booking: {
          id: "b1",
          bookingReference: "SCT-A1",
          pickupDateTime: new Date("2026-04-18T09:00:00Z"),
          depotId: "d1",
          customer: { firstName: "Jess", lastName: "Ng" },
        },
      },
    ]);
    const [task] = await collectAgreementTasks(db, { now });
    expect(task?.taskType).toBe("RENTAL_AGREEMENT_SIGN");
    expect(task?.tier).toBe("URGENT");
    expect(task?.actionUrl).toBe("/staff/bookings/b1/check-out/sign");
  });

  it("emits HIGH tier when pickup is within 2h", async () => {
    const db = mockDb([
      {
        id: "a2",
        agreementNumber: "AGR-002-v1",
        createdAt: new Date(),
        booking: {
          id: "b2",
          bookingReference: "SCT-A2",
          pickupDateTime: new Date("2026-04-18T11:30:00Z"),
          depotId: "d1",
          customer: { firstName: "Ben", lastName: "Smith" },
        },
      },
    ]);
    const [task] = await collectAgreementTasks(db, { now });
    expect(task?.tier).toBe("HIGH");
  });
});
