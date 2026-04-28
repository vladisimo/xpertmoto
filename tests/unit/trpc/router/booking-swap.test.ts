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
  } = {},
) {
  const booking = opts.booking ?? {
    id: "b1",
    status: "ACTIVE",
    vehicleId: "v-old",
    categoryId: "cat-A",
    customerId: "cust1",
    returnDateTime: new Date("2026-06-10T10:00:00+10:00"),
  };
  const prisma = {
    booking: {
      findUniqueOrThrow: vi.fn(async () => booking),
      findUnique: vi.fn(async () => booking),
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
