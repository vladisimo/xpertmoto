import { describe, expect, test, vi } from "vitest";
import { supersedePriorDraft } from "@/server/services/booking-draft";

type DraftRow = {
  id: string;
  status: string;
  customerId: string;
  payments: { id: string }[];
};

/** Minimal prisma stub exposing only `booking.findUnique` + `booking.update`. */
function makePrisma(draft: DraftRow | null) {
  const update = vi.fn().mockResolvedValue({});
  const findUnique = vi.fn().mockResolvedValue(draft);
  return {
    prisma: { booking: { findUnique, update } } as never,
    findUnique,
    update,
  };
}

const OWNER = "cust_1";

describe("supersedePriorDraft", () => {
  test("cancels an unpaid PENDING_PAYMENT draft owned by the customer", async () => {
    const { prisma, update } = makePrisma({
      id: "bk_old",
      status: "PENDING_PAYMENT",
      customerId: OWNER,
      payments: [],
    });

    const result = await supersedePriorDraft(prisma, {
      draftBookingId: "bk_old",
      customerId: OWNER,
    });

    expect(result).toBe(true);
    expect(update).toHaveBeenCalledTimes(1);
    const arg = update.mock.calls[0]![0];
    expect(arg.where).toEqual({ id: "bk_old" });
    expect(arg.data.status).toBe("CANCELLED");
    expect(arg.data.statusLog.create.previousStatus).toBe("PENDING_PAYMENT");
  });

  test("never cancels a draft with a SUCCEEDED booking payment (C1 guard)", async () => {
    const { prisma, update } = makePrisma({
      id: "bk_paid",
      status: "PENDING_PAYMENT",
      customerId: OWNER,
      payments: [{ id: "pay_1" }],
    });

    const result = await supersedePriorDraft(prisma, {
      draftBookingId: "bk_paid",
      customerId: OWNER,
    });

    expect(result).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  test("ignores a draft owned by another customer", async () => {
    const { prisma, update } = makePrisma({
      id: "bk_other",
      status: "PENDING_PAYMENT",
      customerId: "someone_else",
      payments: [],
    });

    const result = await supersedePriorDraft(prisma, {
      draftBookingId: "bk_other",
      customerId: OWNER,
    });

    expect(result).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  test("ignores a non-PENDING_PAYMENT booking", async () => {
    const { prisma, update } = makePrisma({
      id: "bk_confirmed",
      status: "CONFIRMED",
      customerId: OWNER,
      payments: [],
    });

    const result = await supersedePriorDraft(prisma, {
      draftBookingId: "bk_confirmed",
      customerId: OWNER,
    });

    expect(result).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  test("returns false when the draft does not exist", async () => {
    const { prisma, update } = makePrisma(null);

    const result = await supersedePriorDraft(prisma, {
      draftBookingId: "missing",
      customerId: OWNER,
    });

    expect(result).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });
});
