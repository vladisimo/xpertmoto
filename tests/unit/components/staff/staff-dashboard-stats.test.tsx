import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  StaffDashboardStats,
  type StaffDashboardStatsData,
} from "@/components/staff/staff-dashboard-stats";

afterEach(cleanup);

const BASE: StaffDashboardStatsData = {
  pickups: 3,
  returns: 4,
  active: 12,
  overdue: { total: 4, due: 1, noticeSent: 2, escalated: 1, over24h: 2 },
  fleet: { total: 40, needsAttention: 5, calendarMistakes: 1, tyreAlerts: 3 },
};

function renderStats(overrides: Partial<StaffDashboardStatsData> = {}) {
  return render(<StaffDashboardStats data={{ ...BASE, ...overrides }} />);
}

describe("StaffDashboardStats", () => {
  it("shows the movements total with pickup/return breakdown", () => {
    renderStats();
    expect(screen.getByText("7")).toBeDefined(); // 3 pickups + 4 returns
    expect(screen.getByText(/pickups/)).toBeDefined();
    expect(screen.getByText(/returns/)).toBeDefined();
  });

  it("splits on-the-road hires into on-time and overdue", () => {
    renderStats();
    expect(screen.getByText("8")).toBeDefined(); // 12 active - 4 overdue
    expect(screen.getByText(/on time/)).toBeDefined();
    expect(screen.getByText(/active hires/)).toBeDefined();
  });

  it("renders the escalation breakdown with the over-24h footer", () => {
    renderStats();
    expect(screen.getByText("Due")).toBeDefined();
    expect(screen.getByText("Notice sent")).toBeDefined();
    expect(screen.getByText("Escalated")).toBeDefined();
    expect(screen.getByText(/2 over 24 hours/)).toBeDefined();
  });

  it("hides the over-24h footer when nothing is that late", () => {
    renderStats({
      overdue: { total: 4, due: 1, noticeSent: 2, escalated: 1, over24h: 0 },
    });
    expect(screen.queryByText(/over 24 hours/)).toBeNull();
  });

  it("shows positive empty states when nothing is out or overdue", () => {
    renderStats({
      active: 0,
      overdue: { total: 0, due: 0, noticeSent: 0, escalated: 0, over24h: 0 },
    });
    expect(screen.getByText("Nothing on hire right now")).toBeDefined();
    expect(screen.getByText("No overdue returns")).toBeDefined();
  });

  it("lists the fleet & maintenance pipeline rows", () => {
    renderStats();
    expect(screen.getByText("Needs attention")).toBeDefined();
    expect(screen.getByText("Calendar mistakes")).toBeDefined();
    expect(screen.getByText("Tyre alerts")).toBeDefined();
  });
});
