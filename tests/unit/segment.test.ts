import { describe, expect, test } from "vitest";

import { segmentFiltersSchema } from "../../src/lib/validators/segment";
import { buildSegmentWhere } from "../../src/server/services/segment-evaluator";

describe("segmentFiltersSchema", () => {
  test("accepts a single state filter", () => {
    const parsed = segmentFiltersSchema.parse({
      combinator: "AND",
      filters: [{ dimension: "STATE", states: ["VIC", "NSW"] }],
    });
    expect(parsed.filters.length).toBe(1);
  });

  test("rejects invalid state code", () => {
    expect(() =>
      segmentFiltersSchema.parse({
        combinator: "AND",
        filters: [{ dimension: "STATE", states: ["XX"] }],
      }),
    ).toThrow();
  });

  test("rejects empty filters", () => {
    expect(() => segmentFiltersSchema.parse({ combinator: "AND", filters: [] })).toThrow();
  });

  test("accepts age range", () => {
    const parsed = segmentFiltersSchema.parse({
      combinator: "AND",
      filters: [{ dimension: "AGE_RANGE", min: 18, max: 40 }],
    });
    expect(parsed.filters[0]?.dimension).toBe("AGE_RANGE");
  });

  test("accepts last rented within", () => {
    const parsed = segmentFiltersSchema.parse({
      combinator: "AND",
      filters: [{ dimension: "LAST_RENTED_WITHIN", days: 90 }],
    });
    expect(parsed.filters[0]).toMatchObject({ dimension: "LAST_RENTED_WITHIN", days: 90 });
  });

  test("combines multiple filters", () => {
    const parsed = segmentFiltersSchema.parse({
      combinator: "AND",
      filters: [
        { dimension: "STATE", states: ["QLD"] },
        { dimension: "TOTAL_SPEND_MIN", amount: 500 },
        { dimension: "LAST_RENTED_WITHIN", days: 180 },
      ],
    });
    expect(parsed.filters.length).toBe(3);
  });
});

describe("buildSegmentWhere", () => {
  test("produces an AND root with the base customer clause", () => {
    const where = buildSegmentWhere({
      combinator: "AND",
      filters: [{ dimension: "STATE", states: ["VIC"] }],
    });
    expect(where.AND).toBeInstanceOf(Array);
    const [base] = where.AND as [{ role: unknown; deletedAt: unknown }];
    expect(base.role).toBe("CUSTOMER");
    expect(base.deletedAt).toBeNull();
  });

  test("state filter maps to customerProfile.state.in", () => {
    const where = buildSegmentWhere({
      combinator: "AND",
      filters: [{ dimension: "STATE", states: ["VIC", "NSW"] }],
    });
    const clauses = where.AND as Array<Record<string, unknown>>;
    const stateClause = clauses[1] as { customerProfile?: { state?: { in?: string[] } } };
    expect(stateClause.customerProfile?.state?.in).toEqual(["VIC", "NSW"]);
  });

  test("total-spend-min filter maps to gte", () => {
    const where = buildSegmentWhere({
      combinator: "AND",
      filters: [{ dimension: "TOTAL_SPEND_MIN", amount: 250.5 }],
    });
    const clauses = where.AND as Array<Record<string, unknown>>;
    const spendClause = clauses[1] as {
      customerProfile?: { totalSpend?: { gte?: number } };
    };
    expect(spendClause.customerProfile?.totalSpend?.gte).toBe(250.5);
  });

  test("never-rented maps to bookings.none", () => {
    const where = buildSegmentWhere({
      combinator: "AND",
      filters: [{ dimension: "NEVER_RENTED" }],
    });
    const clauses = where.AND as Array<Record<string, unknown>>;
    const neverClause = clauses[1] as { bookings?: { none?: Record<string, unknown> } };
    expect(neverClause.bookings?.none).toBeDefined();
  });

  test("age range translates min age to dob upper bound", () => {
    const where = buildSegmentWhere({
      combinator: "AND",
      filters: [{ dimension: "AGE_RANGE", min: 25, max: 40 }],
    });
    const clauses = where.AND as Array<Record<string, unknown>>;
    const ageClause = clauses[1] as { dateOfBirth?: { lte?: Date; gte?: Date } };
    expect(ageClause.dateOfBirth?.lte).toBeInstanceOf(Date);
    expect(ageClause.dateOfBirth?.gte).toBeInstanceOf(Date);
    expect(ageClause.dateOfBirth!.lte!.getTime()).toBeGreaterThan(
      ageClause.dateOfBirth!.gte!.getTime(),
    );
  });

  test("marketing email opt-in=true also excludes unsubscribed", () => {
    const where = buildSegmentWhere({
      combinator: "AND",
      filters: [{ dimension: "MARKETING_EMAIL_OPT_IN", value: true }],
    });
    const clauses = where.AND as Array<Record<string, unknown>>;
    const cp = (clauses[1] as { customerProfile?: Record<string, unknown> }).customerProfile;
    expect(cp?.marketingOptIn).toBe(true);
    expect(cp?.marketingEmailUnsubscribedAt).toBeNull();
  });
});
