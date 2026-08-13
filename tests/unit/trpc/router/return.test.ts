import { describe, expect, it, vi } from "vitest";
import { returnRouter } from "../../../../src/server/trpc/router/return";

/**
 * Smoke tests for the return router — enough to catch regressions in the
 * authorization chain and wiring of the customer-portal read procedure.
 */

type Caller = ReturnType<typeof returnRouter.createCaller>;

function makeCtx(overrides: {
  userId?: string;
  role?: "CUSTOMER" | "STAFF" | "MANAGER" | "ADMIN" | "SUPER_ADMIN";
  assessments?: unknown[];
  assessment?: unknown;
} = {}) {
  const prisma = {
    returnAssessment: {
      findUnique: vi.fn().mockResolvedValue(overrides.assessment ?? null),
      findMany: vi.fn().mockResolvedValue(overrides.assessments ?? []),
    },
  };
  const user = {
    id: overrides.userId ?? "cust1",
    role: overrides.role ?? "CUSTOMER",
  };
  return {
    prisma,
    // Role for staffProcedure gates comes from session.user.role.
    session: { user },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    reqId: "r1",
  } as unknown as Parameters<Caller["forCustomer"]>[0];
}

describe("return.forCustomer", () => {
  it("returns an empty array for non-customer roles", async () => {
    const ctx = makeCtx({ role: "STAFF" });
    const c = returnRouter.createCaller(ctx as never);
    const out = await c.forCustomer();
    expect(out).toEqual([]);
  });

  it("fetches the customer's own SIGNED / FINALISED assessments", async () => {
    const fake = [{ id: "ra1", status: "SIGNED" }];
    const ctx = makeCtx({ assessments: fake });
    const c = returnRouter.createCaller(ctx as never);
    const out = await c.forCustomer();
    expect(out).toEqual(fake);
  });
});

describe("return.byBooking", () => {
  it("returns null when no assessment exists for the booking", async () => {
    const ctx = makeCtx({ role: "STAFF", userId: "staff1" });
    const c = returnRouter.createCaller(ctx as never);
    const out = await c.byBooking({ bookingId: "b1" });
    expect(out).toBeNull();
  });
});

describe("return.upsertDamageCharge — issue linkage", () => {
  function staffCtx(prisma: Record<string, unknown>) {
    const user = { id: "staff1", role: "STAFF" as const, depotId: "depot-a" };
    return {
      prisma,
      user,
      session: { user },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      reqId: "r1",
      _skipAudit: true,
    } as unknown as Parameters<Caller["upsertDamageCharge"]>[0];
  }

  it("links the charge to its inspection issue and derives the evidence photo", async () => {
    const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "dc1", ...data }));
    const prisma = {
      returnAssessment: {
        findUniqueOrThrow: vi.fn(async () => ({
          id: "ra1",
          status: "DRAFT",
          inspectionId: "insp1",
          bookingId: "b1",
          booking: { vehicleId: "v1" },
          inspection: { id: "insp1" },
        })),
      },
      inspectionIssue: {
        findUnique: vi.fn(async () => ({
          inspectionId: "insp1",
          inspectionPhoto: { url: "https://cdn/x.jpg" },
          inspection: { bookingId: "b1", purpose: "CHECK_IN", status: "COMPLETED" },
        })),
      },
      damageCharge: { create },
    };
    const c = returnRouter.createCaller(staffCtx(prisma) as never);
    await c.upsertDamageCharge({
      assessmentId: "ra1",
      inspectionIssueId: "iss1",
      description: "Broken mirror",
      severity: "MAJOR",
      resolution: "STANDARD",
      amount: 120,
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]?.[0].data).toMatchObject({
      inspectionIssueId: "iss1",
      photoUrls: ["https://cdn/x.jpg"],
    });
  });

  it("rejects an issue that belongs to a different inspection", async () => {
    const create = vi.fn();
    const prisma = {
      returnAssessment: {
        findUniqueOrThrow: vi.fn(async () => ({
          id: "ra1",
          status: "DRAFT",
          inspectionId: "insp1",
          bookingId: "b1",
          booking: { vehicleId: "v1" },
          inspection: { id: "insp1" },
        })),
      },
      inspectionIssue: {
        findUnique: vi.fn(async () => ({
          inspectionId: "OTHER",
          inspectionPhoto: null,
          inspection: { bookingId: "b1", purpose: "CHECK_IN", status: "COMPLETED" },
        })),
      },
      damageCharge: { create },
    };
    const c = returnRouter.createCaller(staffCtx(prisma) as never);
    await expect(
      c.upsertDamageCharge({
        assessmentId: "ra1",
        inspectionIssueId: "issX",
        description: "x",
        severity: "MINOR",
        resolution: "STANDARD",
        amount: 10,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(create).not.toHaveBeenCalled();
  });

  it("accepts an issue from a COMPLETED SWAP_OUT inspection on the same booking (PR7)", async () => {
    const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "dc2", ...data }));
    const prisma = {
      returnAssessment: {
        findUniqueOrThrow: vi.fn(async () => ({
          id: "ra1",
          status: "DRAFT",
          inspectionId: "insp-return",
          bookingId: "b1",
          booking: { vehicleId: "v1" },
          inspection: { id: "insp-return" },
        })),
      },
      inspectionIssue: {
        findUnique: vi.fn(async () => ({
          inspectionId: "insp-swapout",
          inspectionPhoto: null,
          inspection: { bookingId: "b1", purpose: "SWAP_OUT", status: "COMPLETED" },
        })),
      },
      damageCharge: { create },
    };
    const c = returnRouter.createCaller(staffCtx(prisma) as never);
    await c.upsertDamageCharge({
      assessmentId: "ra1",
      inspectionIssueId: "iss-swap",
      description: "Scrape recorded at swap-out",
      severity: "MODERATE",
      resolution: "STANDARD",
      amount: 80,
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]?.[0].data).toMatchObject({
      inspectionIssueId: "iss-swap",
      amount: 80,
    });
  });

  it("still rejects a SWAP_OUT issue that belongs to a different booking", async () => {
    const create = vi.fn();
    const prisma = {
      returnAssessment: {
        findUniqueOrThrow: vi.fn(async () => ({
          id: "ra1",
          status: "DRAFT",
          inspectionId: "insp-return",
          bookingId: "b1",
          booking: { vehicleId: "v1" },
          inspection: { id: "insp-return" },
        })),
      },
      inspectionIssue: {
        findUnique: vi.fn(async () => ({
          inspectionId: "insp-foreign",
          inspectionPhoto: null,
          inspection: { bookingId: "b-OTHER", purpose: "SWAP_OUT", status: "COMPLETED" },
        })),
      },
      damageCharge: { create },
    };
    const c = returnRouter.createCaller(staffCtx(prisma) as never);
    await expect(
      c.upsertDamageCharge({
        assessmentId: "ra1",
        inspectionIssueId: "iss-foreign",
        description: "x",
        severity: "MINOR",
        resolution: "STANDARD",
        amount: 10,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(create).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Area 1 — excess-cap enforcement in finalise / closeOutQuote. The heavy
// side-effects (PDF render, S3 upload, RFC3161 timestamp, branding lookup,
// staff-task auto-close) are stubbed; the excess figures are pinned via the
// excess-service mock while the real applyExcessCap math runs.
// ---------------------------------------------------------------------------

const uploadFileMock = vi.fn(async () => ({ url: "https://cdn/return.pdf", key: "returns/k" }));
vi.mock("@/lib/storage", () => ({
  uploadFile: () => uploadFileMock(),
}));
vi.mock("@/lib/agreement/pdf/return-assessment-pdf", () => ({
  renderReturnAssessmentPdf: vi.fn(async () => Buffer.from("pdf")),
}));
vi.mock("@/lib/agreement/timestamp", () => ({
  requestTimestamp: vi.fn(async () => ({ ok: false, tsaUrl: "tsa", error: "skipped" })),
  sha256Buffer: vi.fn(() => "deadbeef"),
}));
vi.mock("@/lib/branding", () => ({
  getBranding: vi.fn(async () => ({
    abn: "11 111 111 111",
    siteName: "X",
    legalName: "X Pty Ltd",
    supportEmail: "support@x.example",
  })),
}));
vi.mock("@/server/services/staff-tasks", () => ({
  autoCloseByTarget: vi.fn(async () => undefined),
}));
const getBookingExcessMock = vi.fn();
const getDamageLiabilityUsedMock = vi.fn();
vi.mock("@/server/services/excess", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../src/server/services/excess")>();
  return {
    ...actual,
    getBookingExcess: (...a: unknown[]) => getBookingExcessMock(...a),
    getDamageLiabilityUsed: (...a: unknown[]) => getDamageLiabilityUsedMock(...a),
  };
});

const ALL_PAGE_IDS = ["cover", "condition", "charges", "fees", "quote-ack", "settlement"];

type ChargeFixture = {
  id: string;
  description: string;
  severity: string;
  resolution: string;
  amount: number;
  quoteCapAmount: number | null;
  damageTariff: null;
  inspectionIssueId: null;
  photoUrls: string[];
};

function makeFinaliseHarness(over: {
  damageCharges: ChargeFixture[];
  excess: number;
  used: number;
}) {
  getBookingExcessMock.mockResolvedValue({
    excess: over.excess,
    source: "BOOKING_INSURANCE",
    tierName: "Basic",
  });
  getDamageLiabilityUsedMock.mockResolvedValue(over.used);

  const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const assessment = {
    id: "ra1",
    assessmentNumber: "RTN-BK1-v1",
    version: 1,
    status: "DRAFT",
    bookingId: "b1",
    inspectionId: "insp1",
    customerSignatureUrl: "https://cdn/sig-c.png",
    staffSignatureUrl: "https://cdn/sig-s.png",
    customerInitialsUrl: "https://cdn/init.png",
    pagesInitialled: ALL_PAGE_IDS.map((pageId) => ({
      pageId,
      initialsUrl: "https://cdn/init.png",
      signedAt: new Date().toISOString(),
    })),
    booking: {
      id: "b1",
      bookingReference: "BK1",
      customerId: "cust1",
      balanceDue: 0,
      bondAmount: 500,
      pickupDateTime: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      returnDateTime: future,
      actualReturnDateTime: null,
      pickupOdometerKm: 100,
      customer: { firstName: "Jo", lastName: "Renter", email: "jo@example.com" },
      vehicle: { internalCode: "MTB-1", rego: "REG01", make: "Honda", model: "CB125" },
      category: { name: "Scooter", baseDailyRate: 80 },
      pickupDepot: { name: "Depot A" },
      returnDepot: { name: "Depot A" },
    },
    inspection: { id: "insp1", fuelLevel: 100, odometerKm: 400, photos: [], issues: [] },
    staff: { firstName: "Sam", lastName: "Staff" },
    damageCharges: over.damageCharges,
  };

  const paymentCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    id: `pay-${data.reference}`,
    ...data,
  }));
  const damageChargeUpdate = vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({
    id: where.id,
    ...data,
  }));
  const bookingUpdate = vi.fn(async () => ({}));
  const bookingNoteCreate = vi.fn(async () => ({}));
  const returnAssessmentUpdate = vi.fn(async () => ({}));

  const prisma = {
    returnAssessment: {
      findUniqueOrThrow: vi.fn(async () => assessment),
      update: returnAssessmentUpdate,
    },
    inspection: {
      findFirst: vi.fn(async () => ({ fuelLevel: 100 })),
      update: vi.fn(async () => ({})),
    },
    payment: {
      aggregate: vi.fn(async () => ({ _sum: { amount: 0 } })),
      create: paymentCreate,
    },
    bondLedger: { findUnique: vi.fn(async () => null), update: vi.fn() },
    damageCharge: {
      update: damageChargeUpdate,
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    booking: { update: bookingUpdate },
    bookingNote: { create: bookingNoteCreate },
    auditLog: { create: vi.fn(async () => ({})) },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
  };
  const user = { id: "staff1", role: "STAFF" as const };
  const ctx = {
    prisma,
    user,
    session: { user },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    reqId: "r1",
    _skipAudit: true,
  } as unknown as Parameters<Caller["finalise"]>[0];
  return { ctx, prisma, paymentCreate, damageChargeUpdate, bookingUpdate, bookingNoteCreate, returnAssessmentUpdate };
}

describe("return.finalise — excess cap (Area 1)", () => {
  it("clamps STANDARD lines in creation order and clamps QUOTE_PENDING caps to the leftover headroom", async () => {
    // excess 1000, 800 already used → 200 headroom. c1 (150) fits, c2 (100)
    // reduces to 50, and the quote acknowledgement (500) clamps to 0.
    const h = makeFinaliseHarness({
      excess: 1000,
      used: 800,
      damageCharges: [
        { id: "c1", description: "Mirror", severity: "MINOR", resolution: "STANDARD", amount: 150, quoteCapAmount: null, damageTariff: null, inspectionIssueId: null, photoUrls: [] },
        { id: "c2", description: "Panel", severity: "MODERATE", resolution: "STANDARD", amount: 100, quoteCapAmount: null, damageTariff: null, inspectionIssueId: null, photoUrls: [] },
        { id: "c3", description: "Frame", severity: "MAJOR", resolution: "QUOTE_PENDING", amount: 0, quoteCapAmount: 500, damageTariff: null, inspectionIssueId: null, photoUrls: [] },
      ],
    });
    const c = returnRouter.createCaller(h.ctx as never);
    const out = await c.finalise({ assessmentId: "ra1" });

    expect(out.totalDueNow).toBe(200);
    expect(out.pendingQuoteCap).toBe(0);

    const created = h.paymentCreate.mock.calls.map(
      (call) => (call[0] as { data: Record<string, unknown> }).data,
    );
    expect(created.find((d) => d.reference === "DMG-c1")).toMatchObject({ amount: 150 });
    expect(created.find((d) => d.reference === "DMG-c2")).toMatchObject({ amount: 50 });

    // The charged (post-cap) figures land on the DamageCharge rows so the
    // per-hire "used" aggregate stays truthful.
    const updates = h.damageChargeUpdate.mock.calls.map((call) => call[0] as { where: { id: string }; data: Record<string, unknown> });
    expect(updates.find((u) => u.where.id === "c2")?.data).toMatchObject({ amount: 50, status: "CONFIRMED" });
    expect(updates.find((u) => u.where.id === "c3")?.data).toEqual({ quoteCapAmount: 0 });

    // Cap note lands on the booking; only the capped residual enters balanceDue.
    expect(h.bookingNoteCreate).toHaveBeenCalledTimes(1);
    expect(h.bookingUpdate).toHaveBeenCalledWith({
      where: { id: "b1" },
      data: { balanceDue: { increment: 200 } },
    });
    // EXCESS_CAP_APPLIED audit row records pre-cap vs charged.
    const audits = (h.prisma.auditLog.create as ReturnType<typeof vi.fn>).mock.calls.map(
      (call) => (call[0] as { data: Record<string, unknown> }).data,
    );
    expect(audits.some((a) => a.action === "EXCESS_CAP_APPLIED")).toBe(true);
  });

  it("zeroes later STANDARD lines outright when the cap is already exhausted", async () => {
    const h = makeFinaliseHarness({
      excess: 1000,
      used: 1000,
      damageCharges: [
        { id: "c1", description: "Mirror", severity: "MINOR", resolution: "STANDARD", amount: 100, quoteCapAmount: null, damageTariff: null, inspectionIssueId: null, photoUrls: [] },
      ],
    });
    const c = returnRouter.createCaller(h.ctx as never);
    const out = await c.finalise({ assessmentId: "ra1" });

    expect(out.totalDueNow).toBe(0);
    expect(h.paymentCreate).not.toHaveBeenCalled();
    const updates = h.damageChargeUpdate.mock.calls.map((call) => call[0] as { where: { id: string }; data: Record<string, unknown> });
    expect(updates.find((u) => u.where.id === "c1")?.data).toMatchObject({ amount: 0, status: "CONFIRMED" });
    // Nothing owed → balanceDue untouched.
    expect(h.bookingUpdate).not.toHaveBeenCalled();
  });
});

describe("return.closeOutQuote — excess cap (Area 1)", () => {
  it("bills min(final, acknowledged cap, remaining excess headroom)", async () => {
    getBookingExcessMock.mockResolvedValue({ excess: 1000, source: "BOOKING_INSURANCE", tierName: "Basic" });
    getDamageLiabilityUsedMock.mockResolvedValue(900);

    const paymentCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "pay-1",
      reference: data.reference,
      ...data,
    }));
    const damageChargeUpdate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "cq1", ...data }));
    const bookingUpdate = vi.fn(async () => ({}));
    const prisma = {
      damageCharge: {
        findUniqueOrThrow: vi.fn(async () => ({
          id: "cq1",
          resolution: "QUOTE_PENDING",
          status: "PROVISIONAL",
          capturedPaymentId: null,
          quoteCapAmount: 500,
          description: "Frame repair",
          returnAssessment: {
            id: "ra1",
            status: "SIGNED",
            bookingId: "b1",
            booking: { customerId: "cust1", bookingReference: "BK1" },
          },
        })),
        update: damageChargeUpdate,
      },
      payment: { create: paymentCreate },
      booking: { update: bookingUpdate },
      auditLog: { create: vi.fn(async () => ({})) },
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
    };
    const user = { id: "staff1", role: "STAFF" as const };
    const ctx = {
      prisma,
      user,
      session: { user },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      reqId: "r1",
      _skipAudit: true,
    } as unknown as Parameters<Caller["closeOutQuote"]>[0];

    const c = returnRouter.createCaller(ctx as never);
    // Final quote 400 is under the acknowledged 500 cap, but only 100 of
    // excess headroom remains → bill 100.
    await c.closeOutQuote({ damageChargeId: "cq1", finalAmount: 400 });

    expect(paymentCreate).toHaveBeenCalledTimes(1);
    expect((paymentCreate.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data).toMatchObject({
      reference: "DMG-cq1",
      amount: 100,
    });
    expect(damageChargeUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ amount: 100, status: "CONFIRMED" }) }),
    );
    expect(bookingUpdate).toHaveBeenCalledWith({
      where: { id: "b1" },
      data: { balanceDue: { increment: 100 } },
    });
  });
});
