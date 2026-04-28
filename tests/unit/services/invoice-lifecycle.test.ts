import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Invoice-lifecycle service — exercises the issuance helpers without
 * actually rendering PDFs or hitting S3. The PDF render + upload
 * branch is mocked so the test focuses on the data-shape and
 * transaction logic. End-to-end PDF rendering is exercised manually
 * during deployment.
 */

const $queryRaw = vi.fn();
const invoiceFindFirst = vi.fn();
const invoiceFindUnique = vi.fn();
const invoiceCreate = vi.fn();
const invoiceUpdate = vi.fn();
const adjustmentNoteCreate = vi.fn();
const adjustmentNoteUpdate = vi.fn();
const adjustmentNoteFindUnique = vi.fn();
const bookingFindUnique = vi.fn();
const paymentFindUnique = vi.fn();
const paymentUpdate = vi.fn();
const settingsFindMany = vi.fn();

const $transaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
  return cb({
    $queryRaw,
    invoice: { create: invoiceCreate, update: invoiceUpdate },
    adjustmentNote: { create: adjustmentNoteCreate, update: adjustmentNoteUpdate },
    payment: { update: paymentUpdate },
  });
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: (cb: (tx: unknown) => Promise<unknown>) => $transaction(cb),
    invoice: {
      findFirst: (...args: unknown[]) => invoiceFindFirst(...args),
      findUnique: (...args: unknown[]) => invoiceFindUnique(...args),
      update: (...args: unknown[]) => invoiceUpdate(...args),
    },
    adjustmentNote: {
      findUnique: (...args: unknown[]) => adjustmentNoteFindUnique(...args),
      update: (...args: unknown[]) => adjustmentNoteUpdate(...args),
    },
    booking: {
      findUnique: (...args: unknown[]) => bookingFindUnique(...args),
    },
    payment: {
      findUnique: (...args: unknown[]) => paymentFindUnique(...args),
      update: (...args: unknown[]) => paymentUpdate(...args),
    },
    systemSetting: {
      findMany: (...args: unknown[]) => settingsFindMany(...args),
    },
  },
}));

vi.mock("@prisma/client", async () => {
  const actual = await vi.importActual<typeof import("@prisma/client")>("@prisma/client");
  return {
    ...actual,
    Prisma: {
      ...actual.Prisma,
      sql: (..._args: unknown[]) => ({ __sql: true }),
    },
  };
});

vi.mock("@/lib/storage", () => ({
  uploadFile: vi.fn(async () => ({ key: "fake/key", url: "https://cdn.test/fake.pdf" })),
}));

vi.mock("@/lib/pdf/tax-invoice", () => ({
  renderTaxInvoicePdf: vi.fn(async () => Buffer.from("PDF")),
}));
vi.mock("@/lib/pdf/adjustment-note", () => ({
  renderAdjustmentNotePdf: vi.fn(async () => Buffer.from("PDF")),
}));
vi.mock("@/lib/pdf/receipt", () => ({
  renderReceiptPdf: vi.fn(async () => Buffer.from("PDF")),
}));

beforeEach(() => {
  $queryRaw.mockReset().mockResolvedValue([{ nextValue: 1 }]);
  invoiceFindFirst.mockReset().mockResolvedValue(null);
  invoiceFindUnique.mockReset();
  invoiceCreate.mockReset();
  invoiceUpdate.mockReset().mockResolvedValue({});
  adjustmentNoteCreate.mockReset();
  adjustmentNoteUpdate.mockReset().mockResolvedValue({});
  adjustmentNoteFindUnique.mockReset();
  bookingFindUnique.mockReset();
  paymentFindUnique.mockReset();
  paymentUpdate.mockReset().mockResolvedValue({});
  settingsFindMany.mockReset().mockResolvedValue([]);
  $transaction.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("issueInvoiceForBooking", () => {
  it("returns the existing invoice if one is already issued (idempotent)", async () => {
    bookingFindUnique.mockResolvedValue({
      id: "b1",
      bookingReference: "SCT-1",
      customerId: "u1",
      totalAmount: { toString: () => "100.00" },
      pickupDateTime: new Date(),
      returnDateTime: new Date(),
      durationDays: 1,
      subtotal: { toString: () => "90.91" },
      discountAmount: { toString: () => "0" },
      insuranceTotal: { toString: () => "0" },
      deliveryFee: { toString: () => "0" },
      pricingSnapshot: {},
      category: { name: "50cc" },
      pickupDepot: { name: "Gold Coast" },
      returnDepot: { name: "Gold Coast" },
      addons: [],
      insurance: [],
      customer: { id: "u1", firstName: "A", lastName: "B", email: "a@b.com", phone: null, customerProfile: null },
    });
    invoiceFindFirst.mockResolvedValue({ id: "inv_existing", invoiceNumber: "INV-2026-000005" });

    const { issueInvoiceForBooking } = await import("@/server/services/invoice-lifecycle");
    const result = await issueInvoiceForBooking({ bookingId: "b1" });

    expect(result.id).toBe("inv_existing");
    expect(invoiceCreate).not.toHaveBeenCalled();
  });

  it("issues a new tax invoice when none exists", async () => {
    bookingFindUnique.mockResolvedValue({
      id: "b2",
      bookingReference: "SCT-2",
      customerId: "u1",
      totalAmount: 110,
      bondAmount: 200,
      amountPaid: 0,
      pickupDateTime: new Date("2026-04-01"),
      returnDateTime: new Date("2026-04-05"),
      durationDays: 4,
      subtotal: 100,
      discountAmount: 0,
      insuranceTotal: 0,
      deliveryFee: 0,
      pricingSnapshot: {},
      category: { name: "125cc" },
      pickupDepot: { name: "Byron" },
      returnDepot: { name: "Byron" },
      addons: [],
      insurance: [],
      customer: { id: "u1", firstName: "A", lastName: "B", email: "a@b.com", phone: null, customerProfile: null },
    });
    invoiceFindFirst.mockResolvedValueOnce(null); // idempotency check
    invoiceCreate.mockResolvedValue({
      id: "inv_new",
      invoiceNumber: "INV-2026-000001",
      bookingId: "b2",
    });
    // The post-create render path also reads the invoice back. Stub
    // `findUnique` so the render-and-persist helper doesn't blow up
    // even though we mocked the renderer.
    invoiceFindUnique.mockResolvedValue({
      id: "inv_new",
      invoiceNumber: "INV-2026-000001",
      issuedAt: new Date(),
      createdAt: new Date(),
      dueDate: null,
      lineItems: [],
      subtotal: 100,
      gstAmount: 10,
      totalAmount: 110,
      booking: {
        id: "b2",
        bookingReference: "SCT-2",
        amountPaid: 0,
        bondAmount: 200,
        customer: { firstName: "A", lastName: "B", email: "a@b.com", phone: null, customerProfile: null },
      },
    });

    const { issueInvoiceForBooking } = await import("@/server/services/invoice-lifecycle");
    const result = await issueInvoiceForBooking({ bookingId: "b2" });

    expect(invoiceCreate).toHaveBeenCalledTimes(1);
    expect(result.invoiceNumber).toBe("INV-2026-000001");
  });

  it("throws if the booking does not exist", async () => {
    bookingFindUnique.mockResolvedValue(null);
    const { issueInvoiceForBooking } = await import("@/server/services/invoice-lifecycle");
    await expect(issueInvoiceForBooking({ bookingId: "nope" })).rejects.toThrow(/not found/);
  });
});

describe("issueAdjustmentNote", () => {
  it("rejects issuance against a void invoice", async () => {
    invoiceFindUnique.mockResolvedValue({
      id: "inv_1",
      bookingId: "b1",
      customerId: "u1",
      status: "VOID",
    });
    const { issueAdjustmentNote } = await import("@/server/services/invoice-lifecycle");
    await expect(
      issueAdjustmentNote({
        invoiceId: "inv_1",
        type: "INCREASE",
        reason: "EXTENSION",
        description: "Test",
        lineItems: [
          { description: "x", quantity: 1, unitPrice: 10, totalPrice: 10, gstIncluded: true },
        ],
      }),
    ).rejects.toThrow(/VOID/);
  });

  it("creates an INCREASE adjustment with FY-scoped number and correct GST split", async () => {
    invoiceFindUnique.mockResolvedValue({
      id: "inv_1",
      bookingId: "b1",
      customerId: "u1",
      status: "SENT",
    });
    adjustmentNoteCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "adj_1",
      ...data,
    }));
    // After-create render lookup
    adjustmentNoteFindUnique.mockResolvedValue({
      id: "adj_1",
      adjustmentNumber: "ADJ-2026-000001",
      issuedAt: new Date(),
      type: "INCREASE",
      description: "Test",
      bookingId: "b1",
      lineItems: [],
      subtotal: 90.91,
      gstAmount: 9.09,
      totalAmount: 100,
      invoice: { invoiceNumber: "INV-2026-000099", issuedAt: new Date(), createdAt: new Date() },
      booking: { bookingReference: "SCT-9" },
      customer: {
        firstName: "A",
        lastName: "B",
        email: "a@b.com",
        phone: null,
        customerProfile: null,
      },
    });

    const { issueAdjustmentNote } = await import("@/server/services/invoice-lifecycle");
    const note = await issueAdjustmentNote({
      invoiceId: "inv_1",
      type: "INCREASE",
      reason: "EXTENSION",
      description: "2-day extension",
      lineItems: [
        {
          description: "Extension",
          quantity: 2,
          unitPrice: 50,
          totalPrice: 100,
          gstIncluded: true,
        },
      ],
      paymentId: "p1",
      issuedById: "u_staff",
    });

    expect(adjustmentNoteCreate).toHaveBeenCalledTimes(1);
    const arg = adjustmentNoteCreate.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(arg.data.type).toBe("INCREASE");
    expect(arg.data.reason).toBe("EXTENSION");
    expect(arg.data.invoiceId).toBe("inv_1");
    expect(arg.data.paymentId).toBe("p1");
    expect(arg.data.issuedById).toBe("u_staff");
    // Total = 100, GST should be ~9.09 and subtotal ~90.91 (round-half-up).
    expect(Number(arg.data.totalAmount)).toBeCloseTo(100, 2);
    expect(Number(arg.data.gstAmount)).toBeCloseTo(9.09, 2);
    expect(Number(arg.data.subtotal)).toBeCloseTo(90.91, 2);
    expect(note.id).toBe("adj_1");
  });
});

describe("findActiveInvoiceForBooking", () => {
  it("returns null when no live invoice exists", async () => {
    invoiceFindFirst.mockResolvedValue(null);
    const { findActiveInvoiceForBooking } = await import(
      "@/server/services/invoice-lifecycle"
    );
    const result = await findActiveInvoiceForBooking("b1");
    expect(result).toBeNull();
  });

  it("excludes VOID invoices from the lookup", async () => {
    invoiceFindFirst.mockResolvedValue({ id: "inv_1", invoiceNumber: "INV-2026-000001" });
    const { findActiveInvoiceForBooking } = await import(
      "@/server/services/invoice-lifecycle"
    );
    await findActiveInvoiceForBooking("b1");
    const arg = invoiceFindFirst.mock.calls[0]![0] as {
      where: { bookingId: string; status: { not: string } };
    };
    expect(arg.where.bookingId).toBe("b1");
    expect(arg.where.status).toEqual({ not: "VOID" });
  });
});

describe("tryIssueAdjustmentForBooking", () => {
  it("skips silently when the booking has no live invoice yet", async () => {
    invoiceFindFirst.mockResolvedValue(null);
    const { tryIssueAdjustmentForBooking } = await import(
      "@/server/services/invoice-lifecycle"
    );
    await expect(
      tryIssueAdjustmentForBooking({
        bookingId: "b1",
        type: "INCREASE",
        reason: "DAMAGE",
        description: "Test",
        lineItems: [
          { description: "x", quantity: 1, unitPrice: 10, totalPrice: 10, gstIncluded: true },
        ],
      }),
    ).resolves.toBeUndefined();
    expect(adjustmentNoteCreate).not.toHaveBeenCalled();
  });

  it("fires the customer auto-email with the adjustment-note attached", async () => {
    // Mock the dynamically-imported notification sender so we can spy on
    // the email send without pulling in its full dependency tree.
    const sendNotificationSpy = vi.fn().mockResolvedValue({
      results: [{ channel: "EMAIL", status: "SENT" }],
      logIds: [],
      notificationIds: [],
    });
    vi.doMock("@/server/services/notification-sender", () => ({
      sendNotification: sendNotificationSpy,
    }));
    vi.doMock("@/lib/utils", () => ({
      formatCurrency: (n: number) => `A$${n.toFixed(2)}`,
      formatDateTime: (d: Date) => d.toISOString(),
    }));

    invoiceFindUnique.mockResolvedValue({
      id: "inv_1",
      bookingId: "b1",
      customerId: "u1",
      status: "SENT",
    });
    adjustmentNoteCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "adj_99",
      ...data,
    }));
    // Two findUnique calls happen after create: render lookup, then the
    // auto-email lookup. Stub a single payload that satisfies both.
    adjustmentNoteFindUnique.mockResolvedValue({
      id: "adj_99",
      adjustmentNumber: "ADJ-2026-000099",
      issuedAt: new Date(),
      type: "INCREASE",
      reason: "DAMAGE",
      description: "Front fairing scuff",
      bookingId: "b1",
      issuedById: "u_staff",
      lineItems: [],
      subtotal: 90.91,
      gstAmount: 9.09,
      totalAmount: 100,
      invoice: { invoiceNumber: "INV-2026-000099", issuedAt: new Date(), createdAt: new Date() },
      booking: { bookingReference: "SCT-99" },
      customer: {
        id: "u1",
        firstName: "Alex",
        lastName: "Tester",
        email: "alex@example.com",
        phone: null,
        customerProfile: null,
      },
    });

    // Reset module cache so the new mocks take effect.
    vi.resetModules();
    const { issueAdjustmentNote } = await import("@/server/services/invoice-lifecycle");
    await issueAdjustmentNote({
      invoiceId: "inv_1",
      type: "INCREASE",
      reason: "DAMAGE",
      description: "Front fairing scuff",
      lineItems: [
        { description: "Damage", quantity: 1, unitPrice: 100, totalPrice: 100, gstIncluded: true },
      ],
      paymentId: null,
      issuedById: "u_staff",
    });

    expect(sendNotificationSpy).toHaveBeenCalledTimes(1);
    const callArg = sendNotificationSpy.mock.calls[0]![0] as {
      type: string;
      attachments: Array<{ kind: string; adjustmentNoteId: string }>;
      bookingId: string;
      userId: string;
    };
    expect(callArg.type).toBe("ADJUSTMENT_NOTE_ISSUED");
    expect(callArg.bookingId).toBe("b1");
    expect(callArg.userId).toBe("u1");
    expect(callArg.attachments).toEqual([
      { kind: "adjustment-note", adjustmentNoteId: "adj_99" },
    ]);

    vi.doUnmock("@/server/services/notification-sender");
    vi.doUnmock("@/lib/utils");
  });

  it("swallows render failures (non-blocking)", async () => {
    invoiceFindFirst.mockResolvedValue({ id: "inv_1", invoiceNumber: "INV-2026-000001" });
    invoiceFindUnique.mockResolvedValue({
      id: "inv_1",
      bookingId: "b1",
      customerId: "u1",
      status: "SENT",
    });
    adjustmentNoteCreate.mockRejectedValue(new Error("DB error"));

    const { tryIssueAdjustmentForBooking } = await import(
      "@/server/services/invoice-lifecycle"
    );
    // Must not throw — we intentionally swallow inside the helper.
    await expect(
      tryIssueAdjustmentForBooking({
        bookingId: "b1",
        type: "INCREASE",
        reason: "DAMAGE",
        description: "Test",
        lineItems: [
          { description: "x", quantity: 1, unitPrice: 10, totalPrice: 10, gstIncluded: true },
        ],
      }),
    ).resolves.toBeUndefined();
  });
});
