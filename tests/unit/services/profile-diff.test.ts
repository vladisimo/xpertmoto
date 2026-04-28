import { describe, expect, test } from "vitest";
import { computeFieldDiff } from "@/server/services/profile-diff";

describe("computeFieldDiff", () => {
  test("returns null when nothing changed", () => {
    expect(
      computeFieldDiff(
        { firstName: "Alice", lastName: "Smith" },
        { firstName: "Alice", lastName: "Smith" },
      ),
    ).toBeNull();
  });

  test("captures only changed fields", () => {
    const diff = computeFieldDiff(
      { firstName: "Alice", lastName: "Smith", phone: "0400 111 222" },
      { firstName: "Alicia", lastName: "Smith", phone: "0411 999 888" },
    );
    expect(diff).not.toBeNull();
    expect(diff!.changedFields.sort()).toEqual(["firstName", "phone"]);
    expect(diff!.previousData).toEqual({
      firstName: "Alice",
      phone: "0400 111 222",
    });
    expect(diff!.newData).toEqual({
      firstName: "Alicia",
      phone: "0411 999 888",
    });
  });

  test("treats null and undefined as equivalent", () => {
    expect(
      computeFieldDiff({ phone: null }, { phone: undefined }),
    ).toBeNull();
  });

  test("compares Date fields by ISO day — same day is unchanged", () => {
    const a = new Date("2026-03-01T09:15:00Z");
    const b = new Date("2026-03-01T21:45:00Z");
    expect(
      computeFieldDiff({ dateOfBirth: a }, { dateOfBirth: b }),
    ).toBeNull();
  });

  test("compares Date fields by ISO day — different day is changed", () => {
    const a = new Date("2026-03-01T00:00:00Z");
    const b = new Date("2026-03-02T00:00:00Z");
    const diff = computeFieldDiff({ dateOfBirth: a }, { dateOfBirth: b });
    expect(diff).not.toBeNull();
    expect(diff!.changedFields).toEqual(["dateOfBirth"]);
    expect(diff!.previousData.dateOfBirth).toBe(a.toISOString());
    expect(diff!.newData.dateOfBirth).toBe(b.toISOString());
  });

  test("masks PII fields with last-4 only, never plaintext", () => {
    const diff = computeFieldDiff(
      { licenceNumber: "123456789" },
      { licenceNumber: "987654321" },
      { mask: ["licenceNumber"] },
    );
    expect(diff).not.toBeNull();
    expect(diff!.previousData.licenceNumber).toBe("****6789");
    expect(diff!.newData.licenceNumber).toBe("****4321");
    // Plaintext must never leak even in the diff payload.
    expect(JSON.stringify(diff)).not.toContain("123456789");
    expect(JSON.stringify(diff)).not.toContain("987654321");
  });

  test("mask converts null to null, not '****'", () => {
    const diff = computeFieldDiff(
      { licenceNumber: null },
      { licenceNumber: "SOMETHING" },
      { mask: ["licenceNumber"] },
    );
    expect(diff).not.toBeNull();
    expect(diff!.previousData.licenceNumber).toBeNull();
    expect(diff!.newData.licenceNumber).toBe("****HING");
  });

  test("handles field present in one side only", () => {
    const diff = computeFieldDiff(
      { firstName: "Alice" },
      { firstName: "Alice", lastName: "Smith" },
    );
    expect(diff).not.toBeNull();
    expect(diff!.changedFields).toEqual(["lastName"]);
    expect(diff!.previousData.lastName).toBeNull();
    expect(diff!.newData.lastName).toBe("Smith");
  });

  test("normalises Date to ISO string in payload", () => {
    const before = new Date("2026-01-01T00:00:00Z");
    const after = new Date("2026-06-15T12:30:00Z");
    const diff = computeFieldDiff(
      { licenceExpiry: before },
      { licenceExpiry: after },
    );
    expect(diff).not.toBeNull();
    expect(diff!.previousData.licenceExpiry).toBe(before.toISOString());
    expect(diff!.newData.licenceExpiry).toBe(after.toISOString());
  });
});
