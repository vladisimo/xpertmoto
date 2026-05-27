import { describe, expect, test } from "vitest";
import {
  CUSTOMER_DIRECTORY_SQL_PREDICATE,
  canRentAsCustomer,
  customerDirectoryUserWhere,
} from "@/lib/customer-identity";
import { buildOnboardingVersion } from "@/lib/onboarding-status";

describe("customerDirectoryUserWhere", () => {
  test("matches any user with a CustomerProfile", () => {
    expect(customerDirectoryUserWhere()).toEqual({
      customerProfile: { isNot: null },
    });
  });
});

describe("CUSTOMER_DIRECTORY_SQL_PREDICATE", () => {
  test("mirrors the where clause against the cp alias", () => {
    expect(CUSTOMER_DIRECTORY_SQL_PREDICATE).toBe("cp.id IS NOT NULL");
  });
});

describe("canRentAsCustomer", () => {
  test("false when there is no profile", () => {
    expect(canRentAsCustomer(null)).toBe(false);
    expect(canRentAsCustomer(undefined)).toBe(false);
  });

  test("false for an un-onboarded (bare) profile", () => {
    expect(
      canRentAsCustomer({ onboardedAt: null, onboardingVersion: null }),
    ).toBe(false);
  });

  test("false when onboarded but on a stale consent version", () => {
    expect(
      canRentAsCustomer({ onboardedAt: new Date(), onboardingVersion: "stale" }),
    ).toBe(false);
  });

  test("true for a fully onboarded profile on the current version", () => {
    expect(
      canRentAsCustomer({
        onboardedAt: new Date(),
        onboardingVersion: buildOnboardingVersion(),
      }),
    ).toBe(true);
  });
});
