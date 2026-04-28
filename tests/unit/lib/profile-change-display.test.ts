import { describe, expect, it } from "vitest";

import { buildProfileChangeRows } from "@/lib/profile-change-display";

describe("buildProfileChangeRows", () => {
  it("humanises field names and pairs previous → current values", () => {
    const rows = buildProfileChangeRows({
      previousData: { firstName: "Alex", phone: "+61400000000" },
      newData: { firstName: "Alexandra", phone: "+61411222333" },
    });
    expect(rows).toEqual([
      { label: "First name", previous: "Alex", current: "Alexandra" },
      { label: "Phone", previous: "+61400000000", current: "+61411222333" },
    ]);
  });

  it("masks identity numbers to last-4 so the wire never carries plaintext", () => {
    const rows = buildProfileChangeRows({
      previousData: { licenceNumber: "12345678" },
      newData: { licenceNumber: "98765432" },
    });
    expect(rows).toEqual([
      { label: "Licence number", previous: "****5678", current: "****5432" },
    ]);
  });

  it("renders password and *Enc companions as '(updated)' without echoing the value", () => {
    const rows = buildProfileChangeRows({
      previousData: { password: "old-hash" },
      newData: { password: "new-hash" },
      changedFields: ["password"],
    });
    expect(rows).toEqual([
      { label: "Password", previous: "(updated)", current: "(updated)" },
    ]);
  });

  it("formats date fields in en-AU medium style", () => {
    const rows = buildProfileChangeRows({
      previousData: { licenceExpiry: new Date("2026-01-15T00:00:00Z") },
      newData: { licenceExpiry: new Date("2027-06-30T00:00:00Z") },
    });
    expect(rows[0]!.label).toBe("Licence expiry");
    expect(rows[0]!.previous).toMatch(/2026/);
    expect(rows[0]!.current).toMatch(/2027/);
  });

  it("renders booleans as Yes / No for marketing toggles", () => {
    const rows = buildProfileChangeRows({
      previousData: { marketingOptIn: false },
      newData: { marketingOptIn: true },
    });
    expect(rows).toEqual([
      { label: "Marketing emails", previous: "No", current: "Yes" },
    ]);
  });

  it("uses '(empty)' for null / undefined / empty-string values", () => {
    const rows = buildProfileChangeRows({
      previousData: { addressLine2: null },
      newData: { addressLine2: "Unit 4" },
    });
    expect(rows[0]).toEqual({
      label: "Address line 2",
      previous: "(empty)",
      current: "Unit 4",
    });
  });

  it("collapses *Enc companion fields onto the parent identity field", () => {
    const rows = buildProfileChangeRows({
      previousData: { licenceNumberEnc: "old-encrypted" },
      newData: { licenceNumberEnc: "new-encrypted", licenceNumber: "12349999" },
      changedFields: ["licenceNumberEnc", "licenceNumber"],
    });
    // One row, not two — the *Enc column collapses into the identity field.
    expect(rows).toHaveLength(1);
    expect(rows[0]!.label).toBe("Licence number");
    expect(rows[0]!.current).toBe("****9999");
  });

  it("renders '(unknown)' for previous when no snapshot is provided", () => {
    const rows = buildProfileChangeRows({
      newData: { firstName: "Alex" },
      changedFields: ["firstName"],
    });
    expect(rows[0]).toEqual({
      label: "First name",
      previous: "(unknown)",
      current: "Alex",
    });
  });
});
