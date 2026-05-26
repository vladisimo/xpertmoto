import { describe, expect, it } from "vitest";
import { basQuarterOf, recentBasQuarters } from "@/lib/finance/bas-quarter";

describe("basQuarterOf", () => {
  it("maps 25 May 2026 to Q4 FY2026 (Apr–Jun 2026)", () => {
    const q = basQuarterOf(new Date(2026, 4, 25)); // month is 0-based → May
    expect(q).toMatchObject({
      fy: 2026,
      quarter: 4,
      from: "2026-04-01",
      to: "2026-06-30",
      label: "Q4 FY2026 (Apr–Jun 2026)",
    });
  });

  it("maps 15 Jan 2026 to Q3 FY2026 (Jan–Mar 2026)", () => {
    const q = basQuarterOf(new Date(2026, 0, 15));
    expect(q).toMatchObject({ fy: 2026, quarter: 3, from: "2026-01-01", to: "2026-03-31" });
  });

  it("maps 1 Aug 2025 to Q1 FY2026 (Jul–Sep 2025)", () => {
    const q = basQuarterOf(new Date(2025, 7, 1));
    expect(q).toMatchObject({ fy: 2026, quarter: 1, from: "2025-07-01", to: "2025-09-30" });
  });

  it("maps 1 Nov 2025 to Q2 FY2026 (Oct–Dec 2025)", () => {
    const q = basQuarterOf(new Date(2025, 10, 1));
    expect(q).toMatchObject({ fy: 2026, quarter: 2, from: "2025-10-01", to: "2025-12-31" });
  });
});

describe("recentBasQuarters", () => {
  it("returns `count` quarters newest-first ending at the current one", () => {
    const qs = recentBasQuarters(new Date(2026, 4, 25), 4);
    expect(qs).toHaveLength(4);
    expect(qs[0]).toMatchObject({ fy: 2026, quarter: 4 });
    expect(qs[1]).toMatchObject({ fy: 2026, quarter: 3 });
    expect(qs[2]).toMatchObject({ fy: 2026, quarter: 2 });
    expect(qs[3]).toMatchObject({ fy: 2026, quarter: 1 });
  });

  it("rolls the FY back correctly when stepping past Q1", () => {
    const qs = recentBasQuarters(new Date(2025, 7, 1), 2); // Q1 FY2026 then back to Q4 FY2025
    expect(qs[0]).toMatchObject({ fy: 2026, quarter: 1 });
    expect(qs[1]).toMatchObject({ fy: 2025, quarter: 4, from: "2025-04-01", to: "2025-06-30" });
  });
});
