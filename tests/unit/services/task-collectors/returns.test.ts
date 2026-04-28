import { describe, expect, it } from "vitest";
import { collectReturnAssessmentTasks } from "../../../../src/server/services/task-collectors/returns";
import type { PrismaLike } from "../../../../src/server/services/staff-ops-signals";

const now = new Date("2026-04-18T10:00:00Z");

function mockDb(rows: unknown[]): PrismaLike {
  return {
    returnAssessment: {
      findMany: async () => rows,
    },
  } as unknown as PrismaLike;
}

describe("collectReturnAssessmentTasks", () => {
  it("emits RETURN_ASSESSMENT_FINALISE with HIGH tier when return was before today", async () => {
    const db = mockDb([
      {
        id: "ra1",
        assessmentNumber: "RA-001",
        createdAt: new Date("2026-04-15T12:00:00Z"),
        booking: {
          id: "b1",
          bookingReference: "SCT-R1",
          // Well before `now`'s local midnight in any timezone.
          returnDateTime: new Date("2026-04-15T00:00:00Z"),
          depotId: "d1",
          returnDepotId: "d1",
          customer: { firstName: "Jess", lastName: "Ng" },
        },
      },
    ]);
    const [task] = await collectReturnAssessmentTasks(db, { now });
    expect(task?.taskType).toBe("RETURN_ASSESSMENT_FINALISE");
    expect(task?.tier).toBe("HIGH");
    expect(task?.actionUrl).toBe("/staff/bookings/b1/check-in/settle");
  });

  it("emits MEDIUM tier when the return was today", async () => {
    const db = mockDb([
      {
        id: "ra2",
        assessmentNumber: "RA-002",
        createdAt: now,
        booking: {
          id: "b2",
          bookingReference: "SCT-R2",
          returnDateTime: new Date("2026-04-18T09:00:00Z"),
          depotId: "d1",
          returnDepotId: "d1",
          customer: { firstName: "Ben", lastName: "Smith" },
        },
      },
    ]);
    const [task] = await collectReturnAssessmentTasks(db, { now });
    expect(task?.tier).toBe("MEDIUM");
  });
});
