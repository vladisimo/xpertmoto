import { describe, it, expect, vi, beforeEach } from "vitest";

// Stub everything the job pulls at import time so we exercise recipient
// selection + send fan-out in isolation (no DB, no real email render).
const h = vi.hoisted(() => ({
  userFindMany: vi.fn(),
  getTollSummaryStats: vi.fn(),
  getBranding: vi.fn(),
  sendEmail: vi.fn(),
  render: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: { user: { findMany: h.userFindMany } } }));
vi.mock("@/server/services/linkt", () => ({ getTollSummaryStats: h.getTollSummaryStats }));
vi.mock("@/lib/branding", () => ({ getBranding: h.getBranding }));
vi.mock("@/lib/email", () => ({ sendEmail: h.sendEmail }));
vi.mock("@/lib/utils", () => ({ formatCurrency: (n: number) => `A$${n.toFixed(2)}` }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@react-email/render", () => ({ render: h.render }));
vi.mock("../../../emails/linkt-sync-summary", () => ({ default: () => null }));

import { runWeeklyTollSummary } from "@/server/jobs/linkt-summary";

const STATS = {
  totalTolls: 10,
  matchedToBooking: 7,
  unmatchedToBooking: 3,
  withPlate: 9,
  withoutPlate: 1,
  lastSync: { status: "SUCCESS", finishedAt: new Date("2026-06-15T03:00:00Z") },
  recent: [],
  recentTruncated: false,
};

beforeEach(() => {
  h.userFindMany.mockReset();
  h.getTollSummaryStats.mockReset().mockResolvedValue(STATS);
  h.getBranding.mockReset().mockResolvedValue({ siteName: "XPERT Moto" });
  h.sendEmail.mockReset().mockResolvedValue({ id: "e1", via: "resend" });
  h.render.mockReset().mockResolvedValue("<html>digest</html>");
});

describe("runWeeklyTollSummary", () => {
  it("emails every active admin/manager and reports the count sent", async () => {
    h.userFindMany.mockResolvedValue([
      { email: "manager@xpert.test" },
      { email: "admin@xpert.test" },
    ]);

    const sent = await runWeeklyTollSummary();

    expect(sent).toBe(2);
    expect(h.sendEmail).toHaveBeenCalledTimes(2);
    // Restricts to active back-office roles.
    expect(h.userFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { role: { in: ["MANAGER", "ADMIN", "SUPER_ADMIN"] }, status: "ACTIVE" },
      }),
    );
    const arg = h.sendEmail.mock.calls[0]![0];
    expect(arg.subject).toContain("weekly toll summary");
    expect(arg.html).toBe("<html>digest</html>");
    expect(arg.text).toContain("Total tolls: 10");
    expect(arg.to).toBe("manager@xpert.test");
  });

  it("no-ops when there are no recipients", async () => {
    h.userFindMany.mockResolvedValue([]);
    const sent = await runWeeklyTollSummary();
    expect(sent).toBe(0);
    expect(h.getTollSummaryStats).not.toHaveBeenCalled();
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it("counts only successful sends when one recipient fails", async () => {
    h.userFindMany.mockResolvedValue([{ email: "a@x.test" }, { email: "b@x.test" }]);
    h.sendEmail.mockRejectedValueOnce(new Error("smtp down"));
    const sent = await runWeeklyTollSummary();
    expect(sent).toBe(1);
  });
});
