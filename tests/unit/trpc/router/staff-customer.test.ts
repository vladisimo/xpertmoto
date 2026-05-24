import { describe, expect, test } from "vitest";
import { buildCustomerListWhere } from "@/server/trpc/router/staff-customer";

const NOW = new Date("2026-04-17T00:00:00.000Z");

describe("buildCustomerListWhere", () => {
  test("always constrains to users with a CustomerProfile (profile-based, not role)", () => {
    const w = buildCustomerListWhere({ status: "ALL" }, NOW);
    // Membership is held in AND so status facets can still set customerProfile.
    expect(w.AND).toEqual([{ customerProfile: { isNot: null } }]);
    expect(w.role).toBeUndefined();
    expect(w.OR).toBeUndefined();
    expect(w.bookings).toBeUndefined();
  });

  test("search applies OR on email/firstName/lastName/phone", () => {
    const w = buildCustomerListWhere({ status: "ALL", search: "henry" }, NOW);
    expect(w.OR).toHaveLength(4);
    const fields = (w.OR as Array<Record<string, unknown>>).map((o) => Object.keys(o)[0]);
    expect(fields.sort()).toEqual(["email", "firstName", "lastName", "phone"]);
  });

  test("PENDING_HIRE includes upcoming + in-progress booking statuses", () => {
    const w = buildCustomerListWhere({ status: "PENDING_HIRE" }, NOW);
    const statuses = (w.bookings as { some: { status: { in: string[] } } }).some.status.in;
    expect(statuses).toEqual([
      "PENDING_PAYMENT",
      "CONFIRMED",
      "CHECKED_OUT",
      "ACTIVE",
      "OVERDUE",
    ]);
  });

  test("ACTIVE_RENTAL restricts to actively-out bookings only", () => {
    const w = buildCustomerListWhere({ status: "ACTIVE_RENTAL" }, NOW);
    const statuses = (w.bookings as { some: { status: { in: string[] } } }).some.status.in;
    expect(statuses).toEqual(["CHECKED_OUT", "ACTIVE", "OVERDUE"]);
  });

  test("UNVERIFIED filters on licenceVerifiedAt IS NULL", () => {
    const w = buildCustomerListWhere({ status: "UNVERIFIED" }, NOW);
    expect(w.customerProfile).toEqual({ licenceVerifiedAt: null });
  });

  test("LICENCE_EXPIRED uses now for the cutoff", () => {
    const w = buildCustomerListWhere({ status: "LICENCE_EXPIRED" }, NOW);
    expect(w.customerProfile).toEqual({ licenceExpiry: { lt: NOW } });
  });

  test("HIGH_RISK filters riskRating", () => {
    const w = buildCustomerListWhere({ status: "HIGH_RISK" }, NOW);
    expect(w.customerProfile).toEqual({ riskRating: "HIGH" });
  });

  test("SUSPENDED filters user.status", () => {
    const w = buildCustomerListWhere({ status: "SUSPENDED" }, NOW);
    expect(w.status).toBe("SUSPENDED");
  });

  test("search + status compose (search OR clause plus booking filter)", () => {
    const w = buildCustomerListWhere({ status: "PENDING_HIRE", search: "lee" }, NOW);
    expect(w.OR).toHaveLength(4);
    expect(w.bookings).toBeDefined();
  });
});
