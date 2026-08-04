import { describe, expect, it } from "vitest";
import {
  extractMarkers,
  isMarkerObject,
  markerToIssueData,
  type InspectionForBackfill,
} from "../../../scripts/backfill-inspection-issues";

const postHire: InspectionForBackfill = { id: "insp_1", type: "POST_HIRE" };
const preHire: InspectionForBackfill = { id: "insp_2", type: "PRE_HIRE" };

describe("markerToIssueData", () => {
  it("maps a full marker across every field", () => {
    const issue = markerToIssueData(
      {
        id: "m1",
        x: 0.4,
        y: 0.7,
        severity: "MAJOR",
        note: "Deep scratch on tank",
        source: "customer",
        view: "LEFT",
        addedAt: "2026-01-01T00:00:00.000Z",
      },
      postHire,
    );

    expect(issue).toEqual({
      inspectionId: "insp_1",
      inspectionPhotoId: null,
      side: "LEFT",
      damageTariffId: null,
      label: "Deep scratch on tank",
      severity: "MAJOR",
      note: null,
      posX: null,
      posY: null,
      source: "customer",
      isPreExisting: false,
    });
  });

  it("falls back to the 'Marking' label when the note is missing", () => {
    expect(markerToIssueData({ severity: "MINOR", view: "RIGHT" }, postHire).label).toBe("Marking");
  });

  it("treats a whitespace-only note as no note", () => {
    expect(markerToIssueData({ note: "   " }, postHire).label).toBe("Marking");
  });

  it("trims a real note into the label", () => {
    expect(markerToIssueData({ note: "  cracked mirror  " }, postHire).label).toBe("cracked mirror");
  });

  it("defaults severity to MINOR when missing or invalid", () => {
    expect(markerToIssueData({}, postHire).severity).toBe("MINOR");
    expect(markerToIssueData({ severity: "CATASTROPHIC" }, postHire).severity).toBe("MINOR");
    expect(markerToIssueData({ severity: 3 }, postHire).severity).toBe("MINOR");
  });

  it("preserves each valid severity", () => {
    expect(markerToIssueData({ severity: "MODERATE" }, postHire).severity).toBe("MODERATE");
    expect(markerToIssueData({ severity: "MAJOR" }, postHire).severity).toBe("MAJOR");
  });

  it("maps view FRONT/REAR/LEFT/RIGHT onto side, REAR stays REAR", () => {
    expect(markerToIssueData({ view: "FRONT" }, postHire).side).toBe("FRONT");
    expect(markerToIssueData({ view: "REAR" }, postHire).side).toBe("REAR");
    expect(markerToIssueData({ view: "LEFT" }, postHire).side).toBe("LEFT");
    expect(markerToIssueData({ view: "RIGHT" }, postHire).side).toBe("RIGHT");
  });

  it("maps a TOP / missing / unknown view to a null side", () => {
    expect(markerToIssueData({ view: "TOP" }, postHire).side).toBeNull();
    expect(markerToIssueData({}, postHire).side).toBeNull();
    expect(markerToIssueData({ view: "OTHER" }, postHire).side).toBeNull();
  });

  it("only treats source 'customer' as customer; everything else is staff", () => {
    expect(markerToIssueData({ source: "customer" }, postHire).source).toBe("customer");
    expect(markerToIssueData({ source: "staff" }, postHire).source).toBe("staff");
    expect(markerToIssueData({}, postHire).source).toBe("staff");
    expect(markerToIssueData({ source: "system" }, postHire).source).toBe("staff");
  });

  it("sets isPreExisting from the inspection type", () => {
    expect(markerToIssueData({}, preHire).isPreExisting).toBe(true);
    expect(markerToIssueData({}, postHire).isPreExisting).toBe(false);
  });

  it("always nulls the photo/coord/tariff fields and the note", () => {
    const issue = markerToIssueData({ x: 0.1, y: 0.2, note: "x" }, postHire);
    expect(issue.posX).toBeNull();
    expect(issue.posY).toBeNull();
    expect(issue.inspectionPhotoId).toBeNull();
    expect(issue.damageTariffId).toBeNull();
    expect(issue.note).toBeNull();
  });
});

describe("extractMarkers", () => {
  it("returns the markers array from a well-formed bodyDamageMap", () => {
    const markers = [{ x: 0.1, y: 0.2 }];
    expect(extractMarkers({ markers })).toBe(markers);
  });

  it("returns [] for the empty default, missing markers, or a non-array markers", () => {
    expect(extractMarkers({})).toEqual([]);
    expect(extractMarkers({ markers: "nope" })).toEqual([]);
    expect(extractMarkers({ markers: null })).toEqual([]);
  });

  it("returns [] for non-object JSON values", () => {
    expect(extractMarkers(null)).toEqual([]);
    expect(extractMarkers("{}")).toEqual([]);
    expect(extractMarkers(42)).toEqual([]);
    expect(extractMarkers([])).toEqual([]);
  });
});

describe("isMarkerObject", () => {
  it("accepts a plain object", () => {
    expect(isMarkerObject({ x: 1 })).toBe(true);
  });

  it("rejects arrays, null, and primitives", () => {
    expect(isMarkerObject([])).toBe(false);
    expect(isMarkerObject(null)).toBe(false);
    expect(isMarkerObject("marker")).toBe(false);
    expect(isMarkerObject(7)).toBe(false);
    expect(isMarkerObject(undefined)).toBe(false);
  });
});
