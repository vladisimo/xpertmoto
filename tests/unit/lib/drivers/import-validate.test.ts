import { describe, expect, test } from "vitest";
import {
  mapImages,
  validateDriverBatch,
  validateDriverRow,
} from "@/lib/drivers/import-validate";
import type { DriverRawRow } from "@/lib/drivers/import-parse";

/**
 * Build a minimally-complete legacy row. Override whichever fields the
 * specific test cares about.
 */
function row(overrides: Partial<DriverRawRow> = {}): DriverRawRow {
  return {
    driver_id: "100",
    name: "Alice Smith",
    status: "Active",
    email: "alice@example.com",
    mobile: "+61400123456",
    secondary_number: null,
    address: null,
    dob: "15/06/1990",
    added_date: "01/02/2023 10:30",
    referral_source: null,
    license_no: "12345678",
    license_state_issued: "NSW",
    license_expiry: "15/06/2028",
    license_valid: "VALID",
    last_ra: null,
    created_at: null,
    images: null,
    ...overrides,
  };
}

describe("validateDriverRow", () => {
  test("happy path — fully populated row maps every field", () => {
    const v = validateDriverRow(row());
    expect(v.status).toBe("ok");
    if (v.status !== "ok") return;
    expect(v.row.legacyDriverId).toBe("100");
    expect(v.row.email).toBe("alice@example.com");
    expect(v.row.firstName).toBe("Alice");
    expect(v.row.lastName).toBe("Smith");
    expect(v.row.phone).toBe("+61400123456");
    expect(v.row.status).toBe("ACTIVE");
    expect(v.row.softDelete).toBe(false);
    expect(v.row.dateOfBirth?.toISOString().startsWith("1990-06-15")).toBe(true);
    expect(v.row.profile.licenceNumber).toBe("12345678");
    expect(v.row.profile.licenceState).toBe("NSW");
  });

  test("missing email → skip (can't dedupe without it)", () => {
    const v = validateDriverRow(row({ email: null }));
    expect(v.status).toBe("skip");
    if (v.status === "skip") expect(v.reason).toBe("missing_email");
  });

  test("missing name → error", () => {
    const v = validateDriverRow(row({ name: null }));
    expect(v.status).toBe("error");
    if (v.status === "error") {
      expect(v.issues.some((i) => i.includes("name"))).toBe(true);
    }
  });

  test("single-word name lands in firstName, lastName is empty", () => {
    const v = validateDriverRow(row({ name: "Madonna" }));
    expect(v.status).toBe("ok");
    if (v.status !== "ok") return;
    expect(v.row.firstName).toBe("Madonna");
    expect(v.row.lastName).toBe("");
  });

  test("multi-word name splits first / remainder", () => {
    const v = validateDriverRow(row({ name: "Mary Jane Watson-Parker" }));
    expect(v.status).toBe("ok");
    if (v.status !== "ok") return;
    expect(v.row.firstName).toBe("Mary");
    expect(v.row.lastName).toBe("Jane Watson-Parker");
  });

  test("DOB placeholder 01/01/1970 → null (legacy sentinel)", () => {
    const v = validateDriverRow(row({ dob: "01/01/1970" }));
    expect(v.status).toBe("ok");
    if (v.status !== "ok") return;
    expect(v.row.dateOfBirth).toBeNull();
  });

  test("DOB junk → null, not an error", () => {
    const v = validateDriverRow(row({ dob: "not a date" }));
    expect(v.status).toBe("ok");
    if (v.status !== "ok") return;
    expect(v.row.dateOfBirth).toBeNull();
  });

  test("status Archived → SUSPENDED + softDelete", () => {
    const v = validateDriverRow(row({ status: "Archived" }));
    expect(v.status).toBe("ok");
    if (v.status !== "ok") return;
    expect(v.row.status).toBe("SUSPENDED");
    expect(v.row.softDelete).toBe(true);
  });

  test("status Active → ACTIVE, no soft-delete", () => {
    const v = validateDriverRow(row({ status: "Active" }));
    expect(v.status).toBe("ok");
    if (v.status !== "ok") return;
    expect(v.row.status).toBe("ACTIVE");
    expect(v.row.softDelete).toBe(false);
  });

  test("unknown status → SUSPENDED, not soft-deleted (safe default)", () => {
    const v = validateDriverRow(row({ status: "Pending Review" }));
    expect(v.status).toBe("ok");
    if (v.status !== "ok") return;
    expect(v.row.status).toBe("SUSPENDED");
    expect(v.row.softDelete).toBe(false);
  });

  test("NA- licence number → null (legacy placeholder)", () => {
    const v = validateDriverRow(row({ license_no: "NA-12345" }));
    expect(v.status).toBe("ok");
    if (v.status !== "ok") return;
    expect(v.row.profile.licenceNumber).toBeNull();
  });

  test("phone '+61' with no digits → null (broken legacy value)", () => {
    const v = validateDriverRow(row({ mobile: "+61" }));
    expect(v.status).toBe("ok");
    if (v.status !== "ok") return;
    expect(v.row.phone).toBeNull();
  });

  test("phone with punctuation is cleaned", () => {
    const v = validateDriverRow(row({ mobile: "(04) 12 345 678" }));
    expect(v.status).toBe("ok");
    if (v.status !== "ok") return;
    expect(v.row.phone).toBe("0412345678");
  });

  test("email is lowercased + trimmed", () => {
    const v = validateDriverRow(row({ email: "  Alice@Example.COM " }));
    expect(v.status).toBe("ok");
    if (v.status !== "ok") return;
    expect(v.row.email).toBe("alice@example.com");
  });

  describe("address parsing", () => {
    test("full AU format splits into line/suburb/state/postcode", () => {
      const v = validateDriverRow(
        row({ address: "123 Collins St, Melbourne, VIC 3000" }),
      );
      expect(v.status).toBe("ok");
      if (v.status !== "ok") return;
      expect(v.row.profile.addressLine1).toBe("123 Collins St");
      expect(v.row.profile.suburb).toBe("Melbourne");
      expect(v.row.profile.state).toBe("VIC");
      expect(v.row.profile.postcode).toBe("3000");
    });

    test("unparseable address falls back to line1", () => {
      const v = validateDriverRow(row({ address: "somewhere overseas" }));
      expect(v.status).toBe("ok");
      if (v.status !== "ok") return;
      expect(v.row.profile.addressLine1).toBe("somewhere overseas");
      expect(v.row.profile.state).toBeNull();
      expect(v.row.profile.postcode).toBeNull();
    });

    test("partial AU format (no street) still extracts state + postcode", () => {
      const v = validateDriverRow(row({ address: "Bondi, NSW 2026" }));
      expect(v.status).toBe("ok");
      if (v.status !== "ok") return;
      expect(v.row.profile.state).toBe("NSW");
      expect(v.row.profile.postcode).toBe("2026");
    });
  });
});

describe("validateDriverBatch — cross-row rules", () => {
  test("duplicate emails: highest driver_id wins, older rows skip", () => {
    const rows = [
      row({ driver_id: "200", email: "dup@example.com", name: "Old A" }),
      row({ driver_id: "500", email: "dup@example.com", name: "New B" }),
      row({ driver_id: "150", email: "dup@example.com", name: "Older C" }),
    ];
    const result = validateDriverBatch(rows, [2, 3, 4]);
    expect(result.ok).toHaveLength(1);
    expect(result.ok[0]!.legacyDriverId).toBe("500");
    expect(result.skipped).toHaveLength(2);
    const reasons = result.skipped.map((s) => s.reason);
    expect(reasons.every((r) => r === "duplicate_email_older_row")).toBe(true);
    const notes = result.skipped.map((s) => s.note);
    expect(notes.every((n) => n?.includes("500"))).toBe(true);
  });

  test("duplicate driver_ids are skipped on both sides", () => {
    const rows = [
      row({ driver_id: "100", email: "a@example.com" }),
      row({ driver_id: "100", email: "b@example.com" }),
    ];
    const result = validateDriverBatch(rows, [2, 3]);
    expect(result.ok).toHaveLength(0);
    expect(result.skipped).toHaveLength(2);
    expect(result.skipped.every((s) => s.reason === "duplicate_driver_id")).toBe(true);
  });

  test("preserves original row numbers for reporting", () => {
    const rows = [
      row({ driver_id: "1", email: "ok@example.com" }),
      row({ driver_id: "2", email: "fail@example.com", name: null }),
    ];
    const result = validateDriverBatch(rows, [2, 99]);
    expect(result.errored).toHaveLength(1);
    expect(result.errored[0]!.rowNumber).toBe(99);
  });

  test("mixed outcome: ok + skip + error all present", () => {
    const rows = [
      row({ driver_id: "1", email: "ok@example.com" }),
      row({ driver_id: "2", email: null }), // skip
      row({ driver_id: "3", email: "bad@example.com", name: null }), // error
    ];
    const result = validateDriverBatch(rows, [2, 3, 4]);
    expect(result.ok).toHaveLength(1);
    expect(result.skipped).toHaveLength(1);
    expect(result.errored).toHaveLength(1);
  });
});

describe("mapImages — filename classification", () => {
  test("recognises every documented suffix", () => {
    const out = mapImages(
      "253880",
      "253880_license_front.jpg;253880_license_back.jpg;253880_passport.png;253880_dlpassport.jpg;253880_signature.png",
    );
    const byKind = Object.fromEntries(
      out.map((r) => {
        if (r.target.kind === "customerDocument") return [r.filename, r.target.type];
        return [r.filename, r.target.kind];
      }),
    );
    expect(byKind["253880_license_front.jpg"]).toBe("LICENCE_FRONT");
    expect(byKind["253880_license_back.jpg"]).toBe("LICENCE_BACK");
    expect(byKind["253880_passport.png"]).toBe("PASSPORT");
    expect(byKind["253880_dlpassport.jpg"]).toBe("PASSPORT_STYLE_DL");
    expect(byKind["253880_signature.png"]).toBe("signatureImage");
  });

  test("dlpassport matches before passport (more specific suffix wins)", () => {
    const out = mapImages("1", "1_dlpassport.jpg");
    expect(out).toHaveLength(1);
    const target = out[0]!.target;
    if (target.kind !== "customerDocument") throw new Error("expected document");
    expect(target.type).toBe("PASSPORT_STYLE_DL");
  });

  test("unknown filename is dropped (not an image ref)", () => {
    const out = mapImages("1", "1_mystery.png;1_license_front.jpg");
    expect(out).toHaveLength(1);
    expect(out[0]!.filename).toBe("1_license_front.jpg");
  });

  test("empty / null images cell returns empty array", () => {
    expect(mapImages("1", null)).toEqual([]);
    expect(mapImages("1", "")).toEqual([]);
    expect(mapImages("1", " ; ; ")).toEqual([]);
  });

  test("is case-insensitive", () => {
    const out = mapImages("1", "1_LICENSE_FRONT.JPG");
    expect(out).toHaveLength(1);
    const target = out[0]!.target;
    if (target.kind !== "customerDocument") throw new Error("expected document");
    expect(target.type).toBe("LICENCE_FRONT");
  });
});
