import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  attachByTrackingCode,
  markPartnerTransactionsPayable,
} from "../../../src/server/services/partner";

describe("partner service", () => {
  function makePrisma(options: {
    partner?: {
      id: string;
      isActive: boolean;
      commissionPct: number;
      trackingCode: string;
    } | null;
    booking?: { id: string; totalAmount: number; status: string };
  }) {
    const tx = {
      booking: { update: vi.fn().mockResolvedValue({}) },
      partnerTransaction: { upsert: vi.fn().mockResolvedValue({}) },
    };
    return {
      partner: { findUnique: vi.fn().mockResolvedValue(options.partner ?? null) },
      booking: {
        findUniqueOrThrow: vi.fn().mockResolvedValue(
          options.booking ?? { id: "b1", totalAmount: 500, status: "CONFIRMED" },
        ),
      },
      $transaction: vi
        .fn()
        .mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx)),
      partnerTransaction: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        upsert: tx.partnerTransaction.upsert,
      },
      __tx: tx,
    } as never;
  }

  beforeEach(() => vi.clearAllMocks());

  describe("attachByTrackingCode", () => {
    it("no-ops when tracking code doesn't match an active partner", async () => {
      const prisma = makePrisma({ partner: null });
      const res = await attachByTrackingCode(prisma, {
        bookingId: "b1",
        trackingCode: "UNKNOWN",
      });
      expect(res.attached).toBe(false);
    });

    it("no-ops when partner is inactive", async () => {
      const prisma = makePrisma({
        partner: {
          id: "p1",
          isActive: false,
          commissionPct: 10,
          trackingCode: "HOTEL-A",
        },
      });
      const res = await attachByTrackingCode(prisma, {
        bookingId: "b1",
        trackingCode: "HOTEL-A",
      });
      expect(res.attached).toBe(false);
    });

    it("attaches and records commission snapshot", async () => {
      const prisma = makePrisma({
        partner: {
          id: "p1",
          isActive: true,
          commissionPct: 12,
          trackingCode: "HOTEL-A",
        },
        booking: { id: "b1", totalAmount: 400, status: "CONFIRMED" },
      });
      const res = await attachByTrackingCode(prisma, {
        bookingId: "b1",
        trackingCode: "hotel-a", // case-insensitive
      });
      expect(res.attached).toBe(true);
      expect(res.commissionAmount).toBe(48); // 12% of 400
      const tx = (prisma as unknown as { __tx: { booking: { update: ReturnType<typeof vi.fn> } } })
        .__tx;
      expect(tx.booking.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ partnerId: "p1", partnerCode: "HOTEL-A" }),
        }),
      );
    });

    it("seeds PartnerTransaction as PAYABLE when booking is already COMPLETED", async () => {
      const prisma = makePrisma({
        partner: {
          id: "p1",
          isActive: true,
          commissionPct: 10,
          trackingCode: "HOTEL-A",
        },
        booking: { id: "b1", totalAmount: 200, status: "COMPLETED" },
      });
      await attachByTrackingCode(prisma, {
        bookingId: "b1",
        trackingCode: "HOTEL-A",
      });
      const tx = (prisma as unknown as { __tx: { partnerTransaction: { upsert: ReturnType<typeof vi.fn> } } })
        .__tx;
      expect(tx.partnerTransaction.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ status: "PAYABLE" }),
        }),
      );
    });
  });

  describe("markPartnerTransactionsPayable", () => {
    it("flips PENDING rows to PAYABLE and returns count", async () => {
      const prisma = makePrisma({});
      const count = await markPartnerTransactionsPayable(prisma, "b1");
      expect(count).toBe(1);
    });
  });
});
