import { describe, expect, test } from "vitest";
import {
  evaluateVehicleAudit,
  type AuditCheckKey,
  type AuditVehicleInput,
} from "@/server/services/fleet-audit";

const NOW = new Date("2026-04-19T00:00:00.000Z");

function daysFromNow(days: number): Date {
  return new Date(NOW.getTime() + days * 86_400_000);
}

/** A fully-populated, compliant vehicle. Overrides customise individual fields. */
function makeVehicle(overrides: Partial<AuditVehicleInput> = {}): AuditVehicleInput {
  return {
    rego: "123-AB4",
    regoState: "QLD",
    regoExpiry: daysFromNow(200),
    ctpExpiry: daysFromNow(200),
    insuranceExpiry: daysFromNow(200),
    insurancePolicyNumber: "POL-1234",
    vin: "VIN123456789",
    engineNumber: "ENG987654",
    currentOdometerKm: 5000,
    lastServiceDate: daysFromNow(-60),
    nextServiceDueDate: daysFromNow(120),
    nextServiceDueKm: 10_000,
    warrantyExpiry: daysFromNow(400),
    ...overrides,
  };
}

function keys(v: AuditVehicleInput): AuditCheckKey[] {
  return evaluateVehicleAudit(v, NOW).map((i) => i.checkKey);
}

describe("evaluateVehicleAudit", () => {
  test("fully-populated compliant vehicle has no issues", () => {
    expect(keys(makeVehicle())).toEqual([]);
  });

  test("flags REGO_EXPIRED when regoExpiry is in the past", () => {
    const v = makeVehicle({ regoExpiry: daysFromNow(-5) });
    expect(keys(v)).toContain("REGO_EXPIRED");
    expect(keys(v)).not.toContain("REGO_EXPIRING_SOON");
  });

  test("flags REGO_EXPIRING_SOON within 30-day window", () => {
    const v = makeVehicle({ regoExpiry: daysFromNow(20) });
    expect(keys(v)).toContain("REGO_EXPIRING_SOON");
    expect(keys(v)).not.toContain("REGO_EXPIRED");
  });

  test("flags CTP_EXPIRED + INSURANCE_EXPIRED independently", () => {
    const v = makeVehicle({
      ctpExpiry: daysFromNow(-1),
      insuranceExpiry: daysFromNow(-365),
    });
    const ks = keys(v);
    expect(ks).toContain("CTP_EXPIRED");
    expect(ks).toContain("INSURANCE_EXPIRED");
  });

  test("flags MISSING_REGO when rego or regoState is blank", () => {
    expect(keys(makeVehicle({ rego: "" }))).toContain("MISSING_REGO");
    expect(keys(makeVehicle({ regoState: null }))).toContain("MISSING_REGO");
  });

  test("flags MISSING_REGO_EXPIRY / CTP_EXPIRY / INSURANCE_EXPIRY when dates are null", () => {
    const v = makeVehicle({ regoExpiry: null, ctpExpiry: null, insuranceExpiry: null });
    const ks = keys(v);
    expect(ks).toContain("MISSING_REGO_EXPIRY");
    expect(ks).toContain("MISSING_CTP_EXPIRY");
    expect(ks).toContain("MISSING_INSURANCE_EXPIRY");
  });

  test("flags MISSING_INSURANCE_POLICY only when expiry is set but policy # is blank", () => {
    const withExpiryOnly = makeVehicle({ insurancePolicyNumber: "" });
    expect(keys(withExpiryOnly)).toContain("MISSING_INSURANCE_POLICY");

    // no expiry → MISSING_INSURANCE_EXPIRY fires, but MISSING_INSURANCE_POLICY does not
    // since we can't tell whether a policy is required yet.
    const noExpiry = makeVehicle({ insuranceExpiry: null, insurancePolicyNumber: "" });
    expect(keys(noExpiry)).not.toContain("MISSING_INSURANCE_POLICY");
  });

  test("flags SERVICE_OVERDUE_DATE when nextServiceDueDate is past", () => {
    const v = makeVehicle({ nextServiceDueDate: daysFromNow(-1) });
    expect(keys(v)).toContain("SERVICE_OVERDUE_DATE");
  });

  test("flags SERVICE_OVERDUE_KM when odometer meets or exceeds nextServiceDueKm", () => {
    expect(
      keys(makeVehicle({ currentOdometerKm: 10_000, nextServiceDueKm: 10_000 })),
    ).toContain("SERVICE_OVERDUE_KM");
    expect(
      keys(makeVehicle({ currentOdometerKm: 9_500, nextServiceDueKm: 10_000 })),
    ).not.toContain("SERVICE_OVERDUE_KM");
  });

  test("flags MISSING_NEXT_SERVICE only when both date and km are null", () => {
    expect(
      keys(makeVehicle({ nextServiceDueDate: null, nextServiceDueKm: null })),
    ).toContain("MISSING_NEXT_SERVICE");
    expect(
      keys(makeVehicle({ nextServiceDueDate: null, nextServiceDueKm: 10_000 })),
    ).not.toContain("MISSING_NEXT_SERVICE");
  });

  test("flags WARRANTY_EXPIRED but not when warranty is absent", () => {
    expect(keys(makeVehicle({ warrantyExpiry: daysFromNow(-10) }))).toContain("WARRANTY_EXPIRED");
    expect(keys(makeVehicle({ warrantyExpiry: null }))).not.toContain("WARRANTY_EXPIRED");
  });

  test("flags data-quality info issues", () => {
    const v = makeVehicle({
      vin: null,
      engineNumber: "",
      currentOdometerKm: 0,
      lastServiceDate: null,
    });
    const ks = keys(v);
    expect(ks).toContain("MISSING_VIN");
    expect(ks).toContain("MISSING_ENGINE_NUMBER");
    expect(ks).toContain("MISSING_ODOMETER");
    expect(ks).toContain("NO_LAST_SERVICE");
  });

  test("issue carries daysDelta for expiry-based checks", () => {
    const v = makeVehicle({ regoExpiry: daysFromNow(-3) });
    const issue = evaluateVehicleAudit(v, NOW).find((i) => i.checkKey === "REGO_EXPIRED");
    expect(issue?.daysDelta).toBe(-3);
    expect(issue?.detectedAt).toBeTypeOf("string");
  });

  test("worst-case vehicle surfaces every expected check", () => {
    const v: AuditVehicleInput = {
      rego: "",
      regoState: "",
      regoExpiry: null,
      ctpExpiry: null,
      insuranceExpiry: null,
      insurancePolicyNumber: null,
      vin: null,
      engineNumber: null,
      currentOdometerKm: 0,
      lastServiceDate: null,
      nextServiceDueDate: null,
      nextServiceDueKm: null,
      warrantyExpiry: daysFromNow(-1),
    };
    const expected: AuditCheckKey[] = [
      "MISSING_REGO",
      "MISSING_REGO_EXPIRY",
      "MISSING_CTP_EXPIRY",
      "MISSING_INSURANCE_EXPIRY",
      "WARRANTY_EXPIRED",
      "MISSING_NEXT_SERVICE",
      "MISSING_VIN",
      "MISSING_ENGINE_NUMBER",
      "MISSING_ODOMETER",
      "NO_LAST_SERVICE",
    ];
    expect(new Set(keys(v))).toEqual(new Set(expected));
  });
});
