import { describe, expect, it } from "vitest";
import {
  netCashByBooking,
  reconcileInvoice,
} from "../../../../src/lib/finance/invoice-reconciliation";

describe("netCashByBooking", () => {
  it("weights refunds out and excludes bond authorisations", () => {
    const net = netCashByBooking([
      { bookingId: "bk1", type: "BOOKING_PAYMENT", amount: 172.5 },
      { bookingId: "bk1", type: "REFUND", amount: 147.5 },
      { bookingId: "bk1", type: "BOND_HOLD", amount: 300 },
      { bookingId: "bk1", type: "BOND_RELEASE", amount: 300 },
    ]);
    expect(net.get("bk1")).toBeCloseTo(25, 2);
  });

  it("ignores groups with a null bookingId", () => {
    const net = netCashByBooking([
      { bookingId: null, type: "BOOKING_PAYMENT", amount: 50 },
    ]);
    expect(net.size).toBe(0);
  });

  it("sums multiple bookings independently", () => {
    const net = netCashByBooking([
      { bookingId: "a", type: "BOOKING_PAYMENT", amount: 100 },
      { bookingId: "b", type: "BOOKING_PAYMENT", amount: 200 },
      { bookingId: "a", type: "DAMAGE_CHARGE", amount: 40 },
    ]);
    expect(net.get("a")).toBeCloseTo(140, 2);
    expect(net.get("b")).toBeCloseTo(200, 2);
  });
});

describe("reconcileInvoice", () => {
  it("uses balanceDue for outstanding on a cancelled (terminal) booking", () => {
    // The INV-2026-000016 scenario: $345 invoice, deposit model, cancelled
    // with a partial refund. net − collected would over-report $172.50, but
    // the booking is settled (balanceDue 0) so outstanding must be $0.
    const net = netCashByBooking([
      { bookingId: "bk1", type: "BOOKING_PAYMENT", amount: 172.5 },
      { bookingId: "bk1", type: "REFUND", amount: 147.5 },
    ]);
    const recon = reconcileInvoice(
      {
        bookingId: "bk1",
        bookingStatus: "CANCELLED",
        balanceDue: 0,
        totalAmount: 345,
        adjustments: [{ type: "DECREASE", totalAmount: 147.5 }],
      },
      net,
    );
    expect(recon.adjustmentTotal).toBeCloseTo(-147.5, 2);
    expect(recon.netTotal).toBeCloseTo(197.5, 2);
    expect(recon.collected).toBeCloseTo(25, 2);
    // Terminal → driven by balanceDue, not net − collected.
    expect(recon.outstanding).toBe(0);
  });

  it("uses net − collected for a live (non-terminal) booking", () => {
    // Confirmed deposit booking: $172.50 paid up front, pickup balance owing.
    const recon = reconcileInvoice(
      {
        bookingId: "bk1",
        bookingStatus: "CONFIRMED",
        balanceDue: 0,
        totalAmount: 345,
        adjustments: [],
      },
      new Map([["bk1", 172.5]]),
    );
    expect(recon.netTotal).toBeCloseTo(345, 2);
    expect(recon.collected).toBeCloseTo(172.5, 2);
    expect(recon.outstanding).toBeCloseTo(172.5, 2);
  });

  it("reports terminal balanceDue when an ancillary charge is still owed", () => {
    // Completed booking with an uncaptured damage charge.
    const recon = reconcileInvoice(
      {
        bookingId: "bk1",
        bookingStatus: "COMPLETED",
        balanceDue: 80,
        totalAmount: 345,
        adjustments: [{ type: "INCREASE", totalAmount: 80 }],
      },
      new Map([["bk1", 345]]),
    );
    expect(recon.netTotal).toBeCloseTo(425, 2);
    expect(recon.collected).toBeCloseTo(345, 2);
    expect(recon.outstanding).toBeCloseTo(80, 2);
  });

  it("treats a standalone (no booking) invoice with net − collected", () => {
    const recon = reconcileInvoice(
      { bookingId: null, bookingStatus: null, balanceDue: null, totalAmount: 100, adjustments: [] },
      new Map([["bk1", 999]]),
    );
    expect(recon.collected).toBe(0);
    expect(recon.outstanding).toBeCloseTo(100, 2);
  });

  it("returns negative outstanding when a live booking is over-collected", () => {
    const recon = reconcileInvoice(
      { bookingId: "bk1", bookingStatus: "ACTIVE", balanceDue: 0, totalAmount: 100, adjustments: [] },
      new Map([["bk1", 120]]),
    );
    expect(recon.outstanding).toBeCloseTo(-20, 2);
  });
});
