import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";

import {
  reconstructSwapNet,
  replaySwapChain,
  SWAP_REFUND_RECONCILED_MARKER,
  type SwapNetRow,
} from "@/server/services/swap-reconciliation";

const num = (d: Prisma.Decimal) => d.toNumber();

function chargeRow(
  swapId: string,
  amount: number,
  gst: number,
  status = "PENDING",
): SwapNetRow {
  return {
    swapId,
    direction: "CHARGE",
    amount,
    gst,
    payment: { reference: `SWAP-${swapId}`, status, amount, notes: null },
  };
}

function cashRefundRow(
  swapId: string,
  amount: number,
  gst: number,
  status = "SUCCEEDED",
  opts: { cash?: number; notes?: string | null } = {},
): SwapNetRow {
  return {
    swapId,
    direction: "REFUND",
    amount,
    gst,
    payment: {
      reference: `SWAP-REF-${swapId}`,
      status,
      amount: opts.cash ?? amount,
      notes: opts.notes ?? null,
    },
  };
}

describe("reconstructSwapNet", () => {
  it("returns zeroed sums for an empty chain", () => {
    const res = reconstructSwapNet([]);
    expect(num(res.chargeTotal)).toBe(0);
    expect(num(res.refundTotal)).toBe(0);
    expect(num(res.appliedRefundTotal)).toBe(0);
    expect(res.unappliedCashRefunds).toEqual([]);
    expect(res.indeterminate).toEqual([]);
  });

  it("counts PENDING and SUCCEEDED charges (totals move at commit, before capture)", () => {
    const res = reconstructSwapNet([
      chargeRow("s1", 110, 10, "PENDING"),
      chargeRow("s2", 55, 5, "SUCCEEDED"),
    ]);
    expect(num(res.chargeTotal)).toBe(165);
    expect(num(res.chargeGst)).toBe(15);
    expect(res.indeterminate).toEqual([]);
  });

  it("flags FAILED or missing charge payments as indeterminate", () => {
    const res = reconstructSwapNet([
      chargeRow("s1", 110, 10, "FAILED"),
      { swapId: "s2", direction: "CHARGE", amount: 44, gst: 4, payment: null },
    ]);
    expect(num(res.chargeTotal)).toBe(0);
    expect(res.indeterminate).toHaveLength(2);
    expect(res.indeterminate[0]).toContain("s1");
    expect(res.indeterminate[1]).toContain("row missing");
  });

  it("treats a SUCCEEDED unmarked cash refund as effective and lists it for the amountPaid heal", () => {
    const res = reconstructSwapNet([cashRefundRow("s1", 88, 8)]);
    expect(num(res.refundTotal)).toBe(88);
    expect(num(res.refundGst)).toBe(8);
    expect(num(res.appliedRefundTotal)).toBe(0);
    expect(res.unappliedCashRefunds).toEqual([
      { swapId: "s1", reference: "SWAP-REF-s1", cash: new Prisma.Decimal(88) },
    ]);
    expect(res.indeterminate).toEqual([]);
  });

  it("moves marker-stamped cash refunds into the applied sums and out of the heal list", () => {
    const res = reconstructSwapNet([
      cashRefundRow("s1", 88, 8, "SUCCEEDED", {
        notes: `Swap DOWNGRADE refund ${SWAP_REFUND_RECONCILED_MARKER}`,
      }),
    ]);
    expect(num(res.refundTotal)).toBe(88);
    expect(num(res.appliedRefundTotal)).toBe(88);
    expect(num(res.appliedRefundGst)).toBe(8);
    expect(res.unappliedCashRefunds).toEqual([]);
  });

  it("uses the Payment amount (not the swap delta) as the cash slice", () => {
    // Post-fix, part of the delta can offset debt: delta 100, cash only 40.
    const res = reconstructSwapNet([
      cashRefundRow("s1", 100, 9.09, "SUCCEEDED", { cash: 40 }),
    ]);
    expect(num(res.refundTotal)).toBe(100);
    expect(num(res.unappliedCashRefunds[0]!.cash)).toBe(40);
  });

  it("excludes FAILED cash refunds (fixed code leaves the ledger untouched)", () => {
    const res = reconstructSwapNet([cashRefundRow("s1", 88, 8, "FAILED")]);
    expect(num(res.refundTotal)).toBe(0);
    expect(res.unappliedCashRefunds).toEqual([]);
    expect(res.indeterminate).toEqual([]);
  });

  it("marks PENDING cash refunds as indeterminate", () => {
    const res = reconstructSwapNet([cashRefundRow("s1", 88, 8, "PENDING")]);
    expect(num(res.refundTotal)).toBe(0);
    expect(res.indeterminate).toHaveLength(1);
    expect(res.indeterminate[0]).toContain("SWAP-REF-s1");
  });

  it("counts a payment-less refund as a pure balance write-down", () => {
    const res = reconstructSwapNet([
      { swapId: "s1", direction: "REFUND", amount: 66, gst: 6, payment: null },
    ]);
    expect(num(res.refundTotal)).toBe(66);
    expect(num(res.refundGst)).toBe(6);
    expect(res.unappliedCashRefunds).toEqual([]);
  });

  it("counts MANUAL_CREDIT (SWAP-CREDIT) rows without a cash heal entry", () => {
    const res = reconstructSwapNet([
      {
        swapId: "s1",
        direction: "REFUND",
        amount: 120,
        gst: 10.91,
        payment: {
          reference: "SWAP-CREDIT-s1",
          status: "PENDING",
          amount: 120,
          notes: null,
        },
      },
    ]);
    expect(num(res.refundTotal)).toBe(120);
    expect(res.unappliedCashRefunds).toEqual([]);
    expect(res.indeterminate).toEqual([]);
  });

  it("ignores NONE-direction swaps entirely", () => {
    const res = reconstructSwapNet([
      { swapId: "s1", direction: "NONE", amount: 0, gst: 0, payment: null },
    ]);
    expect(num(res.chargeTotal)).toBe(0);
    expect(num(res.refundTotal)).toBe(0);
    expect(res.indeterminate).toEqual([]);
  });

  it("keeps cent-precision through Decimal arithmetic", () => {
    const res = reconstructSwapNet([
      chargeRow("s1", 0.1, 0.01, "SUCCEEDED"),
      chargeRow("s2", 0.2, 0.02, "SUCCEEDED"),
    ]);
    expect(num(res.chargeTotal)).toBe(0.3);
    expect(num(res.chargeGst)).toBe(0.03);
  });
});

describe("replaySwapChain", () => {
  const step = (
    swapId: string,
    outgoingCategoryId: string,
    incomingCategoryId: string | null,
    reason = "UPGRADE",
    direction: "NONE" | "CHARGE" | "REFUND" = "CHARGE",
  ) => ({ swapId, reason, direction, outgoingCategoryId, incomingCategoryId });

  it("returns an empty chain for no swaps", () => {
    expect(replaySwapChain([])).toEqual([]);
  });

  it("never suspects the first swap — its old category is the booking's own", () => {
    const [first] = replaySwapChain([step("s1", "catA", "catB")]);
    expect(first!.correctOldCategoryId).toBe("catA");
    expect(first!.staleOldCategoryId).toBe("catA");
    expect(first!.staleQuoteSuspect).toBe(false);
  });

  it("flags the second hop of A→B→C — pre-fix it was quoted against A instead of B", () => {
    const chain = replaySwapChain([
      step("s1", "catA", "catB"),
      step("s2", "catB", "catC"),
    ]);
    expect(chain[1]!.correctOldCategoryId).toBe("catB");
    expect(chain[1]!.staleOldCategoryId).toBe("catA");
    expect(chain[1]!.staleQuoteSuspect).toBe(true);
  });

  it("flags a swap-back (A→B→A) — pre-fix the B→A refund was quoted A→A, i.e. free", () => {
    const chain = replaySwapChain([
      step("s1", "catA", "catB"),
      step("s2", "catB", "catA", "LATERAL", "NONE"),
    ]);
    expect(chain[1]!.correctOldCategoryId).toBe("catB");
    expect(chain[1]!.staleQuoteSuspect).toBe(true);
  });

  it("does not suspect a same-category chain", () => {
    const chain = replaySwapChain([
      step("s1", "catA", "catA", "LATERAL", "NONE"),
      step("s2", "catA", "catA", "LATERAL", "NONE"),
    ]);
    expect(chain.every((s) => !s.staleQuoteSuspect)).toBe(true);
  });

  it("carries the held category across a null incoming vehicle (legacy rows)", () => {
    const chain = replaySwapChain([
      step("s1", "catA", null),
      step("s2", "catA", "catB"),
    ]);
    expect(chain[1]!.correctOldCategoryId).toBe("catA");
    expect(chain[1]!.staleQuoteSuspect).toBe(false);
  });
});
