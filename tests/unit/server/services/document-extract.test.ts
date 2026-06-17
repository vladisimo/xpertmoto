import { afterEach, describe, expect, test, vi } from "vitest";

import {
  _internal,
  extractLicenceData,
  extractPassportData,
} from "@/server/services/document-extract";

/**
 * These tests stub `_internal.runVisionTool` so no provider/network call is
 * made — the public extract functions call it via the `_internal` indirection
 * specifically so tests can replace the outbound call. We assert the
 * classification + wrong-type handling layered on top of the raw model output:
 *
 *   - the detected `documentType` is threaded onto every post-parse result;
 *   - a wrong-type image never pre-fills cross-type fields;
 *   - readability/low-confidence/hard-failure behaviour is unchanged.
 */

const IMG = Buffer.from("fake-image-bytes");

function mockVision(data: Record<string, unknown> | null) {
  vi.spyOn(_internal, "runVisionTool").mockResolvedValue({ data, usage: null });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("extractLicenceData — classification", () => {
  test("a driver's licence extracts fields + documentType", async () => {
    mockVision({
      documentType: "DRIVERS_LICENCE",
      licenceNumber: "12345678",
      state: "nsw",
      licenceClass: "C",
      dateOfBirth: "1990-05-15",
      expiryDate: "2030-01-01",
      confidence: 0.95,
    });

    const r = await extractLicenceData(IMG);
    expect(r.documentType).toBe("DRIVERS_LICENCE");
    expect(r.licenceNumber).toBe("12345678");
    expect(r.state).toBe("NSW"); // upper-cased
    expect(r.licenceClass).toBe("C");
    expect(r.dateOfBirth).toBeInstanceOf(Date);
    expect(r.confidence).toBe(0.95);
  });

  test("a passport in the licence extractor returns the type but NO licence fields", async () => {
    // Even if the model erroneously returns high confidence and a stray field,
    // the wrong-type guard fires first and emits no licence data.
    mockVision({
      documentType: "PASSPORT",
      licenceNumber: "SHOULD-NOT-LEAK",
      confidence: 0.9,
    });

    const r = await extractLicenceData(IMG);
    expect(r.documentType).toBe("PASSPORT");
    expect(r.licenceNumber).toBeUndefined();
    expect(r.state).toBeUndefined();
    expect(r.confidence).toBe(0.9);
  });

  test("a non-ID image returns documentType OTHER and no fields", async () => {
    mockVision({ documentType: "OTHER", confidence: 0 });

    const r = await extractLicenceData(IMG);
    expect(r.documentType).toBe("OTHER");
    expect(r.licenceNumber).toBeUndefined();
    expect(r.confidence).toBe(0);
  });

  test("right type but low confidence returns documentType, no fields", async () => {
    mockVision({
      documentType: "DRIVERS_LICENCE",
      licenceNumber: "X",
      confidence: 0.4, // below MIN_CONFIDENCE
    });

    const r = await extractLicenceData(IMG);
    expect(r.documentType).toBe("DRIVERS_LICENCE");
    expect(r.licenceNumber).toBeUndefined();
    expect(r.confidence).toBe(0.4);
  });

  test("missing documentType (model omitted it) is treated as a licence", async () => {
    mockVision({ licenceNumber: "9988", state: "vic", confidence: 0.9 });

    const r = await extractLicenceData(IMG);
    expect(r.documentType).toBeUndefined();
    expect(r.licenceNumber).toBe("9988");
    expect(r.state).toBe("VIC");
  });

  test("no tool call returns confidence 0 and no documentType", async () => {
    mockVision(null);

    const r = await extractLicenceData(IMG);
    expect(r.confidence).toBe(0);
    expect(r.documentType).toBeUndefined();
  });

  test("an outbound failure is swallowed to confidence 0", async () => {
    vi.spyOn(_internal, "runVisionTool").mockRejectedValue(new Error("network"));

    const r = await extractLicenceData(IMG);
    expect(r.confidence).toBe(0);
    expect(r.documentType).toBeUndefined();
  });
});

describe("extractPassportData — classification", () => {
  test("a passport extracts fields + documentType", async () => {
    mockVision({
      documentType: "PASSPORT",
      passportNumber: "PA1234567",
      country: "Australia",
      expiryDate: "2031-06-30",
      confidence: 0.92,
    });

    const r = await extractPassportData(IMG);
    expect(r.documentType).toBe("PASSPORT");
    expect(r.passportNumber).toBe("PA1234567");
    expect(r.country).toBe("Australia");
    expect(r.expiryDate).toBeInstanceOf(Date);
    expect(r.confidence).toBe(0.92);
  });

  test("a licence in the passport extractor returns the type but NO passport fields", async () => {
    mockVision({
      documentType: "DRIVERS_LICENCE",
      passportNumber: "SHOULD-NOT-LEAK",
      confidence: 0.9,
    });

    const r = await extractPassportData(IMG);
    expect(r.documentType).toBe("DRIVERS_LICENCE");
    expect(r.passportNumber).toBeUndefined();
    expect(r.confidence).toBe(0.9);
  });

  test("a non-ID image returns documentType OTHER and no fields", async () => {
    mockVision({ documentType: "OTHER", confidence: 0 });

    const r = await extractPassportData(IMG);
    expect(r.documentType).toBe("OTHER");
    expect(r.passportNumber).toBeUndefined();
    expect(r.confidence).toBe(0);
  });
});
