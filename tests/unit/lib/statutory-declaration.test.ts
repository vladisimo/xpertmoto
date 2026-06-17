import { describe, expect, it, vi } from "vitest";

// Branding reads a SystemSetting row in prod; stub it so the renderer is pure.
vi.mock("@/lib/branding", () => ({
  getBranding: async () => ({
    siteName: "XPERT Moto",
    tagline: "",
    legalName: "XPERT Moto Group Pty Ltd",
    abn: "72 629 456 408",
    brandColor: "#1B6B4A",
    supportEmail: "help@example.com",
    supportPhone: null,
    privacyEmail: null,
    postalAddress: null,
    logoWideUrl: null,
    logoBlackUrl: null,
    logoSquareUrl: null,
    faviconUrl: null,
    social: { facebook: null, instagram: null, tiktok: null, youtube: null },
  }),
}));

import { renderStatutoryDeclarationPdf } from "@/lib/pdf/statutory-declaration";
import type { NominationArtefactInput } from "@/server/services/nomination-artefacts";

const input: NominationArtefactInput = {
  penaltyNoticeNumber: "PN-XYZ",
  offenceDate: new Date(Date.UTC(2026, 3, 5, 8, 14)),
  offenceCode: "1234",
  offenceDescription: "Exceed speed limit",
  offenceLocation: "M2",
  issuer: "Revenue NSW",
  vehicleRego: "ABC123",
  nominee: {
    givenNames: "Jane",
    familyName: "Doe",
    dob: new Date(Date.UTC(1990, 0, 15)),
    addressLine1: "6 Tweedmouth Ave",
    addressLine2: null,
    suburb: "Rosebery",
    state: "NSW",
    postcode: "2018",
    licenceNumber: "12345678",
    licenceState: "NSW",
    licenceCountry: null,
  },
};

describe("renderStatutoryDeclarationPdf", () => {
  it("renders a non-empty PDF buffer", async () => {
    const buf = await renderStatutoryDeclarationPdf(input);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(1000);
    // PDF magic bytes "%PDF".
    expect(buf.subarray(0, 4).toString("latin1")).toBe("%PDF");
  });
});
