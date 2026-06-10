import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { bookingSwapRouter } from "../../../../src/server/trpc/router/booking-swap";

// Focus: the guard logic of the bookingSwap router. The full transactional
// happy-path (Stripe + PDF + notification) is covered by the Playwright spec;
// here we verify the procedural checks that keep state consistent.

function makeCtx(
  opts: {
    userId?: string;
    role?: "STAFF" | "MANAGER" | "ADMIN" | "SUPER_ADMIN";
    booking?: {
      id: string;
      status: string;
      vehicleId: string | null;
      categoryId: string;
      customerId: string;
      returnDateTime?: Date;
    } | null;
    existingDraft?: unknown;
    candidateVehicles?: Array<Record<string, unknown>>;
  } = {},
) {
  const booking = opts.booking ?? {
    id: "b1",
    status: "ACTIVE",
    vehicleId: "v-old",
    categoryId: "cat-A",
    customerId: "cust1",
    returnDateTime: new Date(Date.now() + 30 * 86_400_000), // 30 days out — must stay after swapAt (now)
  };
  const prisma = {
    booking: {
      findUniqueOrThrow: vi.fn(async () => booking),
      findUnique: vi.fn(async () => booking),
      // isVehicleFree clash search — no clashing booking → vehicle is free.
      findFirst: vi.fn(async () => null),
    },
    vehicle: {
      findMany: vi.fn(async () => opts.candidateVehicles ?? []),
    },
    // isVehicleFree scheduled-work-order block — none → vehicle is free.
    maintenanceWorkOrder: {
      findMany: vi.fn(async () => []),
    },
    bookingSwap: {
      findFirst: vi.fn(async () => opts.existingDraft ?? null),
      findUniqueOrThrow: vi.fn(async () => opts.existingDraft),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "swap-1",
        ...data,
      })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "swap-1",
        ...data,
      })),
    },
    vehicleCategory: {
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        baseDailyRate: new Prisma.Decimal(50),
        baseWeeklyRate: new Prisma.Decimal(280),
        baseMonthlyRate: new Prisma.Decimal(1100),
        bondAmount: new Prisma.Decimal(500),
      })),
    },
    season: { findMany: vi.fn(async () => []) },
    // No tier ladders in these tests → quoteSwapDelta falls back to flat
    // daily/weekly/monthly rates.
    pricingTier: { findMany: vi.fn(async () => []) },
    auditLog: { create: vi.fn(async () => null) },
  };
  return {
    prisma,
    user: {
      id: opts.userId ?? "staff1",
      role: opts.role ?? "STAFF",
    },
    session: { user: { id: opts.userId ?? "staff1", role: opts.role ?? "STAFF" } },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    reqId: "r1",
    // Skip the auto-audit middleware shenanigans in tests.
    _skipAudit: true,
  };
}

describe("bookingSwap.startSwapDraft", () => {
  it("rejects when booking has no assigned vehicle", async () => {
    const ctx = makeCtx({
      booking: {
        id: "b1",
        status: "ACTIVE",
        vehicleId: null,
        categoryId: "cat-A",
        customerId: "cust1",
      },
    });
    const caller = bookingSwapRouter.createCaller(ctx as never);
    await expect(
      caller.startSwapDraft({
        bookingId: "b1",
        reason: "LATERAL",
        origin: "CUSTOMER_WALK_IN",
        reasonNotes: "swap",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects non-swappable statuses", async () => {
    const ctx = makeCtx({
      booking: {
        id: "b1",
        status: "COMPLETED",
        vehicleId: "v-old",
        categoryId: "cat-A",
        customerId: "cust1",
      },
    });
    const caller = bookingSwapRouter.createCaller(ctx as never);
    await expect(
      caller.startSwapDraft({
        bookingId: "b1",
        reason: "LATERAL",
        origin: "CUSTOMER_WALK_IN",
        reasonNotes: "swap",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("blocks STAFF role from MECHANICAL_FAULT swaps (manager-only)", async () => {
    const ctx = makeCtx({ role: "STAFF" });
    const caller = bookingSwapRouter.createCaller(ctx as never);
    await expect(
      caller.startSwapDraft({
        bookingId: "b1",
        reason: "MECHANICAL_FAULT",
        origin: "STAFF_OBSERVED",
        reasonNotes: "brakes soft",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("allows MANAGER role to start a MECHANICAL_FAULT swap", async () => {
    const ctx = makeCtx({ role: "MANAGER" });
    const caller = bookingSwapRouter.createCaller(ctx as never);
    await expect(
      caller.startSwapDraft({
        bookingId: "b1",
        reason: "MECHANICAL_FAULT",
        origin: "CUSTOMER_PHONE_SUPPORT",
        reasonNotes: "customer reported spongy brakes on 0400-xxx call",
        originDetails: "TKT-9876",
      }),
    ).resolves.toMatchObject({ id: "swap-1" });
  });

  it("blocks STAFF from DOWNGRADE (manager-only)", async () => {
    const ctx = makeCtx({ role: "STAFF" });
    const caller = bookingSwapRouter.createCaller(ctx as never);
    await expect(
      caller.startSwapDraft({
        bookingId: "b1",
        reason: "DOWNGRADE",
        origin: "CUSTOMER_WALK_IN",
        reasonNotes: "wants a cheaper bike",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("allows STAFF to start an UPGRADE or LATERAL swap", async () => {
    for (const reason of ["UPGRADE", "LATERAL"] as const) {
      const ctx = makeCtx({ role: "STAFF" });
      const caller = bookingSwapRouter.createCaller(ctx as never);
      await expect(
        caller.startSwapDraft({
          bookingId: "b1",
          reason,
          origin: "CUSTOMER_WALK_IN",
          reasonNotes: "customer preference",
        }),
      ).resolves.toMatchObject({ id: "swap-1" });
    }
  });

  it("rejects a second concurrent draft with CONFLICT", async () => {
    const ctx = makeCtx({
      existingDraft: { id: "old-draft", swappedById: "other-staff" },
    });
    const caller = bookingSwapRouter.createCaller(ctx as never);
    await expect(
      caller.startSwapDraft({
        bookingId: "b1",
        reason: "LATERAL",
        origin: "CUSTOMER_WALK_IN",
        reasonNotes: "second attempt",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("bookingSwap.quoteDelta", () => {
  it("returns forcedZero='reason' for MECHANICAL_FAULT regardless of category diff", async () => {
    const ctx = makeCtx();
    const caller = bookingSwapRouter.createCaller(ctx as never);
    const q = await caller.quoteDelta({
      bookingId: "b1",
      newCategoryId: "cat-B",
      reason: "MECHANICAL_FAULT",
    });
    expect(q.forcedZero).toBe("reason");
    expect(q.deltaAmount).toBe(0);
    expect(q.direction).toBe("NONE");
  });

  it("returns forcedZero='same-category' when categories match", async () => {
    const ctx = makeCtx();
    const caller = bookingSwapRouter.createCaller(ctx as never);
    const q = await caller.quoteDelta({
      bookingId: "b1",
      newCategoryId: "cat-A",
      reason: "LATERAL",
    });
    expect(q.forcedZero).toBe("same-category");
    expect(q.direction).toBe("NONE");
  });

  it("returns non-zero quote for UPGRADE across categories", async () => {
    const ctx = makeCtx();
    // Override the default 50/50 to get an asymmetric delta.
    const prisma = ctx.prisma as unknown as {
      vehicleCategory: { findUniqueOrThrow: ReturnType<typeof vi.fn> };
    };
    prisma.vehicleCategory.findUniqueOrThrow = vi.fn(
      async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        baseDailyRate: new Prisma.Decimal(where.id === "cat-A" ? 50 : 80),
        baseWeeklyRate: new Prisma.Decimal(where.id === "cat-A" ? 280 : 500),
        baseMonthlyRate: new Prisma.Decimal(where.id === "cat-A" ? 1100 : 1800),
      }),
    );
    const caller = bookingSwapRouter.createCaller(ctx as never);
    const q = await caller.quoteDelta({
      bookingId: "b1",
      newCategoryId: "cat-B",
      reason: "UPGRADE",
    });
    expect(q.forcedZero).toBe(null);
    expect(q.direction).toBe("CHARGE");
    expect(q.deltaAmount).toBeGreaterThan(0);
  });
});

describe("bookingSwap.listCandidates", () => {
  function candidate(over: Partial<Record<string, unknown>> = {}) {
    return {
      id: "v1",
      internalCode: "SCT-13628",
      rego: "IQJ46",
      make: "Honda",
      model: "CB125E",
      year: 2024,
      colour: "Black",
      condition: "GOOD",
      currentOdometerKm: 0,
      regoExpiry: new Date("2027-01-01T00:00:00+10:00"),
      ctpExpiry: new Date("2027-01-01T00:00:00+10:00"),
      insuranceExpiry: new Date("2027-01-01T00:00:00+10:00"),
      categoryId: "cat-A",
      category: { id: "cat-A", name: "LAMS Motorcycle", engineCapacity: 125 },
      depot: { name: "Brisbane CBD" },
      images: [{ url: "/img/1.jpg", isPrimary: true, displayOrder: 0, caption: null }],
      ...over,
    };
  }

  it("returns enriched, free candidates for an eligible booking", async () => {
    const ctx = makeCtx({
      candidateVehicles: [
        candidate(),
        candidate({ id: "v2", internalCode: "MTB-11479", rego: "JKZ02", categoryId: "cat-B" }),
      ],
    });
    const caller = bookingSwapRouter.createCaller(ctx as never);
    const res = await caller.listCandidates({ bookingId: "b1", includeCrossCategory: true });
    expect(res.eligible).toBe(true);
    expect(res.vehicles).toHaveLength(2);
    const first = res.vehicles[0]!;
    // Enriched fields the rich card relies on.
    expect(first).toMatchObject({
      make: "Honda",
      model: "CB125E",
      engineCapacity: 125,
      depotName: "Brisbane CBD",
      isSameCategory: true,
      free: true,
    });
    expect(first.images).toHaveLength(1);
    // Docs all valid past the return date → no expiry warnings.
    expect(first.docsExpiringDuringRental).toEqual([]);
    // Cross-category unit is flagged as such.
    expect(res.vehicles[1]!.isSameCategory).toBe(false);
  });

  it("flags documents expiring during the rental window", async () => {
    const ctx = makeCtx({
      candidateVehicles: [
        candidate({ regoExpiry: new Date("2026-06-01T00:00:00+10:00") }),
      ],
    });
    const caller = bookingSwapRouter.createCaller(ctx as never);
    const res = await caller.listCandidates({ bookingId: "b1", includeCrossCategory: false });
    expect(res.vehicles[0]!.docsExpiringDuringRental).toContain("rego");
  });

  it("returns ineligible with no vehicles for a non-swappable booking", async () => {
    const ctx = makeCtx({
      booking: {
        id: "b1",
        status: "COMPLETED",
        vehicleId: "v-old",
        categoryId: "cat-A",
        customerId: "cust1",
        returnDateTime: new Date(Date.now() + 30 * 86_400_000), // 30 days out — must stay after swapAt (now)
      },
    });
    const caller = bookingSwapRouter.createCaller(ctx as never);
    const res = await caller.listCandidates({ bookingId: "b1", includeCrossCategory: false });
    expect(res.eligible).toBe(false);
    expect(res.vehicles).toEqual([]);
  });
});

describe("bookingSwap.voidSwapDraft", () => {
  it("allows the draft author to void", async () => {
    const ctx = makeCtx({
      userId: "author-1",
      existingDraft: {
        id: "draft-1",
        swappedById: "author-1",
        status: "DRAFT",
        reasonNotes: "notes",
      } as never,
    });
    const caller = bookingSwapRouter.createCaller(ctx as never);
    await expect(
      caller.voidSwapDraft({ swapId: "draft-1", reason: "abandoned" }),
    ).resolves.toMatchObject({ id: "swap-1" });
  });

  it("rejects a non-author STAFF from voiding", async () => {
    const ctx = makeCtx({
      userId: "other-staff",
      role: "STAFF",
      existingDraft: {
        id: "draft-1",
        swappedById: "author-1",
        status: "DRAFT",
        reasonNotes: "notes",
      } as never,
    });
    const caller = bookingSwapRouter.createCaller(ctx as never);
    await expect(
      caller.voidSwapDraft({ swapId: "draft-1" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("allows MANAGER to void someone else's draft", async () => {
    const ctx = makeCtx({
      userId: "manager-1",
      role: "MANAGER",
      existingDraft: {
        id: "draft-1",
        swappedById: "author-1",
        status: "DRAFT",
        reasonNotes: "notes",
      } as never,
    });
    const caller = bookingSwapRouter.createCaller(ctx as never);
    await expect(
      caller.voidSwapDraft({ swapId: "draft-1" }),
    ).resolves.toMatchObject({ id: "swap-1" });
  });

  it("rejects voiding a non-DRAFT swap", async () => {
    const ctx = makeCtx({
      userId: "author-1",
      existingDraft: {
        id: "draft-1",
        swappedById: "author-1",
        status: "COMMITTED",
        reasonNotes: "notes",
      } as never,
    });
    const caller = bookingSwapRouter.createCaller(ctx as never);
    await expect(
      caller.voidSwapDraft({ swapId: "draft-1" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("bookingSwap.activeDraft", () => {
  it("returns the open DRAFT so the wizard can resume", async () => {
    const ctx = makeCtx({
      existingDraft: {
        id: "draft-1",
        reason: "LATERAL",
        origin: "CUSTOMER_WALK_IN",
        reasonNotes: "notes",
        originDetails: null,
        draftState: { step: "outgoing" },
        swappedById: "staff1",
      } as never,
    });
    const caller = bookingSwapRouter.createCaller(ctx as never);
    await expect(caller.activeDraft({ bookingId: "b1" })).resolves.toMatchObject({
      id: "draft-1",
      reason: "LATERAL",
    });
  });

  it("returns null when no draft is open", async () => {
    const ctx = makeCtx();
    const caller = bookingSwapRouter.createCaller(ctx as never);
    await expect(caller.activeDraft({ bookingId: "b1" })).resolves.toBeNull();
  });
});

describe("bookingSwap.saveDraftProgress", () => {
  const draftState = {
    step: "select" as const,
    outgoing: {
      odometerKm: "12345",
      fuelLevel: 90,
      overallCondition: "GOOD" as const,
      notes: "",
      markers: [],
      activeSeverity: "MINOR" as const,
    },
    incoming: {
      odometerKm: "",
      fuelLevel: 100,
      overallCondition: "GOOD" as const,
      notes: "",
      markers: [],
      activeSeverity: "MINOR" as const,
    },
    incomingVehicleId: "",
    includeCrossCategory: false,
    customerSignatureUrl: null,
    staffSignatureUrl: null,
    incidentSeverity: "MODERATE" as const,
    workOrderPriority: "HIGH" as const,
  };

  it("persists progress for the draft author", async () => {
    const ctx = makeCtx({
      userId: "author-1",
      existingDraft: { id: "draft-1", status: "DRAFT", swappedById: "author-1" } as never,
    });
    const caller = bookingSwapRouter.createCaller(ctx as never);
    await expect(
      caller.saveDraftProgress({ swapId: "draft-1", draftState }),
    ).resolves.toMatchObject({ id: "swap-1" });
  });

  it("rejects a non-author STAFF from editing the draft", async () => {
    const ctx = makeCtx({
      userId: "other-staff",
      role: "STAFF",
      existingDraft: { id: "draft-1", status: "DRAFT", swappedById: "author-1" } as never,
    });
    const caller = bookingSwapRouter.createCaller(ctx as never);
    await expect(
      caller.saveDraftProgress({ swapId: "draft-1", draftState }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects editing a non-DRAFT swap", async () => {
    const ctx = makeCtx({
      userId: "author-1",
      existingDraft: { id: "draft-1", status: "COMMITTED", swappedById: "author-1" } as never,
    });
    const caller = bookingSwapRouter.createCaller(ctx as never);
    await expect(
      caller.saveDraftProgress({ swapId: "draft-1", draftState }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("bookingSwap depot scoping (B1 follow-up)", () => {
  it("FORBIDDEN: depot-assigned STAFF cannot list candidates for another depot's booking", async () => {
    const prisma = {
      booking: {
        // _depot-scope's cheap depot lookup
        findUnique: vi.fn(async () => ({ depotId: "depot-b" })),
        findUniqueOrThrow: vi.fn(),
      },
    };
    const ctx = {
      prisma,
      user: { id: "staff1", role: "STAFF" as const, depotId: "depot-a" },
      session: { user: { id: "staff1", role: "STAFF" as const, depotId: "depot-a" } },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      reqId: "r1",
      _skipAudit: true,
    };
    const caller = bookingSwapRouter.createCaller(ctx as never);
    await expect(
      caller.listCandidates({ bookingId: "b-other", includeCrossCategory: false }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(prisma.booking.findUniqueOrThrow).not.toHaveBeenCalled();
  });
});
