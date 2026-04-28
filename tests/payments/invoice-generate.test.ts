import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * G17 — invoice-generate weekly retroactive sweep.
 *
 * The old aggregator (one Invoice per customer per week, bundling
 * cross-booking ancillary Payments) was retired when per-booking
 * invoice + adjustment-note lifecycle moved into the application
 * code. The sweep now backfills:
 *
 *   1. Invoices for confirmed/active/completed bookings that don't
 *      yet have one (rare — typically a render failure during
 *      booking.confirm).
 *   2. Adjustment notes for SUCCEEDED ancillary Payments without an
 *      `AdjustmentNote.paymentId` link.
 *   3. Branded payment receipts for SUCCEEDED Payments without a
 *      `receiptNumber`.
 *
 * Under steady-state operation the application code beats the sweep
 * to every issuance, so each pass should generate zero rows.
 */

const bookingFindMany = vi.fn();
const paymentFindMany = vi.fn();
const invoiceFindFirst = vi.fn();
const issueInvoiceForBooking = vi.fn();
const issueAdjustmentNote = vi.fn();
const issueReceiptForPayment = vi.fn();
const writePaymentAudit = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    booking: { findMany: bookingFindMany },
    payment: { findMany: paymentFindMany },
    invoice: { findFirst: invoiceFindFirst },
  },
}));

vi.mock("@/server/jobs/queue", () => ({
  getQueue: vi.fn().mockReturnValue(null),
  registerWorker: vi.fn(),
}));

vi.mock("@/server/services/audit-payment", () => ({
  writePaymentAudit: (...args: unknown[]) => writePaymentAudit(...args),
}));

vi.mock("@/server/services/invoice-lifecycle", () => ({
  issueInvoiceForBooking: (...args: unknown[]) => issueInvoiceForBooking(...args),
  issueAdjustmentNote: (...args: unknown[]) => issueAdjustmentNote(...args),
  issueReceiptForPayment: (...args: unknown[]) => issueReceiptForPayment(...args),
}));

beforeEach(() => {
  bookingFindMany.mockReset().mockResolvedValue([]);
  paymentFindMany.mockReset().mockResolvedValue([]);
  invoiceFindFirst.mockReset().mockResolvedValue(null);
  issueInvoiceForBooking.mockReset().mockResolvedValue({ id: "inv_1", invoiceNumber: "INV-2026-000001" });
  issueAdjustmentNote.mockReset().mockResolvedValue({ id: "adj_1" });
  issueReceiptForPayment.mockReset().mockResolvedValue({ id: "p_1" });
  writePaymentAudit.mockClear();
});

describe("invoice-generate sweep", () => {
  it("zero candidates → zero issuances", async () => {
    const { runInvoiceGenerate } = await import("@/server/jobs/invoice-generate");
    const r = await runInvoiceGenerate();
    expect(r).toEqual({ invoicesIssued: 0, adjustmentsIssued: 0, receiptsIssued: 0 });
    expect(issueInvoiceForBooking).not.toHaveBeenCalled();
    expect(issueAdjustmentNote).not.toHaveBeenCalled();
    expect(issueReceiptForPayment).not.toHaveBeenCalled();
  });

  it("backfills missing invoices for confirmed bookings", async () => {
    bookingFindMany.mockResolvedValue([
      { id: "b1", bookingReference: "SCT-1" },
      { id: "b2", bookingReference: "SCT-2" },
    ]);
    const { runInvoiceGenerate } = await import("@/server/jobs/invoice-generate");
    const r = await runInvoiceGenerate();
    expect(r.invoicesIssued).toBe(2);
    expect(issueInvoiceForBooking).toHaveBeenCalledWith({ bookingId: "b1" });
    expect(issueInvoiceForBooking).toHaveBeenCalledWith({ bookingId: "b2" });
  });

  it("backfills adjustment notes for orphan ancillary payments when an invoice exists", async () => {
    paymentFindMany
      .mockResolvedValueOnce([
        {
          id: "p_late",
          type: "LATE_FEE",
          amount: 25,
          gstAmount: 2.27,
          reference: "LATE-1",
          bookingId: "b1",
          notes: null,
          processedAt: new Date(),
        },
      ])
      .mockResolvedValueOnce([]); // receipt sweep finds nothing

    invoiceFindFirst.mockResolvedValue({ id: "inv_1" });

    const { runInvoiceGenerate } = await import("@/server/jobs/invoice-generate");
    const r = await runInvoiceGenerate();
    expect(r.adjustmentsIssued).toBe(1);
    expect(issueAdjustmentNote).toHaveBeenCalledWith(
      expect.objectContaining({
        invoiceId: "inv_1",
        type: "INCREASE",
        reason: "LATE_FEE",
        paymentId: "p_late",
      }),
    );
  });

  it("treats REFUND payments as DECREASE adjustments", async () => {
    paymentFindMany
      .mockResolvedValueOnce([
        {
          id: "p_ref",
          type: "REFUND",
          amount: 50,
          gstAmount: 4.55,
          reference: "REF-1",
          bookingId: "b1",
          notes: "Cancellation refund",
          processedAt: new Date(),
        },
      ])
      .mockResolvedValueOnce([]);
    invoiceFindFirst.mockResolvedValue({ id: "inv_1" });

    const { runInvoiceGenerate } = await import("@/server/jobs/invoice-generate");
    const r = await runInvoiceGenerate();
    expect(r.adjustmentsIssued).toBe(1);
    expect(issueAdjustmentNote).toHaveBeenCalledWith(
      expect.objectContaining({ type: "DECREASE", reason: "REFUND" }),
    );
  });

  it("skips orphan payments whose booking has no invoice yet", async () => {
    paymentFindMany
      .mockResolvedValueOnce([
        {
          id: "p_late",
          type: "LATE_FEE",
          amount: 25,
          gstAmount: 2.27,
          reference: "LATE-1",
          bookingId: "b1",
          notes: null,
          processedAt: new Date(),
        },
      ])
      .mockResolvedValueOnce([]);
    invoiceFindFirst.mockResolvedValue(null); // no invoice yet

    const { runInvoiceGenerate } = await import("@/server/jobs/invoice-generate");
    const r = await runInvoiceGenerate();
    expect(r.adjustmentsIssued).toBe(0);
    expect(issueAdjustmentNote).not.toHaveBeenCalled();
  });

  it("backfills receipt PDFs for SUCCEEDED payments missing a receipt number", async () => {
    paymentFindMany
      .mockResolvedValueOnce([]) // ancillary sweep
      .mockResolvedValueOnce([{ id: "p_a" }, { id: "p_b" }]); // receipt sweep

    const { runInvoiceGenerate } = await import("@/server/jobs/invoice-generate");
    const r = await runInvoiceGenerate();
    expect(r.receiptsIssued).toBe(2);
    expect(issueReceiptForPayment).toHaveBeenCalledWith({ paymentId: "p_a" });
    expect(issueReceiptForPayment).toHaveBeenCalledWith({ paymentId: "p_b" });
  });
});
