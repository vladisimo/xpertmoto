import { describe, expect, it } from "vitest";

import {
  NOMINATION_WINDOW_DAYS,
  computeNominationDeadline,
  daysUntilDeadline,
  defaultHandlingForType,
  isDemeritType,
} from "@/lib/nsw-nomination";

describe("nsw-nomination", () => {
  it("computes the 21-day nomination deadline from the issue date", () => {
    const issue = new Date(Date.UTC(2026, 5, 1)); // 1 Jun 2026
    expect(computeNominationDeadline(issue).toISOString().slice(0, 10)).toBe("2026-06-22");
    expect(NOMINATION_WINDOW_DAYS).toBe(21);
  });

  it("classifies demerit-bearing offence types", () => {
    for (const t of ["SPEEDING", "RED_LIGHT", "MOBILE_PHONE", "SEATBELT"]) {
      expect(isDemeritType(t)).toBe(true);
    }
    for (const t of ["PARKING", "TOLL", "UNREGISTERED", "OTHER"]) {
      expect(isDemeritType(t)).toBe(false);
    }
  });

  it("defaults handling: demerit → nominate, else pay-and-recover", () => {
    expect(defaultHandlingForType("SPEEDING")).toBe("NOMINATE_DRIVER");
    expect(defaultHandlingForType("RED_LIGHT")).toBe("NOMINATE_DRIVER");
    expect(defaultHandlingForType("PARKING")).toBe("PAY_AND_RECOVER");
    expect(defaultHandlingForType("TOLL")).toBe("PAY_AND_RECOVER");
  });

  it("counts whole calendar days to the deadline (negative once overdue)", () => {
    const now = new Date(Date.UTC(2026, 5, 1, 13, 30));
    expect(daysUntilDeadline(new Date(Date.UTC(2026, 5, 3)), now)).toBe(2);
    expect(daysUntilDeadline(new Date(Date.UTC(2026, 5, 1)), now)).toBe(0);
    expect(daysUntilDeadline(new Date(Date.UTC(2026, 4, 30)), now)).toBe(-2);
  });
});
