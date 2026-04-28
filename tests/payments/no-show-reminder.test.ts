import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Pre-cutoff no-show warning.
 *
 *   - Sends EMAIL + SMS for CONFIRMED bookings inside the warning window.
 *   - Window is `[ now - graceHours*60min, now - (graceHours*60 - reminderMin) min ]`
 *     applied to `pickupDateTime`.
 *   - Idempotent: a previously-sent BOOKING_NO_SHOW_WARNING short-circuits.
 *   - Honours the EMAIL/SMS master switches.
 *   - Skips when the configured reminder window is degenerate.
 */

const bookingFindMany = vi.fn();
const notificationFindFirst = vi.fn().mockResolvedValue(null);
const sendNotification = vi.fn().mockResolvedValue({ results: [], logIds: [], notificationIds: [] });
const getSettings = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    booking: { findMany: bookingFindMany },
    notification: { findFirst: notificationFindFirst },
  },
}));

vi.mock("@/server/services/notification-sender", () => ({ sendNotification }));
vi.mock("@/server/jobs/queue", () => ({
  getQueue: vi.fn().mockReturnValue(null),
  registerWorker: vi.fn(),
}));
vi.mock("@/lib/settings", () => ({ getSettings }));

beforeEach(() => {
  bookingFindMany.mockReset();
  notificationFindFirst.mockReset().mockResolvedValue(null);
  sendNotification.mockReset().mockResolvedValue({ results: [], logIds: [], notificationIds: [] });
  getSettings.mockReset().mockResolvedValue({
    "booking.noShowGraceHours": 2,
    "booking.noShowReminderMinutesBefore": 30,
    "notification.enableEmail": true,
    "notification.enableSms": true,
  });
});

describe("no-show-reminder", () => {
  it("queries the correct warning window and sends EMAIL+SMS", async () => {
    bookingFindMany.mockResolvedValue([
      {
        id: "book_warn",
        bookingReference: "SCT-9001",
        customerId: "cust_1",
        pickupDateTime: new Date(Date.now() - 100 * 60 * 1000), // 1h40m ago
        bondAmount: "300.00",
        pickupDepot: { name: "Gold Coast", phone: "07-1234-5678" },
      },
    ]);
    const { runNoShowReminder } = await import("@/server/jobs/no-show-reminder");
    const r = await runNoShowReminder();

    expect(r.warned).toBe(1);
    const where = bookingFindMany.mock.calls[0]![0].where as {
      pickupDateTime: { gt: Date; lte: Date };
    };
    // Earliest: now - 2h. Latest: now - (120 - 30) = now - 90m.
    const earliestAgoMin = (Date.now() - where.pickupDateTime.gt.getTime()) / 60000;
    const latestAgoMin = (Date.now() - where.pickupDateTime.lte.getTime()) / 60000;
    expect(earliestAgoMin).toBeGreaterThan(119);
    expect(earliestAgoMin).toBeLessThan(121);
    expect(latestAgoMin).toBeGreaterThan(89);
    expect(latestAgoMin).toBeLessThan(91);

    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "BOOKING_NO_SHOW_WARNING",
        channels: ["EMAIL", "SMS"],
        bookingId: "book_warn",
        dedupKey: "no-show-warning:book_warn",
      }),
    );
    const sentBody = (sendNotification.mock.calls[0]![0] as { body: string }).body;
    expect(sentBody).toContain("A$300.00 bond");
    expect(sentBody).toContain("Gold Coast");
  });

  it("skips when an existing warning notification has already been recorded", async () => {
    bookingFindMany.mockResolvedValue([
      {
        id: "book_dup",
        bookingReference: "SCT-9002",
        customerId: "cust_1",
        pickupDateTime: new Date(Date.now() - 100 * 60 * 1000),
        bondAmount: "0",
        pickupDepot: null,
      },
    ]);
    notificationFindFirst.mockResolvedValue({ id: "notif_existing" });

    const { runNoShowReminder } = await import("@/server/jobs/no-show-reminder");
    const r = await runNoShowReminder();
    expect(r.warned).toBe(0);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("does not send when both EMAIL and SMS master switches are off", async () => {
    getSettings.mockResolvedValue({
      "booking.noShowGraceHours": 2,
      "booking.noShowReminderMinutesBefore": 30,
      "notification.enableEmail": false,
      "notification.enableSms": false,
    });
    bookingFindMany.mockResolvedValue([
      {
        id: "book_silent",
        bookingReference: "SCT-9003",
        customerId: "cust_1",
        pickupDateTime: new Date(Date.now() - 100 * 60 * 1000),
        bondAmount: "0",
        pickupDepot: null,
      },
    ]);
    const { runNoShowReminder } = await import("@/server/jobs/no-show-reminder");
    const r = await runNoShowReminder();
    expect(r.warned).toBe(0);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("clamps the upper bound to now when reminderMin > grace*60", async () => {
    // grace=0.5h, reminder=60min — reminder exceeds the full grace window.
    // Without clamping, the upper bound would land 30min in the future and
    // we'd warn customers whose pickup hasn't happened yet.
    getSettings.mockResolvedValue({
      "booking.noShowGraceHours": 0.5,
      "booking.noShowReminderMinutesBefore": 60,
      "notification.enableEmail": true,
      "notification.enableSms": true,
    });
    bookingFindMany.mockResolvedValue([]);
    const { runNoShowReminder } = await import("@/server/jobs/no-show-reminder");
    await runNoShowReminder();
    const where = bookingFindMany.mock.calls[0]![0].where as {
      pickupDateTime: { gt: Date; lte: Date };
    };
    expect(where.pickupDateTime.lte.getTime()).toBeLessThanOrEqual(Date.now() + 10);
  });
});
