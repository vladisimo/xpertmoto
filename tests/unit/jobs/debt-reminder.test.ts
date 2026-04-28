import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/server/services/admin-risk-signals", () => ({
  debtorsList: vi.fn(),
}));
vi.mock("../../../src/server/services/notification-sender", () => ({
  sendNotification: vi.fn(),
}));

import { runDebtReminder } from "../../../src/server/jobs/debt-reminder";
import { debtorsList } from "../../../src/server/services/admin-risk-signals";
import { sendNotification } from "../../../src/server/services/notification-sender";

const mockedList = debtorsList as unknown as ReturnType<typeof vi.fn>;
const mockedSend = sendNotification as unknown as ReturnType<typeof vi.fn>;

function baseDebtor(
  over: Partial<{
    customerId: string;
    firstName: string;
    phone: string | null;
    totalOwed: number;
    lastReminderAt: Date | null;
  }> = {},
) {
  return {
    customerId: "u1",
    firstName: "Ava",
    lastName: "Lee",
    email: "ava@example.com",
    phone: "+61499999999",
    bookingDebt: over.totalOwed ?? 250,
    infringementDebt: 0,
    invoiceDebt: 0,
    totalOwed: over.totalOwed ?? 250,
    lastReminderAt: over.lastReminderAt ?? null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedSend.mockResolvedValue({ results: [{ channel: "EMAIL", status: "SENT" }], logIds: [], notificationIds: [] });
});

describe("runDebtReminder", () => {
  it("sends a reminder to debtors with no recent reminder", async () => {
    mockedList.mockResolvedValue([baseDebtor()]);
    const sent = await runDebtReminder();
    expect(sent).toBe(1);
    expect(mockedSend).toHaveBeenCalledTimes(1);
    const call = mockedSend.mock.calls[0]?.[0];
    expect(call.type).toBe("DEBT_REMINDER");
    expect(call.channels).toEqual(["EMAIL", "SMS"]);
  });

  it("skips debtors reminded within the cooldown window", async () => {
    mockedList.mockResolvedValue([
      baseDebtor({ customerId: "fresh", lastReminderAt: null }),
      baseDebtor({ customerId: "recent", lastReminderAt: new Date(Date.now() - 86_400_000) }),
    ]);
    const sent = await runDebtReminder();
    expect(sent).toBe(1);
    expect(mockedSend).toHaveBeenCalledTimes(1);
    expect(mockedSend.mock.calls[0]?.[0].userId).toBe("fresh");
  });

  it("omits SMS when the customer has no phone", async () => {
    mockedList.mockResolvedValue([baseDebtor({ phone: null })]);
    await runDebtReminder();
    expect(mockedSend.mock.calls[0]?.[0].channels).toEqual(["EMAIL"]);
  });

  it("skips debtors below the minimum balance threshold", async () => {
    mockedList.mockResolvedValue([baseDebtor({ totalOwed: 0.5 })]);
    const sent = await runDebtReminder();
    expect(sent).toBe(0);
    expect(mockedSend).not.toHaveBeenCalled();
  });
});
