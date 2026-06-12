import { describe, it, expect, vi, beforeEach } from "vitest";

const loggerError = vi.fn();
vi.mock("@/lib/logger", () => ({
  logger: { error: (...a: unknown[]) => loggerError(...a), info: vi.fn(), warn: vi.fn() },
}));

const captureException = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  captureException: (...a: unknown[]) => captureException(...a),
}));

import { writePaymentEvent } from "@/server/services/payment-events";

const input = {
  paymentId: "pay_1",
  eventType: "CAPTURED" as const,
  source: "webhook",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("writePaymentEvent", () => {
  it("writes the event row with defaults filled", async () => {
    const create = vi.fn().mockResolvedValue({});
    await writePaymentEvent({ paymentEvent: { create } }, input);
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        paymentId: "pay_1",
        eventType: "CAPTURED",
        source: "webhook",
        previousStatus: null,
        newStatus: null,
      }),
    });
  });

  it("rethrows write failures by default", async () => {
    const create = vi.fn().mockRejectedValue(new Error("boom"));
    await expect(writePaymentEvent({ paymentEvent: { create } }, input)).rejects.toThrow("boom");
  });

  it("swallow:true suppresses the throw but still logs and reaches Sentry", async () => {
    const create = vi.fn().mockRejectedValue(new Error("db down"));
    await expect(
      writePaymentEvent({ paymentEvent: { create } }, input, { swallow: true }),
    ).resolves.toBeUndefined();
    expect(loggerError).toHaveBeenCalledWith(
      expect.objectContaining({ paymentId: "pay_1", eventType: "CAPTURED", err: "db down" }),
      "paymentEvent write failed (swallowed)",
    );
    expect(captureException).toHaveBeenCalledTimes(1);
  });
});
