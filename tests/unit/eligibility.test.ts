import { test, expect, describe } from "vitest";
import { checkEligibility, licenceCovers, ageOnDate } from "../../src/server/services/eligibility";

const baseCategory = { name: "125cc Scooter", licenceRequired: "RE", minAge: 18 };
const motorcycleCategory = { name: "300cc Motorcycle", licenceRequired: "R", minAge: 21 };
const carCategory = { name: "50cc Scooter", licenceRequired: "CAR", minAge: 18 };
const pickupDate = new Date("2026-06-01T10:00:00Z");

const validLicence = {
  licenceClass: "RE" as const,
  licenceExpiry: new Date("2030-01-01"),
};
const validPassport = {
  passportNumber: "PA1234567" as const,
  passportExpiry: new Date("2032-01-01"),
};
const emptyLicence = { licenceClass: null, licenceExpiry: null };
const emptyPassport = { passportNumber: null, passportExpiry: null };

describe("licenceCovers", () => {
  test("full R covers RE category", () => {
    expect(licenceCovers("R", "RE")).toBe(true);
  });
  test("RE classes cover R category (R requirement is any motorcycle class)", () => {
    expect(licenceCovers("RE", "R")).toBe(true);
    expect(licenceCovers("RE_P1", "R")).toBe(true);
    expect(licenceCovers("RE_P2", "R")).toBe(true);
  });
  test("RE_P1 covers RE category", () => {
    expect(licenceCovers("RE_P1", "RE")).toBe(true);
  });
  test("CAR licence does not cover RE category", () => {
    expect(licenceCovers("CAR", "RE")).toBe(false);
  });
  test("CAR licence covers 50cc (CAR-required) category", () => {
    expect(licenceCovers("CAR", "CAR")).toBe(true);
  });
  test("case-insensitive and dash/space tolerant", () => {
    expect(licenceCovers("re-p1", "re")).toBe(true);
    expect(licenceCovers("RE P2", "RE")).toBe(true);
  });
  test("null customer class fails", () => {
    expect(licenceCovers(null, "RE")).toBe(false);
  });
  test("comma-delimited classes — any covering class satisfies", () => {
    expect(licenceCovers("C, R", "R")).toBe(true);
    expect(licenceCovers("C, R", "RE")).toBe(true);
    expect(licenceCovers("C, R", "CAR")).toBe(true);
    expect(licenceCovers("C,RE", "R")).toBe(true);
    expect(licenceCovers("C/R", "R")).toBe(true);
  });
  test("unknown tokens in a list are ignored, known ones still match", () => {
    expect(licenceCovers("LR, R", "R")).toBe(true);
    expect(licenceCovers("LR, MR", "R")).toBe(false);
  });
});

describe("ageOnDate", () => {
  test("birthday not yet reached this year", () => {
    const dob = new Date("2008-07-01T00:00:00Z");
    const on = new Date("2026-06-30T00:00:00Z");
    expect(ageOnDate(dob, on)).toBe(17);
  });
  test("birthday already passed this year", () => {
    const dob = new Date("2008-05-01T00:00:00Z");
    const on = new Date("2026-06-01T00:00:00Z");
    expect(ageOnDate(dob, on)).toBe(18);
  });
});

describe("checkEligibility — basic gates", () => {
  test("missing DOB fails with basis=none", () => {
    const r = checkEligibility({
      customer: { dateOfBirth: null, ...validLicence, ...emptyPassport },
      category: baseCategory,
      pickupDate,
    });
    expect(r.failure?.code).toBe("DOB_MISSING");
    expect(r.basis).toBe("none");
  });

  test("underage on pickup fails with basis=none", () => {
    const r = checkEligibility({
      customer: {
        dateOfBirth: new Date("2010-01-01"),
        ...validLicence,
        ...emptyPassport,
      },
      category: { ...baseCategory, minAge: 21 },
      pickupDate,
    });
    expect(r.failure?.code).toBe("AGE");
    expect(r.basis).toBe("none");
  });

  test("age evaluated on pickup date, not today", () => {
    const r = checkEligibility({
      customer: {
        dateOfBirth: new Date("2005-05-31"),
        licenceClass: "R",
        licenceExpiry: new Date("2030-01-01"),
        ...emptyPassport,
      },
      category: motorcycleCategory,
      pickupDate,
    });
    expect(r.failure).toBeNull();
    expect(r.basis).toBe("licence");
  });
});

describe("checkEligibility — identity gate (licence OR passport)", () => {
  test("no licence and no passport → NO_VALID_ID", () => {
    const r = checkEligibility({
      customer: {
        dateOfBirth: new Date("1990-01-01"),
        ...emptyLicence,
        ...emptyPassport,
      },
      category: baseCategory,
      pickupDate,
    });
    expect(r.failure?.code).toBe("NO_VALID_ID");
    expect(r.basis).toBe("none");
  });

  test("expired licence with no passport → NO_VALID_ID", () => {
    const r = checkEligibility({
      customer: {
        dateOfBirth: new Date("1990-01-01"),
        licenceClass: "R",
        licenceExpiry: new Date("2020-01-01"),
        ...emptyPassport,
      },
      category: baseCategory,
      pickupDate,
    });
    expect(r.failure?.code).toBe("NO_VALID_ID");
  });

  test("expired licence + expired passport → NO_VALID_ID", () => {
    const r = checkEligibility({
      customer: {
        dateOfBirth: new Date("1990-01-01"),
        licenceClass: "R",
        licenceExpiry: new Date("2020-01-01"),
        passportNumber: "X1",
        passportExpiry: new Date("2020-01-01"),
      },
      category: baseCategory,
      pickupDate,
    });
    expect(r.failure?.code).toBe("NO_VALID_ID");
  });
});

describe("checkEligibility — licence path", () => {
  test("valid licence covering category → basis=licence", () => {
    const r = checkEligibility({
      customer: {
        dateOfBirth: new Date("1990-01-01"),
        licenceClass: "R",
        licenceExpiry: new Date("2030-01-01"),
        ...emptyPassport,
      },
      category: baseCategory,
      pickupDate,
    });
    expect(r.failure).toBeNull();
    expect(r.basis).toBe("licence");
    expect(r.warnings).toEqual([]);
  });

  test("licence + passport both valid, covering class → basis=both", () => {
    const r = checkEligibility({
      customer: {
        dateOfBirth: new Date("1990-01-01"),
        ...validLicence,
        ...validPassport,
      },
      category: baseCategory,
      pickupDate,
    });
    expect(r.failure).toBeNull();
    expect(r.basis).toBe("both");
  });

  test("wrong licence class + no passport → LICENCE_CLASS failure", () => {
    const r = checkEligibility({
      customer: {
        dateOfBirth: new Date("1990-01-01"),
        licenceClass: "CAR",
        licenceExpiry: new Date("2030-01-01"),
        ...emptyPassport,
      },
      category: { ...baseCategory, licenceRequired: "R" },
      pickupDate,
    });
    expect(r.failure?.code).toBe("LICENCE_CLASS");
  });
});

describe("checkEligibility — passport path", () => {
  test("passport-only satisfies CAR category without warning", () => {
    const r = checkEligibility({
      customer: {
        dateOfBirth: new Date("1990-01-01"),
        ...emptyLicence,
        ...validPassport,
      },
      category: carCategory,
      pickupDate,
    });
    expect(r.failure).toBeNull();
    expect(r.basis).toBe("passport");
    expect(r.warnings).toEqual([]);
  });

  test("passport-only satisfies RE category with class-unknown warning", () => {
    const r = checkEligibility({
      customer: {
        dateOfBirth: new Date("1990-01-01"),
        ...emptyLicence,
        ...validPassport,
      },
      category: baseCategory,
      pickupDate,
    });
    expect(r.failure).toBeNull();
    expect(r.basis).toBe("passport");
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]!.code).toBe("CLASS_UNKNOWN_ON_PASSPORT_ONLY");
  });

  test("passport-only satisfies R category with class-unknown warning", () => {
    const r = checkEligibility({
      customer: {
        dateOfBirth: new Date("1990-01-01"),
        ...emptyLicence,
        ...validPassport,
      },
      category: motorcycleCategory,
      pickupDate,
    });
    expect(r.failure).toBeNull();
    expect(r.basis).toBe("passport");
    expect(r.warnings[0]!.code).toBe("CLASS_UNKNOWN_ON_PASSPORT_ONLY");
  });

  test("wrong licence class but valid passport → passport takes over, warning emitted", () => {
    const r = checkEligibility({
      customer: {
        dateOfBirth: new Date("1990-01-01"),
        licenceClass: "CAR",
        licenceExpiry: new Date("2030-01-01"),
        ...validPassport,
      },
      category: motorcycleCategory,
      pickupDate,
    });
    expect(r.failure).toBeNull();
    expect(r.basis).toBe("passport");
    expect(r.warnings[0]!.code).toBe("CLASS_UNKNOWN_ON_PASSPORT_ONLY");
  });

  test("expired licence but valid passport → passport takes over", () => {
    const r = checkEligibility({
      customer: {
        dateOfBirth: new Date("1990-01-01"),
        licenceClass: "R",
        licenceExpiry: new Date("2020-01-01"),
        ...validPassport,
      },
      category: motorcycleCategory,
      pickupDate,
    });
    expect(r.failure).toBeNull();
    expect(r.basis).toBe("passport");
  });

  test("valid licence overrides expired passport (no warning needed)", () => {
    const r = checkEligibility({
      customer: {
        dateOfBirth: new Date("1990-01-01"),
        licenceClass: "R",
        licenceExpiry: new Date("2030-01-01"),
        passportNumber: "X1",
        passportExpiry: new Date("2020-01-01"),
      },
      category: motorcycleCategory,
      pickupDate,
    });
    expect(r.failure).toBeNull();
    expect(r.basis).toBe("licence");
    expect(r.warnings).toEqual([]);
  });

  test("passport without expiry does not satisfy", () => {
    const r = checkEligibility({
      customer: {
        dateOfBirth: new Date("1990-01-01"),
        ...emptyLicence,
        passportNumber: "X1",
        passportExpiry: null,
      },
      category: baseCategory,
      pickupDate,
    });
    expect(r.failure?.code).toBe("NO_VALID_ID");
  });

  test("passport without number does not satisfy", () => {
    const r = checkEligibility({
      customer: {
        dateOfBirth: new Date("1990-01-01"),
        ...emptyLicence,
        passportNumber: null,
        passportExpiry: new Date("2032-01-01"),
      },
      category: baseCategory,
      pickupDate,
    });
    expect(r.failure?.code).toBe("NO_VALID_ID");
  });
});

describe("checkEligibility — image gate", () => {
  test("AU_LICENCE without licence image → MISSING_ID_IMAGE", () => {
    const r = checkEligibility({
      customer: {
        dateOfBirth: new Date("1990-01-01"),
        ...validLicence,
        ...emptyPassport,
        licenceType: "AU_LICENCE",
        licenceImageFront: null,
        passportImage: null,
      },
      category: baseCategory,
      pickupDate,
    });
    expect(r.failure?.code).toBe("MISSING_ID_IMAGE");
    expect(r.failure?.message).toContain("Australian driver's licence");
    expect(r.basis).toBe("none");
  });

  test("AU_LICENCE with licence image → eligible on licence basis", () => {
    const r = checkEligibility({
      customer: {
        dateOfBirth: new Date("1990-01-01"),
        ...validLicence,
        ...emptyPassport,
        licenceType: "AU_LICENCE",
        licenceImageFront: "drivers/u1/2026-04/licence-front.jpg",
        passportImage: null,
      },
      category: baseCategory,
      pickupDate,
    });
    expect(r.failure).toBeNull();
    expect(r.basis).toBe("licence");
  });

  test("INTERNATIONAL with neither image → MISSING_ID_IMAGE listing both", () => {
    const r = checkEligibility({
      customer: {
        dateOfBirth: new Date("1990-01-01"),
        ...validLicence,
        ...validPassport,
        licenceType: "INTERNATIONAL",
        licenceImageFront: null,
        passportImage: null,
      },
      category: baseCategory,
      pickupDate,
    });
    expect(r.failure?.code).toBe("MISSING_ID_IMAGE");
    expect(r.failure?.message).toContain("International Driver's Permit");
    expect(r.failure?.message).toContain("passport");
  });

  test("INTERNATIONAL with passport image but no IDP image → MISSING_ID_IMAGE listing IDP only", () => {
    const r = checkEligibility({
      customer: {
        dateOfBirth: new Date("1990-01-01"),
        ...validLicence,
        ...validPassport,
        licenceType: "INTERNATIONAL",
        licenceImageFront: null,
        passportImage: "drivers/u1/2026-04/passport.jpg",
      },
      category: baseCategory,
      pickupDate,
    });
    expect(r.failure?.code).toBe("MISSING_ID_IMAGE");
    expect(r.failure?.message).toContain("International Driver's Permit");
    expect(r.failure?.message).not.toContain("passport.");
  });

  test("INTERNATIONAL with IDP image but no passport image → MISSING_ID_IMAGE listing passport only", () => {
    const r = checkEligibility({
      customer: {
        dateOfBirth: new Date("1990-01-01"),
        ...validLicence,
        ...validPassport,
        licenceType: "INTERNATIONAL",
        licenceImageFront: "drivers/u1/2026-04/idp-front.jpg",
        passportImage: null,
      },
      category: baseCategory,
      pickupDate,
    });
    expect(r.failure?.code).toBe("MISSING_ID_IMAGE");
    expect(r.failure?.message).toContain("passport");
    expect(r.failure?.message).not.toContain("International Driver's Permit");
  });

  test("INTERNATIONAL with both images → eligible", () => {
    const r = checkEligibility({
      customer: {
        dateOfBirth: new Date("1990-01-01"),
        ...validLicence,
        ...validPassport,
        licenceType: "INTERNATIONAL",
        licenceImageFront: "drivers/u1/2026-04/idp-front.jpg",
        passportImage: "drivers/u1/2026-04/passport.jpg",
      },
      category: baseCategory,
      pickupDate,
    });
    expect(r.failure).toBeNull();
  });

  test("licenceType omitted (legacy / staff check-out) → image gate skipped", () => {
    const r = checkEligibility({
      customer: {
        dateOfBirth: new Date("1990-01-01"),
        ...validLicence,
        ...emptyPassport,
      },
      category: baseCategory,
      pickupDate,
    });
    expect(r.failure).toBeNull();
    expect(r.basis).toBe("licence");
  });

  test("licenceType=null + no images → image gate skipped (legacy passport-only path)", () => {
    const r = checkEligibility({
      customer: {
        dateOfBirth: new Date("1990-01-01"),
        ...emptyLicence,
        ...validPassport,
        licenceType: null,
        licenceImageFront: null,
        passportImage: null,
      },
      category: carCategory,
      pickupDate,
    });
    expect(r.failure).toBeNull();
    expect(r.basis).toBe("passport");
  });
});
