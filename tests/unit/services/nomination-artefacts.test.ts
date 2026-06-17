import { describe, expect, it, vi } from "vitest";

// Avoid pulling in the crypto envelope for these pure-function tests.
vi.mock("@/lib/customer-pii", () => ({
  readPiiField: (plain: string | null) => plain ?? null,
}));

import {
  DEFAULT_ENOMINATIONS_COLUMNS,
  buildENominationsCsv,
  maskLicence,
  missingNomineeFields,
  nomineeAddressLine,
  nomineeFullName,
  resolveENominationsColumns,
  type NomineeSnapshot,
  type NominationArtefactInput,
} from "@/server/services/nomination-artefacts";

const fullNominee: NomineeSnapshot = {
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
};

const input: NominationArtefactInput = {
  penaltyNoticeNumber: "PN-001",
  offenceDate: new Date(Date.UTC(2026, 3, 5, 8, 14)),
  offenceCode: "1234",
  offenceDescription: "Exceed speed limit by 10 km/h",
  offenceLocation: "M2 Pennant Hills",
  issuer: "Revenue NSW",
  vehicleRego: "ABC123",
  nominee: fullNominee,
};

describe("nominee helpers", () => {
  it("composes full name and address line", () => {
    expect(nomineeFullName(fullNominee)).toBe("Jane Doe");
    expect(nomineeAddressLine(fullNominee)).toBe("6 Tweedmouth Ave, Rosebery, NSW, 2018");
  });

  it("masks the licence number", () => {
    expect(maskLicence(fullNominee)).toBe("NSW ••••5678");
    expect(maskLicence({ ...fullNominee, licenceNumber: null })).toBeNull();
  });

  it("reports no missing fields for a complete nominee", () => {
    expect(missingNomineeFields(fullNominee)).toEqual([]);
  });

  it("flags each missing mandatory field", () => {
    expect(missingNomineeFields({ ...fullNominee, licenceNumber: null })).toContain("licenceNumber");
    expect(missingNomineeFields({ ...fullNominee, dob: null })).toContain("dob");
    expect(
      missingNomineeFields({
        ...fullNominee,
        addressLine1: null,
        addressLine2: null,
        suburb: null,
        state: null,
        postcode: null,
      }),
    ).toContain("address");
    expect(
      missingNomineeFields({ ...fullNominee, licenceState: null, licenceCountry: null }),
    ).toContain("licenceState");
  });
});

describe("buildENominationsCsv", () => {
  it("emits a header row plus one data row per nomination", () => {
    const csv = buildENominationsCsv([input]);
    const lines = csv.trim().split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("Penalty Notice Number");
    expect(lines[1]).toContain("PN-001");
    expect(lines[1]).toContain("ABC123");
    expect(lines[1]).toContain("12345678");
    expect(lines[1]).toContain("05/04/2026"); // offence date, en-AU
  });

  it("escapes cells containing commas/quotes", () => {
    const csv = buildENominationsCsv([
      { ...input, nominee: { ...fullNominee, addressLine1: 'Unit 1, "The Grand"' } },
    ]);
    // The whole address cell is quoted and inner quotes are doubled.
    expect(csv).toContain('"Unit 1, ""The Grand"", Rosebery, NSW, 2018"');
  });
});

describe("resolveENominationsColumns", () => {
  it("falls back to the default layout when the setting is absent/empty", () => {
    expect(resolveENominationsColumns(undefined)).toBe(DEFAULT_ENOMINATIONS_COLUMNS);
    expect(resolveENominationsColumns([])).toBe(DEFAULT_ENOMINATIONS_COLUMNS);
  });

  it("remaps headers to known value extractors", () => {
    const cols = resolveENominationsColumns([
      { header: "PNN", mapsTo: "Penalty Notice Number" },
      { header: "Rego", mapsTo: "Registration" },
    ]);
    expect(cols.map((c) => c.header)).toEqual(["PNN", "Rego"]);
    const csv = buildENominationsCsv([input], cols);
    expect(csv.split("\r\n")[0]).toBe("PNN,Rego");
    expect(csv.split("\r\n")[1]).toBe("PN-001,ABC123");
  });

  it("ignores unknown mappings rather than injecting arbitrary data", () => {
    expect(resolveENominationsColumns([{ header: "X", mapsTo: "Nonexistent" }])).toBe(
      DEFAULT_ENOMINATIONS_COLUMNS,
    );
  });
});
