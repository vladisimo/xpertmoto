import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/branding", () => ({
  getBranding: vi.fn(async () => ({
    siteName: "XPERT Moto",
    legalName: "Mercury Road Equipment Pty Ltd",
    abn: "36 614 422 187",
    brandColor: "#0F172A",
    supportEmail: "support@example.com",
    supportPhone: "+61 7 0000 0000",
    privacyEmail: "privacy@example.com",
    postalAddress: "PO Box 1, Surfers Paradise QLD 4217",
    logoWideUrl: null,
    logoSquareUrl: null,
    faviconUrl: null,
  })),
}));

vi.mock("@/lib/invoicing-config", () => ({
  getInvoicingConfig: vi.fn(async () => ({
    invoiceFooter: "Thank you for hiring with us.",
    remittanceDetails: "BSB 000-000 · Account 12345678",
  })),
}));

vi.mock("@/lib/pdf/logo-resolver", () => ({
  resolvePdfLogoSrc: vi.fn(() => null),
}));

import { renderRentalAgreementPdf } from "@/lib/agreement/pdf/rental-agreement-pdf";
import { renderReturnAssessmentPdf } from "@/lib/agreement/pdf/return-assessment-pdf";
import { renderConsentDocumentPdf } from "@/lib/pdf/consent-document";
import { renderSwapAgreementPdf } from "@/lib/pdf/swap-agreement";

const PDF_MAGIC = "%PDF";

const baseDate = new Date("2026-04-26T10:00:00.000Z");

function expectValidPdf(buf: Buffer) {
  expect(buf).toBeInstanceOf(Buffer);
  expect(buf.length).toBeGreaterThan(500);
  expect(buf.subarray(0, 4).toString("utf8")).toBe(PDF_MAGIC);
}

describe("PDF renderers — smoke", () => {
  it("renders the Swap Agreement", async () => {
    const buf = await renderSwapAgreementPdf({
      swapId: "swap_1",
      swappedAt: baseDate,
      reason: "MECHANICAL_FAULT",
      origin: "STAFF_REPORT",
      reasonNotes: "Front brake feels soft.",
      originDetails: null,
      priceAdjustment: { direction: "NONE", amount: 0, gst: 0 },
      bondVariance: null,
      booking: {
        bookingReference: "SCT-20260426-0001",
        pickupDateTime: new Date("2026-04-25T08:00:00.000Z"),
        returnDateTime: new Date("2026-04-30T17:00:00.000Z"),
        customer: { firstName: "Ada", lastName: "Lovelace", email: "ada@example.com" },
      },
      outgoing: {
        internalCode: "SCT-001",
        rego: "123-AB4",
        make: "Honda",
        model: "PCX150",
        categoryName: "150cc Scooter",
        odometerKm: 8420,
        fuelLevel: 65,
        overallCondition: "GOOD",
        notes: null,
      },
      incoming: {
        internalCode: "SCT-002",
        rego: "234-CD5",
        make: "Yamaha",
        model: "NMAX155",
        categoryName: "150cc Scooter",
        odometerKm: 1200,
        fuelLevel: 100,
        overallCondition: "EXCELLENT",
        notes: "Just serviced.",
      },
      workOrderNumber: "WO-000123",
      incidentNumber: null,
      customerSignatureUrl: null,
      staffSignatureUrl: null,
      staffName: "Jane Staff",
    });
    expectValidPdf(buf);
  });

  it("renders the Consent Document", async () => {
    const buf = await renderConsentDocumentPdf({
      title: "Privacy Policy",
      version: "v3.1",
      body: "We respect your privacy.\n\nThis is paragraph two.\n\nThis is paragraph three.",
      customerFullName: "Ada Lovelace",
      // 1×1 transparent PNG data URL — valid signature stub.
      signatureUrl:
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
      signedAt: baseDate,
    });
    expectValidPdf(buf);
  });

  it("renders the Return Assessment", async () => {
    const buf = await renderReturnAssessmentPdf({
      assessmentNumber: "RA-000042",
      version: 1,
      signedAt: baseDate,
      booking: {
        bookingReference: "SCT-20260426-0002",
        pickupDateTime: new Date("2026-04-20T09:00:00.000Z"),
        returnDateTime: new Date("2026-04-26T09:00:00.000Z"),
        actualReturnDateTime: baseDate,
        pickupOdometerKm: 5000,
        bondAmount: 500,
      },
      customer: { firstName: "Grace", lastName: "Hopper", email: "grace@example.com" },
      vehicle: { internalCode: "SCT-003", rego: "ABC-12-DE", make: "Vespa", model: "Primavera" },
      category: { name: "125cc Scooter" },
      returnDepot: { name: "XPERT Moto Gold Coast" },
      staffName: "Sam Staff",
      odometerKm: 5380,
      fuelLevel: 45,
      photos: [
        {
          url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
          caption: "Left side",
          side: "LEFT",
          issues: [{ n: 1, label: "Scratch on left fairing", severity: "MODERATE", note: null, posX: 0.5, posY: 0.4 }],
        },
      ],
      charges: [
        {
          description: "Scratch on left fairing",
          severity: "MODERATE",
          resolution: "STANDARD",
          amount: 180,
          photoUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        },
      ],
      fees: { lateFee: 0, fuelCharge: 12.5 },
      totalDueNow: 192.5,
      pendingQuoteCap: 0,
      bond: { heldAmount: 500, appliedAmount: 192.5, releasedAmount: 307.5 },
      signatures: {
        customerFullUrl: null,
        staffFullUrl: null,
        initialsUrl: null,
      },
      abn: "36 614 422 187",
      siteName: "XPERT Moto",
      legalName: "Mercury Road Equipment Pty Ltd",
      supportEmail: "support@example.com",
    });
    expectValidPdf(buf);
  });

  it("renders the Rental Agreement", async () => {
    const buf = await renderRentalAgreementPdf({
      agreementNumber: "RA-000099",
      version: 1,
      termsVersion: "2026-01",
      signedAt: baseDate,
      booking: {
        bookingReference: "SCT-20260426-0003",
        pickupDateTime: new Date("2026-04-26T09:00:00.000Z"),
        returnDateTime: new Date("2026-04-30T09:00:00.000Z"),
        durationDays: 4,
        subtotal: 276,
        addonTotal: 20,
        insuranceTotal: 48,
        discountAmount: 10,
        gstAmount: 30.36,
        totalAmount: 334,
        bondAmount: 500,
      },
      customer: {
        firstName: "Linus",
        lastName: "Torvalds",
        email: "linus@example.com",
        phone: "+61 400 000 000",
      },
      vehicle: {
        internalCode: "SCT-004",
        rego: "ZX1-23-W",
        make: "Honda",
        model: "PCX125",
        year: 2024,
        colour: "Pearl White",
      },
      category: { name: "125cc Scooter" },
      pickupDepot: {
        name: "XPERT Moto Gold Coast",
        addressLine1: "1 Esplanade",
        suburb: "Surfers Paradise",
        state: "QLD",
        postcode: "4217",
      },
      returnDepot: { name: "XPERT Moto Gold Coast" },
      staffName: "Sam Staff",
      addons: [{ name: "Helmet", quantity: 1, totalPrice: 20 }],
      insurance: { name: "Standard", excessAmount: 1500, totalPrice: 48 },
      photos: [
        {
          url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
          caption: "Front",
          side: "FRONT",
          issues: [{ n: 1, label: "Chip on fairing", severity: "MINOR", note: null, posX: 0.3, posY: 0.6 }],
        },
      ],
      terms: {
        version: "2026-01",
        sections: [{ heading: "1. Hire", paragraphs: ["The hirer agrees..."] }],
      },
      cancellationPolicy: ["Cancellation > 72hrs: full refund minus admin fee."],
      bondPolicy: ["The bond is fully refundable."],
      declarations: ["I hold a current valid licence."],
      signatures: { customerFullUrl: null, staffFullUrl: null, initialsUrl: null },
      abn: "36 614 422 187",
    });
    expectValidPdf(buf);
  });
});
