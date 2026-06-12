import { describe, it, expect, vi, beforeEach } from "vitest";

const getQueueMock = vi.fn();
const registerWorkerMock = vi.fn();
vi.mock("@/server/jobs/queue", () => ({
  getQueue: (...a: unknown[]) => getQueueMock(...a),
  registerWorker: (...a: unknown[]) => registerWorkerMock(...a),
}));
const sendMock = vi.fn();
vi.mock("@/server/services/booking-confirmation", () => ({
  sendBookingConfirmationNotification: (...a: unknown[]) => sendMock(...a),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import {
  enqueueBookingConfirmationNotify,
  startBookingConfirmationNotifyWorker,
} from "@/server/jobs/booking-confirmation-notify";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("enqueueBookingConfirmationNotify", () => {
  it("queues the send when Redis is available — nothing runs inline", async () => {
    const add = vi.fn();
    getQueueMock.mockReturnValue({ add });

    const res = await enqueueBookingConfirmationNotify("b1");

    expect(res).toBe("queued");
    expect(add).toHaveBeenCalledWith("notify", { bookingId: "b1" });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("falls back to an inline send without Redis", async () => {
    getQueueMock.mockReturnValue(null);

    const res = await enqueueBookingConfirmationNotify("b1");

    expect(res).toBe("synced");
    expect(sendMock).toHaveBeenCalledWith({}, "b1");
  });

  it("swallows inline failures — a lost email must never fail checkout", async () => {
    getQueueMock.mockReturnValue(null);
    sendMock.mockRejectedValueOnce(new Error("resend down"));

    await expect(enqueueBookingConfirmationNotify("b1")).resolves.toBe("skipped");
  });
});

describe("startBookingConfirmationNotifyWorker", () => {
  it("registers a processor that runs the send for the job's booking", async () => {
    startBookingConfirmationNotifyWorker();

    expect(registerWorkerMock).toHaveBeenCalledWith(
      "booking-confirmation-notify",
      expect.any(Function),
    );
    const processor = registerWorkerMock.mock.calls[0]![1] as (job: {
      data: { bookingId: string };
    }) => Promise<void>;
    await processor({ data: { bookingId: "b9" } });
    expect(sendMock).toHaveBeenCalledWith({}, "b9");
  });
});
