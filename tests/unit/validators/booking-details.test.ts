import { describe, expect, it } from "vitest";
import { detailsStepSchema } from "@/lib/validators/booking";

/**
 * Happy-path DOB used across these specs — adult on the date this file
 * was written (2026-04-25). Hardcoded to avoid any time-zone math:
 * someone born 1990-01-01 is 36 years old today, well within the 18–100
 * bracket and with a licence/passport expiry still in the future.
 */
const DOB_ADULT = "1990-01-01";
const FAR_FUTURE_EXPIRY = "2040-12-31";

const basePersonal = {
  firstName: "Jo",
  lastName: "Example",
  email: "jo@example.com",
  phone: "0412345678",
  dateOfBirth: DOB_ADULT,
  emergencyContactName: "",
  emergencyContactPhone: "",
};

describe("detailsStepSchema", () => {
  describe("identityPath = AU_LICENCE", () => {
    it("accepts a complete AU licence triplet", () => {
      const result = detailsStepSchema.safeParse({
        ...basePersonal,
        identityPath: "AU_LICENCE",
        licenceNumber: "12345678",
        licenceState: "QLD",
        licenceExpiry: FAR_FUTURE_EXPIRY,
        licenceClass: "C",
        licenceCountry: "",
        passportNumber: "",
        passportCountry: "",
        passportExpiry: "",
      });
      expect(result.success).toBe(true);
    });

    it("rejects when licenceNumber is missing", () => {
      const result = detailsStepSchema.safeParse({
        ...basePersonal,
        identityPath: "AU_LICENCE",
        licenceNumber: "",
        licenceState: "QLD",
        licenceExpiry: FAR_FUTURE_EXPIRY,
        licenceClass: "C",
        licenceCountry: "",
        passportNumber: "",
        passportCountry: "",
        passportExpiry: "",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.path.includes("licenceNumber"))).toBe(true);
      }
    });

    it("does NOT require passport fields under AU path", () => {
      const result = detailsStepSchema.safeParse({
        ...basePersonal,
        identityPath: "AU_LICENCE",
        licenceNumber: "12345678",
        licenceState: "NSW",
        licenceExpiry: FAR_FUTURE_EXPIRY,
        licenceClass: "C",
        licenceCountry: "",
        // No passport.
        passportNumber: "",
        passportCountry: "",
        passportExpiry: "",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("identityPath = INTERNATIONAL", () => {
    const completeInternational = {
      ...basePersonal,
      identityPath: "INTERNATIONAL" as const,
      licenceNumber: "IDP-9876",
      licenceState: undefined,
      licenceCountry: "US",
      licenceExpiry: FAR_FUTURE_EXPIRY,
      licenceClass: "",
      passportNumber: "P1234567",
      passportCountry: "US",
      passportExpiry: FAR_FUTURE_EXPIRY,
    };

    it("accepts a complete IDP + passport pair", () => {
      const result = detailsStepSchema.safeParse(completeInternational);
      expect(result.success).toBe(true);
    });

    it("rejects when passport fields are missing — both docs are required", () => {
      const result = detailsStepSchema.safeParse({
        ...completeInternational,
        passportNumber: "",
        passportExpiry: "",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path.join("."));
        expect(paths).toContain("passportNumber");
        expect(paths).toContain("passportExpiry");
      }
    });

    it("rejects when IDP licenceCountry is missing or malformed", () => {
      const missing = detailsStepSchema.safeParse({
        ...completeInternational,
        licenceCountry: "",
      });
      expect(missing.success).toBe(false);

      const badFormat = detailsStepSchema.safeParse({
        ...completeInternational,
        licenceCountry: "USA",
      });
      expect(badFormat.success).toBe(false);
    });

    it("rejects when the IDP licenceNumber is missing", () => {
      const result = detailsStepSchema.safeParse({
        ...completeInternational,
        licenceNumber: "",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("legacy mode (identityPath = undefined)", () => {
    it("accepts either a licence triplet OR a passport triplet (legacy behaviour)", () => {
      const licenceOnly = detailsStepSchema.safeParse({
        ...basePersonal,
        identityPath: undefined,
        licenceNumber: "12345678",
        licenceState: "QLD",
        licenceExpiry: FAR_FUTURE_EXPIRY,
        licenceClass: "C",
        licenceCountry: "",
        passportNumber: "",
        passportCountry: "",
        passportExpiry: "",
      });
      expect(licenceOnly.success).toBe(true);

      const passportOnly = detailsStepSchema.safeParse({
        ...basePersonal,
        identityPath: undefined,
        licenceNumber: "",
        licenceState: undefined,
        licenceExpiry: "",
        licenceClass: "",
        licenceCountry: "",
        passportNumber: "P1234567",
        passportCountry: "AU",
        passportExpiry: FAR_FUTURE_EXPIRY,
      });
      expect(passportOnly.success).toBe(true);
    });

    it("rejects when neither ID is supplied", () => {
      const result = detailsStepSchema.safeParse({
        ...basePersonal,
        identityPath: undefined,
        licenceNumber: "",
        licenceState: undefined,
        licenceExpiry: "",
        licenceClass: "",
        licenceCountry: "",
        passportNumber: "",
        passportCountry: "",
        passportExpiry: "",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("age gate", () => {
    it("rejects dates of birth that resolve to under-18", () => {
      // Born two years ago — clearly under 18.
      const twoYearsAgo = new Date();
      twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
      const dob = twoYearsAgo.toISOString().slice(0, 10);

      const result = detailsStepSchema.safeParse({
        ...basePersonal,
        dateOfBirth: dob,
        identityPath: "AU_LICENCE",
        licenceNumber: "12345678",
        licenceState: "QLD",
        licenceExpiry: FAR_FUTURE_EXPIRY,
        licenceClass: "C",
        licenceCountry: "",
        passportNumber: "",
        passportCountry: "",
        passportExpiry: "",
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.path.includes("dateOfBirth"))).toBe(true);
      }
    });
  });
});
