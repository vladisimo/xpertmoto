import { describe, expect, test, vi } from "vitest";
import {
  captureBookingId,
  readCapturedBookingId,
  writeBookingAuditAsync,
} from "@/server/services/audit";
import type { PrismaClient } from "@prisma/client";

function makePrisma() {
  const create = vi.fn().mockResolvedValue({});
  const prisma = { auditLog: { create } } as unknown as PrismaClient;
  return { prisma, create };
}

// writeBookingAuditAsync queues the write on the microtask queue; flush it.
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("captureBookingId / readCapturedBookingId", () => {
  test("round-trips a booking id through ctx", () => {
    const ctx = {};
    captureBookingId(ctx, "bk-1");
    expect(readCapturedBookingId({}, ctx)).toBe("bk-1");
  });

  test("is a no-op for null/undefined and leaves ctx unset", () => {
    const ctx = {};
    captureBookingId(ctx, null);
    captureBookingId(ctx, undefined);
    expect(readCapturedBookingId({}, ctx)).toBeUndefined();
  });
});

describe("writeBookingAuditAsync", () => {
  test("writes an entity='Booking' row tagged with the booking id", async () => {
    const { prisma, create } = makePrisma();
    writeBookingAuditAsync(prisma, "bk-1", {
      userId: "u-1",
      action: "BOOKING_CREATED",
      reqId: "req-1",
      newData: { foo: "bar" },
    });
    await flush();
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]![0].data).toMatchObject({
      entity: "Booking",
      entityId: "bk-1",
      action: "BOOKING_CREATED",
      userId: "u-1",
      reqId: "req-1",
    });
  });

  test("is a no-op when bookingId is null/undefined", async () => {
    const { prisma, create } = makePrisma();
    writeBookingAuditAsync(prisma, null, { action: "X" });
    writeBookingAuditAsync(prisma, undefined, { action: "Y" });
    await flush();
    expect(create).not.toHaveBeenCalled();
  });
});
