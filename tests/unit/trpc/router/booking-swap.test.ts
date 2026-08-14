import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

// Heavy side-effect deps are stubbed so confirmSwap's money core can run as a
// pure unit test (mock pattern: staff-booking.refund.test.ts). Pricing stays
// real — the delta math is the thing under test.
const refundChargeMock = vi.fn();
vi.mock("@/lib/stripe", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  refundCharge: (...args: unknown[]) => refundChargeMock(...args),
}));

const sendNotificationMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/server/services/notification-sender", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sendNotification: (...args: unknown[]) => sendNotificationMock(...args),
}));

vi.mock("@/lib/analytics", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  trackServer: vi.fn(async () => {}),
}));

vi.mock("@/lib/storage", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  uploadFile: vi.fn(async () => ({ url: "https://storage.local/swap.pdf" })),
}));

vi.mock("@/lib/pdf/swap-agreement", () => ({
  renderSwapAgreementPdf: vi.fn(async () => Buffer.from("pdf")),
}));

const tryIssueAdjustmentForBookingMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/server/services/invoice-lifecycle", () => ({
  tryIssueAdjustmentForBooking: (...args: unknown[]) =>
    tryIssueAdjustmentForBookingMock(...args),
}));

vi.mock("@react-email/render", () => ({
  render: vi.fn(async () => "<html></html>"),
}));

vi.mock("../../../../emails/vehicle-swap", () => ({
  default: () => null,
}));

import { bookingSwapRouter } from "../../../../src/server/trpc/router/booking-swap";

// Focus: the guard logic of the bookingSwap router plus confirmSwap's money
// core (categoryId hand-off, ledger increments/decrements, refund offset).
// The full transactional happy-path (Stripe + PDF + notification) is covered
// by the Playwright spec.

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
    /** loadVehicleCtx rows for quoteSwapDelta's vehicle-level pricing, keyed
     *  by vehicle id. Absent/undefined id → null (no override). */
    vehicleRates?: Record<string, Record<string, unknown> | null>;
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
      // quoteSwapDelta's loadVehicleCtx — vehicle-level pricing lookup.
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        opts.vehicleRates?.[where.id] ?? null,
      ),
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

// ---------------------------------------------------------------------------
// confirmSwap money core (PR2). Full-fat ctx: the transaction callback runs
// against the same mock models, and booking.update persists categoryId /
// vehicleId onto the shared booking object so follow-up quoteDelta calls see
// post-swap state (the double-charge regression).
// ---------------------------------------------------------------------------

const A_DAY = 86_400_000;

function makeConfirmCtx(
  opts: {
    role?: "STAFF" | "MANAGER";
    reason?: "UPGRADE" | "DOWNGRADE" | "LATERAL" | "MECHANICAL_FAULT" | "ACCIDENT_DAMAGE";
    bookingCategoryId?: string;
    incomingCategoryId?: string;
    balanceDue?: number;
    pendingSum?: number | null;
    payments?: Array<Record<string, unknown>>;
  } = {},
) {
  // cat-A $50/day, cat-B $80/day over 5 remaining days (below the 7-day
  // duration-discount rung, no seasons/tiers) → delta is exactly ±$150.
  const daily: Record<string, number> = { "cat-A": 50, "cat-B": 80 };
  const bookingCategoryId = opts.bookingCategoryId ?? "cat-A";
  const incomingCategoryId = opts.incomingCategoryId ?? "cat-B";
  const booking = {
    id: "b1",
    status: "ACTIVE",
    vehicleId: "v-old" as string,
    categoryId: bookingCategoryId,
    customerId: "cust1",
    bookingReference: "XPM-1001",
    pickupDateTime: new Date(Date.now() - 2 * A_DAY),
    returnDateTime: new Date(Date.now() + 5 * A_DAY),
    balanceDue: opts.balanceDue ?? 0,
    category: {
      id: bookingCategoryId,
      name: "Cat Old",
      bondAmount: new Prisma.Decimal(500),
    },
    customer: { id: "cust1", firstName: "Ava", lastName: "Nguyen", email: "ava@example.com" },
    bondLedger: null,
    payments: opts.payments ?? [],
    billingPlan: null,
    pickupDepot: { slug: "bne" },
  };
  const draft = {
    id: "swapd-1",
    bookingId: "b1",
    status: "DRAFT",
    outgoingVehicleId: "v-old",
    swappedById: "staff1",
    reason: opts.reason ?? "UPGRADE",
    origin: "CUSTOMER_WALK_IN",
    reasonNotes: "customer request",
    originDetails: null,
  };
  const incomingVehicle = {
    id: "v-new",
    internalCode: "MTB-2",
    rego: "XYZ12",
    make: "Yamaha",
    model: "MT-07",
    isActive: true,
    status: "AVAILABLE",
    categoryId: incomingCategoryId,
    depotId: "depot-1",
    category: {
      id: incomingCategoryId,
      name: "Cat New",
      bondAmount: new Prisma.Decimal(500),
    },
  };
  const models = {
    booking: {
      findUnique: vi.fn(async () => booking),
      findUniqueOrThrow: vi.fn(async () => booking),
      // isVehicleFree clash search — no clashing booking.
      findFirst: vi.fn(async () => null),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (typeof data.categoryId === "string") booking.categoryId = data.categoryId;
        if (typeof data.vehicleId === "string") booking.vehicleId = data.vehicleId;
        return booking;
      }),
    },
    vehicle: {
      findUniqueOrThrow: vi.fn(async () => incomingVehicle),
      // loadVehicleCtx — no vehicle-level rate overrides in these tests.
      findUnique: vi.fn(async () => null),
      update: vi.fn(async () => ({})),
    },
    // isVehicleFree scheduled-work-order block — none. `create` covers both
    // the fault work order and the PR7 turnaround-buffer work order.
    maintenanceWorkOrder: {
      findMany: vi.fn(async () => []),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "wo-1",
        ...data,
      })),
      // Swap-agreement PDF lookup after commit.
      findUnique: vi.fn(async () => ({ workOrderNumber: "WO-TEST-1" })),
    },
    incident: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "inc-1",
        ...data,
      })),
      findUnique: vi.fn(async () => ({ incidentNumber: "INC-TEST-1" })),
    },
    inspection: {
      // Odometer-rollback guard — no prior reading.
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: `insp-${data.type as string}`,
        ...data,
      })),
    },
    // PR7: swap markers mirrored into labelled InspectionIssue rows.
    inspectionIssue: {
      createMany: vi.fn(async ({ data }: { data: unknown[] }) => ({ count: data.length })),
    },
    bookingSwap: {
      findUnique: vi.fn(async () => draft),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: draft.id,
        ...data,
      })),
    },
    payment: {
      aggregate: vi.fn(async () => ({ _sum: { amount: opts.pendingSum ?? null } })),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "pay-new",
        ...data,
      })),
      update: vi.fn(async () => ({})),
    },
    vehicleCategory: {
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        baseDailyRate: new Prisma.Decimal(daily[where.id] ?? 50),
        baseWeeklyRate: new Prisma.Decimal((daily[where.id] ?? 50) * 6),
        baseMonthlyRate: new Prisma.Decimal((daily[where.id] ?? 50) * 22),
        bondAmount: new Prisma.Decimal(500),
      })),
    },
    season: { findMany: vi.fn(async () => []) },
    pricingTier: { findMany: vi.fn(async () => []) },
    user: {
      findUnique: vi.fn(async () => ({ firstName: "Staff", lastName: "Member" })),
      findMany: vi.fn(async () => [{ id: "mgr-1" }]),
    },
    auditLog: { create: vi.fn(async () => null) },
  };
  const prisma = {
    ...models,
    $transaction: vi.fn(async (fn: (tx: typeof models) => unknown) => fn(models)),
  };
  const role = opts.role ?? "STAFF";
  return {
    ctx: {
      prisma,
      user: { id: "staff1", role },
      session: { user: { id: "staff1", role } },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      reqId: "r1",
      _skipAudit: true,
    },
    prisma,
    booking,
    draft,
  };
}

const inspectionInput = (odometerKm: number) => ({
  odometerKm,
  fuelLevel: 90,
  overallCondition: "GOOD" as const,
});

describe("bookingSwap.confirmSwap money core", () => {
  beforeEach(() => {
    refundChargeMock.mockReset();
    sendNotificationMock.mockClear();
    tryIssueAdjustmentForBookingMock.mockClear();
  });

  it("UPGRADE commit updates booking.categoryId, raises balanceDue AND totals, and kills the double-charge/free-swap-back pair", async () => {
    const { ctx, prisma, booking } = makeConfirmCtx();
    const caller = bookingSwapRouter.createCaller(ctx as never);
    const res = await caller.confirmSwap({
      swapId: "swapd-1",
      incomingVehicleId: "v-new",
      outgoingInspection: inspectionInput(1200),
      incomingInspection: inspectionInput(300),
    });
    expect(res.direction).toBe("CHARGE");
    expect(res.deltaAmount).toBeCloseTo(150, 2);

    // Step-5 reassignment payload carries the incoming vehicle's category.
    const reassign = prisma.booking.update.mock.calls.find(
      (c) => typeof c[0].data.vehicleId === "string",
    );
    expect(reassign).toBeDefined();
    expect(reassign![0].data).toMatchObject({
      vehicleId: "v-new",
      categoryId: "cat-B",
    });
    expect(booking.categoryId).toBe("cat-B");

    // CHARGE raise moves totals with balanceDue (extend's arithmetic).
    const raise = prisma.booking.update.mock.calls.find(
      (c) => c[0].data.balanceDue !== undefined,
    );
    expect(raise![0].data).toEqual({
      balanceDue: { increment: 150 },
      totalAmount: { increment: 150 },
      gstAmount: { increment: 13.64 },
    });
    expect(prisma.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reference: "SWAP-swapd-1",
          type: "SWAP_ADJUSTMENT",
          amount: 150,
          gstAmount: 13.64,
          status: "PENDING",
        }),
      }),
    );

    // Double-charge regression: a second quote now prices cat-B → cat-B.
    const requote = await caller.quoteDelta({
      bookingId: "b1",
      newCategoryId: "cat-B",
      reason: "UPGRADE",
    });
    expect(requote.deltaAmount).toBe(0);
    expect(requote.direction).toBe("NONE");

    // Swap-back is no longer free: quoting back to the original category
    // reads the updated categoryId and yields a REFUND, not zero.
    const swapBack = await caller.quoteDelta({
      bookingId: "b1",
      newCategoryId: "cat-A",
      reason: "DOWNGRADE",
    });
    expect(swapBack.direction).toBe("REFUND");
    expect(swapBack.deltaAmount).toBeCloseTo(-150, 2);
  });

  it("REFUND offsets outstanding balanceDue first and only refunds the cash surplus via Stripe", async () => {
    const source = {
      id: "src-1",
      amount: new Prisma.Decimal(500),
      processedAt: new Date(Date.now() - 10 * A_DAY),
      createdAt: new Date(Date.now() - 10 * A_DAY),
      stripePaymentIntentId: "pi_1",
      stripeChargeId: "ch_1",
    };
    refundChargeMock.mockResolvedValueOnce({ id: "re_1", status: "succeeded" });
    const { ctx, prisma } = makeConfirmCtx({
      reason: "DOWNGRADE",
      bookingCategoryId: "cat-B",
      incomingCategoryId: "cat-A",
      balanceDue: 40,
      payments: [source],
    });
    const caller = bookingSwapRouter.createCaller(ctx as never);
    const res = await caller.confirmSwap({
      swapId: "swapd-1",
      incomingVehicleId: "v-new",
      outgoingInspection: inspectionInput(1200),
      incomingInspection: inspectionInput(300),
    });
    expect(res.direction).toBe("REFUND");
    expect(res.deltaAmount).toBeCloseTo(150, 2);

    // $40 of the $150 delta clears debt; only $110 moves as cash.
    expect(refundChargeMock).toHaveBeenCalledWith(
      expect.objectContaining({ amountCents: 11000, idempotencyKey: "swap-refund-swapd-1" }),
    );
    // REFUND Payment row covers the cash slice only.
    expect(prisma.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reference: "SWAP-REF-swapd-1",
          type: "REFUND",
          amount: 110,
          gstAmount: 10,
          status: "SUCCEEDED",
        }),
      }),
    );
    // Source rollup keyed on the cash refunded, not the full delta.
    expect(prisma.payment.update).toHaveBeenCalledWith({
      where: { id: "src-1" },
      data: { status: "PARTIALLY_REFUNDED" },
    });
    // Ledger: totals drop by the full delta, balanceDue by the offset,
    // amountPaid by the cash that actually left.
    const settle = prisma.booking.update.mock.calls.find(
      (c) => c[0].data.totalAmount !== undefined,
    );
    expect(settle![0].data).toEqual({
      totalAmount: { decrement: 150 },
      gstAmount: { decrement: 13.64 },
      balanceDue: { decrement: 40 },
      amountPaid: { decrement: 110 },
    });
  });

  it("fully-offset REFUND is a pure balance write-down: no Stripe call, no Payment row, no source payment required", async () => {
    const { ctx, prisma } = makeConfirmCtx({
      reason: "DOWNGRADE",
      bookingCategoryId: "cat-B",
      incomingCategoryId: "cat-A",
      balanceDue: 500,
      payments: [], // would throw "No SUCCEEDED booking payment" if cash were needed
    });
    const caller = bookingSwapRouter.createCaller(ctx as never);
    const res = await caller.confirmSwap({
      swapId: "swapd-1",
      incomingVehicleId: "v-new",
      outgoingInspection: inspectionInput(1200),
      incomingInspection: inspectionInput(300),
    });
    expect(res.direction).toBe("REFUND");
    expect(refundChargeMock).not.toHaveBeenCalled();
    expect(prisma.payment.create).not.toHaveBeenCalled();
    expect(res.swap.paymentId).toBeNull();

    const settle = prisma.booking.update.mock.calls.find(
      (c) => c[0].data.totalAmount !== undefined,
    );
    expect(settle![0].data).toEqual({
      totalAmount: { decrement: 150 },
      gstAmount: { decrement: 13.64 },
      balanceDue: { decrement: 150 },
    });
    // The DECREASE adjustment note still covers the full delta.
    expect(tryIssueAdjustmentForBookingMock).toHaveBeenCalledWith(
      expect.objectContaining({ bookingId: "b1", type: "DECREASE", reason: "SWAP" }),
    );
  });

  it("FAILED Stripe refund records the FAILED row, leaves the ledger untouched, and pages managers", async () => {
    const source = {
      id: "src-1",
      amount: new Prisma.Decimal(500),
      processedAt: new Date(Date.now() - 10 * A_DAY),
      createdAt: new Date(Date.now() - 10 * A_DAY),
      stripePaymentIntentId: "pi_1",
      stripeChargeId: "ch_1",
    };
    refundChargeMock.mockRejectedValueOnce(new Error("card_declined"));
    const { ctx, prisma } = makeConfirmCtx({
      reason: "DOWNGRADE",
      bookingCategoryId: "cat-B",
      incomingCategoryId: "cat-A",
      balanceDue: 0,
      payments: [source],
    });
    const caller = bookingSwapRouter.createCaller(ctx as never);
    await caller.confirmSwap({
      swapId: "swapd-1",
      incomingVehicleId: "v-new",
      outgoingInspection: inspectionInput(1200),
      incomingInspection: inspectionInput(300),
    });

    expect(prisma.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: "REFUND", amount: 150, status: "FAILED" }),
      }),
    );
    // No ledger decrements on a failed refund.
    const settle = prisma.booking.update.mock.calls.find(
      (c) => c[0].data.totalAmount !== undefined,
    );
    expect(settle).toBeUndefined();
    // Manager notification flags the unrefunded downgrade.
    const flagged = sendNotificationMock.mock.calls.find((c) =>
      String((c[0] as { dedupKey?: string }).dedupKey).startsWith("swap-refund-failed:"),
    );
    expect(flagged).toBeDefined();
    expect(flagged![0]).toMatchObject({
      userId: "mgr-1",
      dedupKey: "swap-refund-failed:swapd-1:mgr-1",
    });
  });

  it("manager price override computes GST via gstFromInclusive", async () => {
    const { ctx, prisma } = makeConfirmCtx({ role: "MANAGER" });
    const caller = bookingSwapRouter.createCaller(ctx as never);
    const res = await caller.confirmSwap({
      swapId: "swapd-1",
      incomingVehicleId: "v-new",
      outgoingInspection: inspectionInput(1200),
      incomingInspection: inspectionInput(300),
      priceAdjustmentOverride: 123.45,
    });
    expect(res.deltaAmount).toBeCloseTo(123.45, 2);
    // 123.45 / 11 = 11.2227… → 11.22 (roundCents half-up).
    expect(res.gstAmount).toBe(11.22);
    expect(prisma.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ amount: 123.45, gstAmount: 11.22 }),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// confirmSwap operational correctness (PR7): overlap → CONFLICT, cleaning
// buffer via turnaround work order, swap markers → InspectionIssue rows.
// ---------------------------------------------------------------------------

describe("bookingSwap.confirmSwap operational correctness", () => {
  beforeEach(() => {
    refundChargeMock.mockReset();
    sendNotificationMock.mockClear();
    tryIssueAdjustmentForBookingMock.mockClear();
  });

  it("surfaces a Booking_no_overlap violation from the tx as an actionable CONFLICT", async () => {
    const { ctx, prisma } = makeConfirmCtx();
    (prisma.$transaction as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      Object.assign(
        new Error('conflicting key value violates exclusion constraint "Booking_no_overlap"'),
        { meta: { code: "23P01" } },
      ),
    );
    const caller = bookingSwapRouter.createCaller(ctx as never);
    await expect(
      caller.confirmSwap({
        swapId: "swapd-1",
        incomingVehicleId: "v-new",
        outgoingInspection: inspectionInput(1200),
        incomingInspection: inspectionInput(300),
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("choose another vehicle"),
    });
  });

  it("rethrows non-overlap transaction errors untouched", async () => {
    const { ctx, prisma } = makeConfirmCtx();
    (prisma.$transaction as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("connection refused"),
    );
    const caller = bookingSwapRouter.createCaller(ctx as never);
    await expect(
      caller.confirmSwap({
        swapId: "swapd-1",
        incomingVehicleId: "v-new",
        outgoingInspection: inspectionInput(1200),
        incomingInspection: inspectionInput(300),
      }),
    ).rejects.toThrow("connection refused");
  });

  it("UPGRADE swap flips the outgoing vehicle AVAILABLE and schedules a cleaning-buffer turnaround work order", async () => {
    const { ctx, prisma } = makeConfirmCtx();
    const caller = bookingSwapRouter.createCaller(ctx as never);
    await caller.confirmSwap({
      swapId: "swapd-1",
      incomingVehicleId: "v-new",
      outgoingInspection: inspectionInput(1200),
      incomingInspection: inspectionInput(300),
    });

    const vehicleUpdates = prisma.vehicle.update.mock.calls as unknown as Array<
      [{ data: { status?: string } }]
    >;
    const outgoingFlip = vehicleUpdates.find((c) => c[0].data.status === "AVAILABLE");
    expect(outgoingFlip).toBeDefined();

    const turnaround = prisma.maintenanceWorkOrder.create.mock.calls.find((c) =>
      String((c[0] as { data: { title: string } }).data.title).startsWith(
        "Post-hire turnaround —",
      ),
    );
    expect(turnaround).toBeDefined();
    const data = (turnaround![0] as { data: Record<string, unknown> }).data;
    expect(data).toMatchObject({
      vehicleId: "v-old",
      type: "CUSTOM",
      status: "OPEN",
      title: "Post-hire turnaround — swap XPM-1001",
    });
    // Window spans exactly BOOKING_RULES.bufferHoursBetweenBookings (2h).
    const start = data.scheduledStartAt as Date;
    const end = data.scheduledEndAt as Date;
    expect(end.getTime() - start.getTime()).toBe(2 * 60 * 60 * 1000);
  });

  it("MECHANICAL_FAULT swap sends the vehicle to maintenance — fault work order, no turnaround", async () => {
    const { ctx, prisma } = makeConfirmCtx({ reason: "MECHANICAL_FAULT" });
    const caller = bookingSwapRouter.createCaller(ctx as never);
    await caller.confirmSwap({
      swapId: "swapd-1",
      incomingVehicleId: "v-new",
      outgoingInspection: inspectionInput(1200),
      incomingInspection: inspectionInput(300),
    });

    const vehicleUpdates = prisma.vehicle.update.mock.calls as unknown as Array<
      [{ data: { status?: string } }]
    >;
    const toMaintenance = vehicleUpdates.find((c) => c[0].data.status === "IN_MAINTENANCE");
    expect(toMaintenance).toBeDefined();
    const titles = prisma.maintenanceWorkOrder.create.mock.calls.map((c) =>
      String((c[0] as { data: { title: string } }).data.title),
    );
    expect(titles.some((t) => t.startsWith("Fault reported mid-rental"))).toBe(true);
    expect(titles.some((t) => t.startsWith("Post-hire turnaround —"))).toBe(false);
  });

  it("ACCIDENT_DAMAGE swap creates no turnaround work order either", async () => {
    const { ctx, prisma } = makeConfirmCtx({ reason: "ACCIDENT_DAMAGE" });
    const caller = bookingSwapRouter.createCaller(ctx as never);
    await caller.confirmSwap({
      swapId: "swapd-1",
      incomingVehicleId: "v-new",
      outgoingInspection: inspectionInput(1200),
      incomingInspection: inspectionInput(300),
      incidentSeverity: "MODERATE",
    });
    const titles = prisma.maintenanceWorkOrder.create.mock.calls.map((c) =>
      String((c[0] as { data: { title: string } }).data.title),
    );
    expect(titles.some((t) => t.startsWith("Post-hire turnaround —"))).toBe(false);
  });

  it("swap markers become InspectionIssue rows — outgoing chargeable, incoming pre-existing", async () => {
    const { ctx, prisma } = makeConfirmCtx();
    const caller = bookingSwapRouter.createCaller(ctx as never);
    await caller.confirmSwap({
      swapId: "swapd-1",
      incomingVehicleId: "v-new",
      outgoingInspection: {
        ...inspectionInput(1200),
        damageMarkers: [
          {
            x: 0.4,
            y: 0.6,
            severity: "MODERATE" as const,
            view: "RIGHT" as const,
            note: "Scrape on fairing",
            source: "staff" as const,
          },
        ],
      },
      incomingInspection: {
        ...inspectionInput(300),
        damageMarkers: [
          { x: 0.1, y: 0.2, severity: "MINOR" as const, view: "LEFT" as const, source: "staff" as const },
        ],
      },
    });

    expect(prisma.inspectionIssue.createMany).toHaveBeenCalledTimes(2);
    const [outCall, inCall] = prisma.inspectionIssue.createMany.mock.calls;
    // Outgoing (SWAP_OUT): this hire's damage — chargeable at check-in.
    expect((outCall![0] as { data: unknown[] }).data).toEqual([
      {
        inspectionId: "insp-POST_HIRE",
        side: "RIGHT",
        label: "Scrape on fairing",
        severity: "MODERATE",
        note: "Scrape on fairing",
        posX: 0.4,
        posY: 0.6,
        source: "staff",
        isPreExisting: false,
      },
    ]);
    // Incoming (SWAP_IN): replacement's baseline — pre-existing, note-less
    // markers get the fallback label.
    expect((inCall![0] as { data: unknown[] }).data).toEqual([
      {
        inspectionId: "insp-PRE_HIRE",
        side: "LEFT",
        label: "Damage marker (MINOR)",
        severity: "MINOR",
        note: null,
        posX: 0.1,
        posY: 0.2,
        source: "staff",
        isPreExisting: true,
      },
    ]);
  });

  it("no markers → no InspectionIssue writes", async () => {
    const { ctx, prisma } = makeConfirmCtx();
    const caller = bookingSwapRouter.createCaller(ctx as never);
    await caller.confirmSwap({
      swapId: "swapd-1",
      incomingVehicleId: "v-new",
      outgoingInspection: inspectionInput(1200),
      incomingInspection: inspectionInput(300),
    });
    expect(prisma.inspectionIssue.createMany).not.toHaveBeenCalled();
  });
});

describe("bookingSwap.quoteDelta vehicle-level rates", () => {
  const overrideRates = (rate: number) => ({
    "v-new": {
      baseRateOverride: new Prisma.Decimal(rate),
      basePeriodHoursOverride: null,
      modelId: null,
      catalogueModel: null,
    },
    "v-old": null,
  });

  it("UPGRADE within the same category quotes the baseRateOverride delta once vehicle ids are passed", async () => {
    const ctx = makeCtx({ vehicleRates: overrideRates(80) });
    const caller = bookingSwapRouter.createCaller(ctx as never);
    const q = await caller.quoteDelta({
      bookingId: "b1",
      newCategoryId: "cat-A",
      incomingVehicleId: "v-new",
      reason: "UPGRADE",
    });
    expect(q.forcedZero).toBe(null);
    expect(q.direction).toBe("CHARGE");
    expect(q.deltaAmount).toBeGreaterThan(0);
  });

  it("DOWNGRADE within the same category quotes a REFUND for a cheaper-priced unit", async () => {
    const ctx = makeCtx({ vehicleRates: overrideRates(30) });
    const caller = bookingSwapRouter.createCaller(ctx as never);
    const q = await caller.quoteDelta({
      bookingId: "b1",
      newCategoryId: "cat-A",
      incomingVehicleId: "v-new",
      reason: "DOWNGRADE",
    });
    expect(q.forcedZero).toBe(null);
    expect(q.direction).toBe("REFUND");
    expect(q.deltaAmount).toBeLessThan(0);
  });

  it("LATERAL stays forced-zero even when the incoming unit has a baseRateOverride", async () => {
    const ctx = makeCtx({ vehicleRates: overrideRates(80) });
    const caller = bookingSwapRouter.createCaller(ctx as never);
    const q = await caller.quoteDelta({
      bookingId: "b1",
      newCategoryId: "cat-A",
      incomingVehicleId: "v-new",
      reason: "LATERAL",
    });
    expect(q.forcedZero).toBe("same-category");
    expect(q.deltaAmount).toBe(0);
    expect(q.direction).toBe("NONE");
  });
});

describe("bookingSwap.reconcileCreditTransfer", () => {
  it("decrements booking.amountPaid by the credited amount when the transfer is marked SUCCEEDED", async () => {
    const credit = {
      id: "p-credit",
      type: "MANUAL_CREDIT",
      status: "PENDING",
      bookingId: "b1",
      amount: new Prisma.Decimal(110),
      notes: "swap credit",
    };
    const models = {
      payment: {
        findUniqueOrThrow: vi.fn(async () => credit),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
          ...credit,
          ...data,
        })),
      },
      booking: { update: vi.fn(async () => ({})) },
      auditLog: { create: vi.fn(async () => null) },
    };
    const prisma = {
      ...models,
      $transaction: vi.fn(async (fn: (tx: typeof models) => unknown) => fn(models)),
    };
    const ctx = {
      prisma,
      user: { id: "mgr-1", role: "MANAGER" },
      session: { user: { id: "mgr-1", role: "MANAGER" } },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      reqId: "r1",
      _skipAudit: true,
    };
    const caller = bookingSwapRouter.createCaller(ctx as never);
    const res = await caller.reconcileCreditTransfer({
      paymentId: "p-credit",
      reference: "BT-2026-08-13",
    });
    expect(res).toMatchObject({ status: "SUCCEEDED" });
    expect(models.booking.update).toHaveBeenCalledWith({
      where: { id: "b1" },
      data: { amountPaid: { decrement: credit.amount } },
    });
  });

  it("rejects non-PENDING or non-MANUAL_CREDIT payments", async () => {
    const models = {
      payment: {
        findUniqueOrThrow: vi.fn(async () => ({
          id: "p1",
          type: "REFUND",
          status: "PENDING",
          bookingId: "b1",
          amount: new Prisma.Decimal(10),
          notes: null,
        })),
        update: vi.fn(),
      },
      booking: { update: vi.fn() },
      auditLog: { create: vi.fn(async () => null) },
    };
    const prisma = {
      ...models,
      $transaction: vi.fn(async (fn: (tx: typeof models) => unknown) => fn(models)),
    };
    const ctx = {
      prisma,
      user: { id: "mgr-1", role: "MANAGER" },
      session: { user: { id: "mgr-1", role: "MANAGER" } },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      reqId: "r1",
      _skipAudit: true,
    };
    const caller = bookingSwapRouter.createCaller(ctx as never);
    await expect(
      caller.reconcileCreditTransfer({ paymentId: "p1", reference: "BT-X" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(models.booking.update).not.toHaveBeenCalled();
  });
});
