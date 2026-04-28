import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * G12 — dispute evidence packet.
 *
 *   - Pulls rental agreement + return assessment PDFs
 *   - Redacts PAN (none expected — assert no PAN-like strings leak)
 *   - Narrative includes booking reference, customer email, vehicle identifiers
 *   - Handles missing relations gracefully (no crash)
 */

const paymentFindUniqueOrThrow = vi.fn();
const commFindMany = vi.fn().mockResolvedValue([]);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    payment: { findUniqueOrThrow: paymentFindUniqueOrThrow },
    communicationLog: { findMany: commFindMany },
  },
}));

beforeEach(() => {
  paymentFindUniqueOrThrow.mockReset();
  commFindMany.mockReset();
  commFindMany.mockResolvedValue([]);
});

describe("compileEvidencePacket", () => {
  it("builds a packet with signature URL, docs, and narrative", async () => {
    paymentFindUniqueOrThrow.mockResolvedValue({
      id: "pay_disp_1",
      customerId: "cust_1",
      bookingId: "book_1",
      reference: "BOOK-disp",
      amount: "49.00",
      receiptUrl: "https://stripe.test/receipt/1",
      booking: {
        bookingReference: "SCT-20260418-0001",
        pickupDateTime: new Date("2026-04-18T10:00:00Z"),
        returnDateTime: new Date("2026-04-20T10:00:00Z"),
        customer: { id: "cust_1", firstName: "Alex", lastName: "Smith", email: "alex@example.com" },
        vehicle: { internalCode: "SCT-001", rego: "ABC-123", make: "Vespa", model: "LX150" },
        inspections: [
          { id: "insp_1", type: "PRE_HIRE", dateTime: new Date("2026-04-18T10:00:00Z"), odometerKm: 5000 },
          { id: "insp_2", type: "POST_HIRE", dateTime: new Date("2026-04-20T10:00:00Z"), odometerKm: 5250 },
        ],
        returnAssessments: [
          { id: "ra_1", status: "SIGNED", pdfUrl: "https://s3/return.pdf", assessmentNumber: "RTN-1", signedAt: new Date() },
        ],
        rentalAgreements: [{ pdfUrl: "https://s3/agreement.pdf", signedAt: new Date("2026-04-18T10:00:00Z") }],
      },
    });
    commFindMany.mockResolvedValue([
      { sentAt: new Date("2026-04-18T09:00:00Z"), channel: "EMAIL", subject: "Booking confirmation", templateUsed: "BOOKING_CONFIRMATION" },
    ]);

    const { compileEvidencePacket } = await import("@/server/services/dispute-response");
    const packet = await compileEvidencePacket({
      paymentId: "pay_disp_1",
      disputeId: "dp_abc",
      reason: "fraudulent",
      amountCents: 4900,
    });

    expect(packet.disputeId).toBe("dp_abc");
    expect(packet.bookingReference).toBe("SCT-20260418-0001");
    expect(packet.evidence.customer_signature).toBe("https://s3/agreement.pdf");
    expect(packet.evidence.service_documentation).toEqual(
      expect.arrayContaining(["https://s3/agreement.pdf", "https://s3/return.pdf"]),
    );
    expect(packet.evidence.uncategorized_text).toContain("SCT-20260418-0001");
    expect(packet.evidence.uncategorized_text).toContain("Vespa");
    expect(packet.evidence.customer_communication_summary).toHaveLength(1);
  });

  it("handles payments with no booking gracefully", async () => {
    paymentFindUniqueOrThrow.mockResolvedValue({
      id: "pay_orphan",
      customerId: null,
      bookingId: null,
      reference: "ORPHAN-1",
      amount: "99.00",
      receiptUrl: null,
      booking: null,
    });

    const { compileEvidencePacket } = await import("@/server/services/dispute-response");
    const packet = await compileEvidencePacket({
      paymentId: "pay_orphan",
      disputeId: "dp_orphan",
      amountCents: 9900,
    });
    expect(packet.bookingReference).toBeNull();
    expect(packet.evidence.service_documentation).toEqual([]);
    expect(packet.evidence.uncategorized_text).toContain("no booking record");
  });

  it("never leaks PAN-like strings (defensive check)", async () => {
    paymentFindUniqueOrThrow.mockResolvedValue({
      id: "pay_pan_test",
      customerId: "cust_pan",
      bookingId: "book_pan",
      reference: "BOOK-pan",
      amount: "49.00",
      receiptUrl: null,
      booking: {
        bookingReference: "SCT-PAN-001",
        pickupDateTime: new Date(),
        returnDateTime: new Date(),
        customer: { id: "cust_pan", firstName: "Pan", lastName: "Test", email: "p@t.co" },
        vehicle: { internalCode: "X", rego: "X-1", make: "Y", model: "Z" },
        inspections: [],
        returnAssessments: [],
        rentalAgreements: [],
      },
    });
    const { compileEvidencePacket } = await import("@/server/services/dispute-response");
    const packet = await compileEvidencePacket({
      paymentId: "pay_pan_test",
      disputeId: "dp_pan",
      amountCents: 4900,
    });
    const serialised = JSON.stringify(packet);
    expect(serialised).not.toMatch(/\b4242424242424242\b/);
    expect(serialised).not.toMatch(/\b\d{13,19}\b/); // any 13-19 digit run
  });
});
