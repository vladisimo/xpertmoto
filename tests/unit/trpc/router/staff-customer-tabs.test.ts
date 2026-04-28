import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import {
  fillAcquisitionTrend,
  missingDocumentProfileFilter,
  momDelta,
  riskListProfileFilter,
  staffCustomerRouter,
  suppressionProfileFilter,
  verificationBucketProfileFilter,
} from "@/server/trpc/router/staff-customer";

const NOW = new Date("2026-04-19T00:00:00.000Z");

// ─── verificationBucketProfileFilter ────────────────────────────────────
describe("verificationBucketProfileFilter", () => {
  it("awaitingReview: requires no verification AND at least one image", () => {
    const f = verificationBucketProfileFilter("awaitingReview", NOW);
    expect(f.licenceVerifiedAt).toBeNull();
    expect(f.OR).toEqual([
      { licenceImageFront: { not: null } },
      { licenceImageBack: { not: null } },
    ]);
  });

  it("expiring: bounds licenceExpiry between now and now+30d (inclusive)", () => {
    const f = verificationBucketProfileFilter("expiring", NOW);
    const exp = f.licenceExpiry as { gte: Date; lte: Date };
    expect(exp.gte).toEqual(NOW);
    expect(exp.lte.getTime() - NOW.getTime()).toBe(30 * 86_400_000);
  });

  it("expired: licenceExpiry < now", () => {
    const f = verificationBucketProfileFilter("expired", NOW);
    expect(f.licenceExpiry).toEqual({ lt: NOW });
  });

  it("noImages: both image fields null (regardless of verification stamp)", () => {
    const f = verificationBucketProfileFilter("noImages", NOW);
    expect(f).toEqual({ licenceImageFront: null, licenceImageBack: null });
  });
});

// ─── missingDocumentProfileFilter ──────────────────────────────────────
describe("missingDocumentProfileFilter", () => {
  it("licenceImages → both image fields null", () => {
    expect(missingDocumentProfileFilter("licenceImages")).toEqual({
      licenceImageFront: null,
      licenceImageBack: null,
    });
  });

  it("signature → signatureImage null", () => {
    expect(missingDocumentProfileFilter("signature")).toEqual({ signatureImage: null });
  });

  it("emergency → both name and phone null", () => {
    expect(missingDocumentProfileFilter("emergency")).toEqual({
      emergencyContactName: null,
      emergencyContactPhone: null,
    });
  });

  it("address → addressLine1 OR postcode null (either gap counts)", () => {
    expect(missingDocumentProfileFilter("address")).toEqual({
      OR: [{ addressLine1: null }, { postcode: null }],
    });
  });

  it("terms → termsAcceptedAt null", () => {
    expect(missingDocumentProfileFilter("terms")).toEqual({ termsAcceptedAt: null });
  });
});

// ─── riskListProfileFilter ─────────────────────────────────────────────
describe("riskListProfileFilter", () => {
  it("empty input → empty filter (caller decides whether to apply it)", () => {
    expect(riskListProfileFilter({})).toEqual({});
  });

  it("rating + minIncidents compose", () => {
    expect(
      riskListProfileFilter({ rating: "HIGH", minIncidents: 2 }),
    ).toEqual({ riskRating: "HIGH", incidentCount: { gte: 2 } });
  });

  it("blacklisted: true → reason not null", () => {
    expect(riskListProfileFilter({ blacklisted: true })).toEqual({
      blacklistReason: { not: null },
    });
  });

  it("blacklisted: false → reason explicitly null", () => {
    expect(riskListProfileFilter({ blacklisted: false })).toEqual({
      blacklistReason: null,
    });
  });

  it("blacklisted undefined → no blacklistReason key (don't constrain)", () => {
    expect(riskListProfileFilter({ rating: "MEDIUM" })).not.toHaveProperty(
      "blacklistReason",
    );
  });
});

// ─── suppressionProfileFilter ──────────────────────────────────────────
describe("suppressionProfileFilter", () => {
  it("email → marketingEmailUnsubscribedAt set", () => {
    expect(suppressionProfileFilter("email")).toEqual({
      marketingEmailUnsubscribedAt: { not: null },
    });
  });

  it("sms → marketingSmsUnsubscribedAt set", () => {
    expect(suppressionProfileFilter("sms")).toEqual({
      marketingSmsUnsubscribedAt: { not: null },
    });
  });
});

// ─── fillAcquisitionTrend ──────────────────────────────────────────────
describe("fillAcquisitionTrend", () => {
  it("returns N consecutive ascending months from start", () => {
    const start = new Date(Date.UTC(2026, 0, 1));
    const result = fillAcquisitionTrend([], start, 3);
    expect(result.map((r) => r.month)).toEqual(["2026-01", "2026-02", "2026-03"]);
  });

  it("zero-fills months with no data", () => {
    const start = new Date(Date.UTC(2026, 0, 1));
    const rows = [{ month: new Date(Date.UTC(2026, 1, 1)), count: 5n }];
    const result = fillAcquisitionTrend(rows, start, 3);
    expect(result).toEqual([
      { month: "2026-01", count: 0 },
      { month: "2026-02", count: 5 },
      { month: "2026-03", count: 0 },
    ]);
  });

  it("accepts both bigint and number counts (postgres returns bigint)", () => {
    const start = new Date(Date.UTC(2026, 0, 1));
    const rows = [
      { month: new Date(Date.UTC(2026, 0, 1)), count: 10n },
      { month: new Date(Date.UTC(2026, 1, 1)), count: 20 },
    ];
    const result = fillAcquisitionTrend(rows, start, 2);
    expect(result.map((r) => r.count)).toEqual([10, 20]);
  });

  it("handles year boundary crossings", () => {
    const start = new Date(Date.UTC(2025, 10, 1));
    const result = fillAcquisitionTrend([], start, 3);
    expect(result.map((r) => r.month)).toEqual(["2025-11", "2025-12", "2026-01"]);
  });
});

// ─── momDelta ──────────────────────────────────────────────────────────
describe("momDelta", () => {
  it("returns positive delta when growing", () => {
    expect(momDelta(120, 100)).toBeCloseTo(0.2);
  });

  it("returns negative delta when shrinking", () => {
    expect(momDelta(80, 100)).toBeCloseTo(-0.2);
  });

  it("returns null when prior period is zero (avoids divide-by-zero)", () => {
    expect(momDelta(50, 0)).toBeNull();
  });

  it("returns null when prior period is negative (sanity guard)", () => {
    expect(momDelta(50, -1)).toBeNull();
  });
});

// ─── audit endpoint via createCaller ───────────────────────────────────

type Caller = ReturnType<typeof staffCustomerRouter.createCaller>;

function buildAuditCtx(
  customers: Array<{
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    profile: Partial<{
      licenceNumber: string | null;
      licenceExpiry: Date | null;
      licenceImageFront: string | null;
      licenceImageBack: string | null;
      licenceVerifiedAt: Date | null;
      passportExpiry: Date | null;
      emergencyContactName: string | null;
      emergencyContactPhone: string | null;
      termsAcceptedAt: Date | null;
      privacyAcceptedAt: Date | null;
      addressLine1: string | null;
      postcode: string | null;
      marketingOptIn: boolean;
      marketingSmsOptIn: boolean;
      marketingEmailUnsubscribedAt: Date | null;
      marketingSmsUnsubscribedAt: Date | null;
      notes: string | null;
      riskRating: "LOW" | "MEDIUM" | "HIGH";
      blacklistReason: string | null;
      lifetimePoints: number;
      referralCode: string | null;
      signatureImage: string | null;
      stripePaymentMethodExpMonth: number | null;
      stripePaymentMethodExpYear: number | null;
      incidentCount: number;
      totalBookings: number;
    }>;
    activeBookings?: number;
    emailVerified?: Date | null;
    dateOfBirth?: Date | null;
  }>,
) {
  const items = customers.map((c) => ({
    id: c.id,
    firstName: c.firstName,
    lastName: c.lastName,
    email: c.email,
    emailVerified: c.emailVerified ?? new Date("2025-01-01"),
    dateOfBirth: c.dateOfBirth ?? new Date("1990-05-12"),
    customerProfile: {
      licenceNumber: c.profile.licenceNumber ?? "QLD123456",
      licenceExpiry: c.profile.licenceExpiry ?? new Date("2030-12-01"),
      licenceImageFront: c.profile.licenceImageFront ?? "s3://front.jpg",
      licenceImageBack: c.profile.licenceImageBack ?? "s3://back.jpg",
      licenceVerifiedAt: c.profile.licenceVerifiedAt ?? new Date("2026-01-01"),
      passportExpiry: c.profile.passportExpiry ?? null,
      emergencyContactName: c.profile.emergencyContactName ?? "Sam",
      emergencyContactPhone: c.profile.emergencyContactPhone ?? "+61400000000",
      termsAcceptedAt: c.profile.termsAcceptedAt ?? new Date("2026-01-01"),
      privacyAcceptedAt: c.profile.privacyAcceptedAt ?? new Date("2026-01-01"),
      addressLine1: c.profile.addressLine1 ?? "12 Surf St",
      postcode: c.profile.postcode ?? "4217",
      marketingOptIn: c.profile.marketingOptIn ?? true,
      marketingSmsOptIn: c.profile.marketingSmsOptIn ?? false,
      marketingEmailUnsubscribedAt: c.profile.marketingEmailUnsubscribedAt ?? null,
      marketingSmsUnsubscribedAt: c.profile.marketingSmsUnsubscribedAt ?? null,
      notes: c.profile.notes ?? "regular",
      riskRating: c.profile.riskRating ?? "LOW",
      blacklistReason: c.profile.blacklistReason ?? null,
      lifetimePoints: c.profile.lifetimePoints ?? 100,
      referralCode: c.profile.referralCode ?? "REF-X1Y2",
      signatureImage: c.profile.signatureImage ?? "s3://sig.png",
      stripePaymentMethodExpMonth: c.profile.stripePaymentMethodExpMonth ?? null,
      stripePaymentMethodExpYear: c.profile.stripePaymentMethodExpYear ?? null,
      incidentCount: c.profile.incidentCount ?? 0,
      totalBookings: c.profile.totalBookings ?? 5,
    },
    _count: { bookings: c.activeBookings ?? 0 },
  }));

  const findMany = vi.fn().mockResolvedValue(items);

  return {
    findMany,
    ctx: {
      prisma: { user: { findMany } },
      user: { id: "staff1", role: "STAFF" as const },
      session: { user: { id: "staff1", role: "STAFF" } },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      reqId: "r1",
    } as unknown as Parameters<Caller["audit"]>[0],
  };
}

function caller(ctx: unknown): Caller {
  return staffCustomerRouter.createCaller(ctx as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("staffCustomer.audit (createCaller)", () => {
  it("returns empty summary + zero issues when every customer is clean", async () => {
    const { ctx } = buildAuditCtx([
      { id: "u1", firstName: "Ada", lastName: "Lovelace", email: "ada@example.com", profile: {} },
    ]);
    const result = await caller(ctx).audit();
    expect(result.summary).toEqual({
      totalActive: 1,
      customersWithIssues: 0,
      critical: 0,
      warning: 0,
      info: 0,
    });
    expect(result.issues).toEqual([]);
  });

  it("aggregates per-customer issues into the summary correctly", async () => {
    const { ctx } = buildAuditCtx([
      {
        id: "u1",
        firstName: "Bob",
        lastName: "Brown",
        email: "bob@example.com",
        profile: {
          // 1× warning — licence expired but not on hire
          licenceExpiry: new Date("2026-01-01"),
        },
      },
      {
        id: "u2",
        firstName: "Carol",
        lastName: "Cole",
        email: "carol@example.com",
        profile: {
          // 1× critical (BLACKLISTED_WITH_ACTIVE_RENTAL)
          blacklistReason: "fraud",
        },
        activeBookings: 1,
      },
    ]);
    const result = await caller(ctx).audit();
    expect(result.summary.totalActive).toBe(2);
    expect(result.summary.customersWithIssues).toBe(2);
    expect(result.summary.critical).toBeGreaterThanOrEqual(1);
    expect(result.summary.warning).toBeGreaterThanOrEqual(1);
    const bobIssues = result.issues.filter((i) => i.customerId === "u1");
    const carolIssues = result.issues.filter((i) => i.customerId === "u2");
    expect(bobIssues.some((i) => i.checkKey === "LICENCE_EXPIRED")).toBe(true);
    expect(carolIssues.some((i) => i.checkKey === "BLACKLISTED_WITH_ACTIVE_RENTAL")).toBe(
      true,
    );
  });

  it("severity filter narrows both the issue list AND the per-severity counts", async () => {
    // Mirrors fleet audit semantics: the summary is computed from the
    // post-filter rows, so the operator's filter selection is reflected
    // in the KPI tiles too. `customersWithIssues` (population-level) is
    // still based on the unfiltered evaluation.
    const { ctx } = buildAuditCtx([
      {
        id: "u1",
        firstName: "D",
        lastName: "D",
        email: "d@e.com",
        profile: {
          // produces a "warning" (LICENCE_EXPIRED) AND an "info" (NO_LOYALTY_POINTS_BUT_HAS_BOOKINGS)
          licenceExpiry: new Date("2026-01-01"),
          lifetimePoints: 0,
          totalBookings: 3,
        },
      },
    ]);
    const result = await caller(ctx).audit({ severity: "info" });
    expect(result.issues.every((i) => i.severity === "info")).toBe(true);
    expect(result.summary.warning).toBe(0);
    expect(result.summary.info).toBeGreaterThanOrEqual(1);
    // population-level count stays population-level
    expect(result.summary.customersWithIssues).toBe(1);
  });

  it("includeAll: false (default) constrains the user query to engaged customers", async () => {
    const { ctx, findMany } = buildAuditCtx([]);
    await caller(ctx).audit();
    const where = findMany.mock.calls[0]![0]!.where;
    expect(where.OR).toBeDefined();
    expect(where.OR).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ customerProfile: expect.anything() }),
        expect.objectContaining({ bookings: expect.anything() }),
      ]),
    );
  });

  it("includeAll: true drops the engagement scope", async () => {
    const { ctx, findMany } = buildAuditCtx([]);
    await caller(ctx).audit({ includeAll: true });
    const where = findMany.mock.calls[0]![0]!.where;
    expect(where.OR).toBeUndefined();
  });
});

// ─── mutations: setBlacklist + bulkSetRiskRating ───────────────────────

function buildMutationCtx() {
  const update = vi.fn().mockResolvedValue({});
  const updateMany = vi.fn().mockResolvedValue({ count: 3 });

  return {
    update,
    updateMany,
    ctx: {
      prisma: {
        customerProfile: { update, updateMany },
      },
      user: { id: "staff1", role: "STAFF" as const },
      session: { user: { id: "staff1", role: "STAFF" } },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      reqId: "r1",
    } as unknown as Parameters<Caller["setBlacklist"]>[0],
  };
}

describe("staffCustomer.setBlacklist (createCaller)", () => {
  it("sets a non-empty reason on the customer profile", async () => {
    const { ctx, update } = buildMutationCtx();
    const result = await caller(ctx).setBlacklist({
      customerId: "u1",
      reason: "fraudulent payment",
    });
    expect(result).toEqual({ ok: true });
    expect(update).toHaveBeenCalledWith({
      where: { userId: "u1" },
      data: { blacklistReason: "fraudulent payment" },
    });
  });

  it("clears the blacklist when reason is null", async () => {
    const { ctx, update } = buildMutationCtx();
    await caller(ctx).setBlacklist({ customerId: "u1", reason: null });
    expect(update).toHaveBeenCalledWith({
      where: { userId: "u1" },
      data: { blacklistReason: null },
    });
  });

  it("rejects an empty-string reason via Zod (avoid silent invalid blacklist)", async () => {
    const { ctx } = buildMutationCtx();
    await expect(
      caller(ctx).setBlacklist({ customerId: "u1", reason: "" }),
    ).rejects.toBeInstanceOf(TRPCError);
  });
});

describe("staffCustomer.expiringDocuments (createCaller)", () => {
  function buildCtx(opts: {
    profileLicence?: { id: string; date: Date }[];
    profilePassport?: { id: string; date: Date }[];
    documents?: { id: string; type: string; date: Date }[];
  }) {
    const profileFindMany = vi
      .fn()
      .mockImplementationOnce(async () =>
        (opts.profileLicence ?? []).map((p) => ({
          licenceExpiry: p.date,
          user: { id: p.id, firstName: "P", lastName: p.id, email: `${p.id}@e.com` },
        })),
      )
      .mockImplementationOnce(async () =>
        (opts.profilePassport ?? []).map((p) => ({
          passportExpiry: p.date,
          user: { id: p.id, firstName: "P", lastName: p.id, email: `${p.id}@e.com` },
        })),
      );
    const documentFindMany = vi.fn().mockResolvedValue(
      (opts.documents ?? []).map((d) => ({
        type: d.type,
        label: null,
        expiryDate: d.date,
        customer: { id: d.id, firstName: "D", lastName: d.id, email: `${d.id}@e.com` },
      })),
    );

    return {
      profileFindMany,
      documentFindMany,
      ctx: {
        prisma: {
          customerProfile: { findMany: profileFindMany },
          customerDocument: { findMany: documentFindMany },
        },
        user: { id: "staff1", role: "STAFF" as const },
        session: { user: { id: "staff1", role: "STAFF" } },
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        reqId: "r1",
      } as unknown as Parameters<Caller["expiringDocuments"]>[0],
    };
  }

  it("merges inline-profile expiries with CustomerDocument rows, soonest-first", async () => {
    const fiveDays = new Date(Date.now() + 5 * 86_400_000);
    const fortyDays = new Date(Date.now() + 40 * 86_400_000);
    const tenDays = new Date(Date.now() + 10 * 86_400_000);
    const { ctx } = buildCtx({
      profileLicence: [{ id: "u1", date: fortyDays }],
      profilePassport: [{ id: "u2", date: tenDays }],
      documents: [{ id: "u3", type: "VISA", date: fiveDays }],
    });
    const result = await caller(ctx).expiringDocuments({
      kind: "all",
      windowDays: 60,
      page: 1,
      pageSize: 25,
    });
    expect(result.totalCount).toBe(3);
    // soonest-first
    expect(result.items.map((i) => i.customerId)).toEqual(["u3", "u2", "u1"]);
    // attribution
    expect(result.items[0]!.source).toBe("document");
    expect(result.items[1]!.source).toBe("profile");
    expect(result.items[1]!.documentType).toBe("PASSPORT");
  });

  it("kind=licence skips passport queries (avoids unnecessary work)", async () => {
    const { ctx, profileFindMany, documentFindMany } = buildCtx({});
    await caller(ctx).expiringDocuments({
      kind: "licence",
      windowDays: 30,
      page: 1,
      pageSize: 25,
    });
    // Only the licence profile query runs — passport call is skipped
    expect(profileFindMany).toHaveBeenCalledTimes(1);
    // CustomerDocument query runs with a type-filter, not a global query
    const docCall = documentFindMany.mock.calls[0]![0]!.where;
    expect(docCall.type).toBeDefined();
    expect(docCall.type.in).toContain("LICENCE_FRONT");
    expect(docCall.type.in).not.toContain("PASSPORT");
  });

  it("paginates the merged set client-side without reissuing Prisma queries", async () => {
    const dates = Array.from({ length: 30 }, (_, i) => new Date(Date.now() + i * 86_400_000));
    const { ctx, profileFindMany } = buildCtx({
      profileLicence: dates.map((d, i) => ({ id: `u${i}`, date: d })),
    });
    const page2 = await caller(ctx).expiringDocuments({
      kind: "licence",
      windowDays: 60,
      page: 2,
      pageSize: 10,
    });
    expect(page2.totalCount).toBe(30);
    expect(page2.pageCount).toBe(3);
    expect(page2.items).toHaveLength(10);
    // sorted by daysUntil → page 2 should be the middle 10 (10..19)
    expect(page2.items[0]!.customerId).toBe("u10");
    // Single licence-profile query — pagination doesn't refetch
    expect(profileFindMany).toHaveBeenCalledTimes(1);
  });
});

describe("staffCustomer.referralLeaderboard (createCaller)", () => {
  function buildCtx(opts: {
    grouped?: { referrerId: string; total: number }[];
    qualified?: { referrerId: string; count: number }[];
    pending?: { referrerId: string; count: number }[];
    users?: { id: string; firstName: string; lastName: string; email: string; credit: number }[];
  }) {
    const groupBy = vi
      .fn()
      // 1st call: total counts (used to pick referrerIds)
      .mockImplementationOnce(async () =>
        (opts.grouped ?? []).map((g) => ({
          referrerId: g.referrerId,
          _count: { _all: g.total },
        })),
      )
      // 2nd: qualified counts
      .mockImplementationOnce(async () =>
        (opts.qualified ?? []).map((g) => ({
          referrerId: g.referrerId,
          _count: { _all: g.count },
        })),
      )
      // 3rd: pending counts
      .mockImplementationOnce(async () =>
        (opts.pending ?? []).map((g) => ({
          referrerId: g.referrerId,
          _count: { _all: g.count },
        })),
      );
    const findMany = vi.fn().mockResolvedValue(
      (opts.users ?? []).map((u) => ({
        id: u.id,
        firstName: u.firstName,
        lastName: u.lastName,
        email: u.email,
        customerProfile: { referralCreditBalance: { toNumber: () => u.credit } },
      })),
    );
    return {
      groupBy,
      findMany,
      ctx: {
        prisma: {
          referral: { groupBy },
          user: { findMany },
        },
        user: { id: "staff1", role: "STAFF" as const },
        session: { user: { id: "staff1", role: "STAFF" } },
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        reqId: "r1",
      } as unknown as Parameters<Caller["referralLeaderboard"]>[0],
    };
  }

  it("returns empty array when no referrals exist (avoids zero-id IN query)", async () => {
    const { ctx, findMany } = buildCtx({});
    const result = await caller(ctx).referralLeaderboard({ take: 25 });
    expect(result).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("ranks by qualified count desc and joins user + credit balance", async () => {
    const { ctx } = buildCtx({
      grouped: [
        { referrerId: "u1", total: 10 },
        { referrerId: "u2", total: 8 },
      ],
      qualified: [
        { referrerId: "u1", count: 4 },
        { referrerId: "u2", count: 7 },
      ],
      pending: [
        { referrerId: "u1", count: 6 },
        { referrerId: "u2", count: 1 },
      ],
      users: [
        { id: "u1", firstName: "Ada", lastName: "L", email: "ada@e.com", credit: 25 },
        { id: "u2", firstName: "Ben", lastName: "K", email: "ben@e.com", credit: 100 },
      ],
    });
    const result = await caller(ctx).referralLeaderboard({ take: 25 });
    // Ben has more qualified referrals → ranks first
    expect(result.map((r) => r.id)).toEqual(["u2", "u1"]);
    expect(result[0]).toMatchObject({
      qualifiedCount: 7,
      pendingCount: 1,
      creditBalance: 100,
    });
  });
});

describe("staffCustomer.bulkSetRiskRating (createCaller)", () => {
  it("updates many customers and returns the count from Prisma", async () => {
    const { ctx, updateMany } = buildMutationCtx();
    const result = await caller(ctx).bulkSetRiskRating({
      customerIds: ["u1", "u2", "u3"],
      riskRating: "HIGH",
    });
    expect(result).toEqual({ updated: 3 });
    expect(updateMany).toHaveBeenCalledWith({
      where: { userId: { in: ["u1", "u2", "u3"] } },
      data: { riskRating: "HIGH" },
    });
  });

  it("rejects an empty selection via Zod (no implicit fleet-wide updates)", async () => {
    const { ctx } = buildMutationCtx();
    await expect(
      caller(ctx).bulkSetRiskRating({ customerIds: [], riskRating: "LOW" }),
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it("rejects an invalid rating value via Zod", async () => {
    const { ctx } = buildMutationCtx();
    await expect(
      // @ts-expect-error — exercising runtime Zod rejection
      caller(ctx).bulkSetRiskRating({ customerIds: ["u1"], riskRating: "EXTREME" }),
    ).rejects.toBeInstanceOf(TRPCError);
  });
});

// ─── billingSummary (createCaller) ─────────────────────────────────────

type BookingRow = {
  id: string;
  bookingReference: string;
  status: string;
  pickupDateTime: Date;
  returnDateTime: Date;
  actualReturnDateTime: Date | null;
  totalAmount: { toNumber: () => number };
  amountPaid: { toNumber: () => number };
  balanceDue: { toNumber: () => number };
  overdueStage: number;
  extensionOfId: string | null;
  vehicle: { id: string; make: string; model: string; rego: string } | null;
  extensionOf: { id: string; bookingReference: string } | null;
  extensions: Array<{
    id: string;
    bookingReference: string;
    totalAmount: { toNumber: () => number };
    pickupDateTime: Date;
    returnDateTime: Date;
  }>;
};

function dec(n: number) {
  return { toNumber: () => n };
}

function makeBooking(overrides: Partial<BookingRow> = {}): BookingRow {
  return {
    id: "b1",
    bookingReference: "SCT-20260101-0001",
    status: "COMPLETED",
    pickupDateTime: new Date("2026-01-01"),
    returnDateTime: new Date("2026-01-03"),
    actualReturnDateTime: new Date("2026-01-03"),
    totalAmount: dec(200),
    amountPaid: dec(200),
    balanceDue: dec(0),
    overdueStage: 0,
    extensionOfId: null,
    vehicle: { id: "v1", make: "Honda", model: "PCX", rego: "123-AB4" },
    extensionOf: null,
    extensions: [],
    ...overrides,
  };
}

function buildBillingCtx(opts: {
  bookings?: BookingRow[];
  payments?: Array<{
    id: string;
    reference: string;
    type: string;
    method: string;
    status: string;
    amount: { toNumber: () => number };
    gstAmount: { toNumber: () => number };
    createdAt: Date;
    booking: { bookingReference: string } | null;
  }>;
}) {
  const bookingFindMany = vi.fn().mockResolvedValue(opts.bookings ?? []);
  const paymentFindMany = vi.fn().mockResolvedValue(opts.payments ?? []);

  return {
    bookingFindMany,
    paymentFindMany,
    ctx: {
      prisma: {
        booking: { findMany: bookingFindMany },
        payment: { findMany: paymentFindMany },
      },
      user: { id: "staff1", role: "STAFF" as const },
      session: { user: { id: "staff1", role: "STAFF" } },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      reqId: "r1",
    } as unknown as Parameters<Caller["billingSummary"]>[0],
  };
}

describe("staffCustomer.billingSummary (createCaller)", () => {
  it("returns zeros and empty arrays when the customer has no bookings or payments", async () => {
    const { ctx } = buildBillingCtx({});
    const result = await caller(ctx).billingSummary({ customerId: "u1" });
    expect(result.summary).toEqual({
      lifetimeSpend: 0,
      totalOutstanding: 0,
      activeRentalCount: 0,
      overdueCount: 0,
      overdueBalance: 0,
    });
    expect(result.bookings).toEqual([]);
    expect(result.transactions).toEqual([]);
  });

  it("excludes QUOTE / CANCELLED / NO_SHOW from totalOutstanding but keeps them in bookings[]", async () => {
    const { ctx } = buildBillingCtx({
      bookings: [
        makeBooking({ id: "b1", status: "QUOTE", amountPaid: dec(0), balanceDue: dec(150) }),
        makeBooking({ id: "b2", status: "CANCELLED", amountPaid: dec(100), balanceDue: dec(50) }),
        makeBooking({ id: "b3", status: "ACTIVE", amountPaid: dec(100), balanceDue: dec(100) }),
      ],
    });
    const result = await caller(ctx).billingSummary({ customerId: "u1" });
    // Only the ACTIVE booking's balance contributes.
    expect(result.summary.totalOutstanding).toBe(100);
    expect(result.summary.activeRentalCount).toBe(1);
    // But all three are returned for the table.
    expect(result.bookings).toHaveLength(3);
  });

  it("counts OVERDUE bookings and aggregates overdueBalance separately", async () => {
    const { ctx } = buildBillingCtx({
      bookings: [
        makeBooking({
          id: "b1",
          status: "OVERDUE",
          amountPaid: dec(50),
          balanceDue: dec(250),
          overdueStage: 3,
        }),
        makeBooking({
          id: "b2",
          status: "OVERDUE",
          amountPaid: dec(0),
          balanceDue: dec(80),
          overdueStage: 1,
        }),
        makeBooking({ id: "b3", status: "COMPLETED", amountPaid: dec(300), balanceDue: dec(0) }),
      ],
    });
    const result = await caller(ctx).billingSummary({ customerId: "u1" });
    expect(result.summary.overdueCount).toBe(2);
    expect(result.summary.overdueBalance).toBe(330);
    // lifetimeSpend sums amountPaid across all bookings
    expect(result.summary.lifetimeSpend).toBe(350);
    // OVERDUE balances DO contribute to totalOutstanding (not excluded)
    expect(result.summary.totalOutstanding).toBe(330);
  });

  it("normalises every Decimal field to number at the API boundary", async () => {
    const { ctx } = buildBillingCtx({
      bookings: [
        makeBooking({
          id: "b1",
          totalAmount: dec(199.95),
          amountPaid: dec(99.5),
          balanceDue: dec(100.45),
          extensions: [
            {
              id: "e1",
              bookingReference: "SCT-EXT",
              totalAmount: dec(49.99),
              pickupDateTime: new Date("2026-02-01"),
              returnDateTime: new Date("2026-02-02"),
            },
          ],
        }),
      ],
      payments: [
        {
          id: "p1",
          reference: "PAY-001",
          type: "BOOKING_PAYMENT",
          method: "CARD",
          status: "SUCCEEDED",
          amount: dec(99.5),
          gstAmount: dec(9.05),
          createdAt: new Date("2026-02-01"),
          booking: { bookingReference: "SCT-20260101-0001" },
        },
      ],
    });
    const result = await caller(ctx).billingSummary({ customerId: "u1" });
    const b = result.bookings[0]!;
    expect(typeof b.totalAmount).toBe("number");
    expect(typeof b.amountPaid).toBe("number");
    expect(typeof b.balanceDue).toBe("number");
    expect(typeof b.extensions[0]!.totalAmount).toBe("number");
    const t = result.transactions[0]!;
    expect(typeof t.amount).toBe("number");
    expect(typeof t.gstAmount).toBe("number");
    expect(t.amount).toBe(99.5);
  });
});
