import { describe, expect, test } from "vitest";
import { z } from "zod";

import {
  enforceAtLeastOneValidId,
  isLicenceComplete,
  isPassportComplete,
  passportCountrySchema,
  passportExpirySchema,
  passportNumberSchema,
} from "@/lib/validators/identity";

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const future = iso(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000));
const past = iso(new Date(Date.now() - 365 * 24 * 60 * 60 * 1000));

describe("passportNumberSchema", () => {
  test("accepts alphanumeric", () => {
    expect(passportNumberSchema.safeParse("PA1234567").success).toBe(true);
    expect(passportNumberSchema.safeParse("12345678").success).toBe(true);
  });
  test("rejects too-short", () => {
    expect(passportNumberSchema.safeParse("A1").success).toBe(false);
  });
  test("rejects spaces / punctuation", () => {
    expect(passportNumberSchema.safeParse("PA 123 456").success).toBe(false);
    expect(passportNumberSchema.safeParse("PA-1234").success).toBe(false);
  });
  test("trims whitespace", () => {
    const r = passportNumberSchema.safeParse("  PA1234567  ");
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toBe("PA1234567");
  });
});

describe("passportCountrySchema", () => {
  test("accepts ISO alpha-2", () => {
    expect(passportCountrySchema.safeParse("AU").success).toBe(true);
  });
  test("accepts full country name", () => {
    expect(passportCountrySchema.safeParse("Australia").success).toBe(true);
    expect(
      passportCountrySchema.safeParse(
        "United Kingdom of Great Britain and Northern Ireland",
      ).success,
    ).toBe(true);
  });
  test("rejects single-character", () => {
    expect(passportCountrySchema.safeParse("A").success).toBe(false);
  });
});

describe("passportExpirySchema", () => {
  test("accepts future date", () => {
    expect(passportExpirySchema.safeParse(future).success).toBe(true);
  });
  test("rejects past date", () => {
    expect(passportExpirySchema.safeParse(past).success).toBe(false);
  });
  test("rejects garbage", () => {
    expect(passportExpirySchema.safeParse("not-a-date").success).toBe(false);
  });
});

describe("isLicenceComplete", () => {
  test("true when all three present and expiry in future", () => {
    expect(
      isLicenceComplete({ number: "12345", state: "QLD", expiry: future }),
    ).toBe(true);
  });
  test("false when any missing", () => {
    expect(isLicenceComplete({ number: "12345", state: "QLD" })).toBe(false);
    expect(isLicenceComplete({ number: "12345", expiry: future })).toBe(false);
    expect(isLicenceComplete(null)).toBe(false);
  });
  test("false when expiry in past", () => {
    expect(
      isLicenceComplete({ number: "12345", state: "QLD", expiry: past }),
    ).toBe(false);
  });
});

describe("isPassportComplete", () => {
  test("true when all three present and expiry in future", () => {
    expect(
      isPassportComplete({
        number: "PA1234567",
        country: "AU",
        expiry: future,
      }),
    ).toBe(true);
  });
  test("false when passport number invalid format", () => {
    expect(
      isPassportComplete({
        number: "!!!",
        country: "AU",
        expiry: future,
      }),
    ).toBe(false);
  });
  test("false when expiry in past", () => {
    expect(
      isPassportComplete({
        number: "PA1234567",
        country: "AU",
        expiry: past,
      }),
    ).toBe(false);
  });
});

describe("enforceAtLeastOneValidId", () => {
  const shell = z
    .object({
      licenceNumber: z.string().optional(),
      licenceState: z.string().optional(),
      licenceExpiry: z.string().optional(),
      passportNumber: z.string().optional(),
      passportCountry: z.string().optional(),
      passportExpiry: z.string().optional(),
    })
    .superRefine((v, ctx) => {
      enforceAtLeastOneValidId(
        { number: v.licenceNumber, state: v.licenceState, expiry: v.licenceExpiry },
        { number: v.passportNumber, country: v.passportCountry, expiry: v.passportExpiry },
        ctx,
        ["licenceNumber"],
      );
    });

  test("neither present → issue raised", () => {
    const r = shell.safeParse({});
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]!.message).toMatch(/driver's licence or your passport/);
    }
  });

  test("licence complete → no issue", () => {
    const r = shell.safeParse({
      licenceNumber: "12345",
      licenceState: "QLD",
      licenceExpiry: future,
    });
    expect(r.success).toBe(true);
  });

  test("passport complete → no issue", () => {
    const r = shell.safeParse({
      passportNumber: "PA1234567",
      passportCountry: "AU",
      passportExpiry: future,
    });
    expect(r.success).toBe(true);
  });

  test("licence expired + passport missing → issue raised", () => {
    const r = shell.safeParse({
      licenceNumber: "12345",
      licenceState: "QLD",
      licenceExpiry: past,
    });
    expect(r.success).toBe(false);
  });
});
