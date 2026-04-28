/**
 * Ensures `customer.recordDocumentAccess` enforces ownership and emits an
 * audit row scoped to the customer so the event surfaces on the staff
 * Activity tab.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";

vi.mock("@/lib/storage", () => ({
  downloadFile: vi.fn(),
  getSignedUrl: vi.fn(async (key: string) => `https://signed.example/${key}`),
}));

vi.mock("@/server/services/stripe-customer", () => ({
  createSetupIntentForUser: vi.fn(),
  persistDefaultPaymentMethod: vi.fn(),
}));

vi.mock("@/server/services/notification-sender", () => ({
  sendNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/branding", () => ({
  getBranding: vi.fn().mockResolvedValue({ siteName: "Test" }),
}));

vi.mock("@/server/services/audit", () => ({
  writeAudit: vi.fn().mockResolvedValue(undefined),
  writeAuditAsync: vi.fn(),
  skipAutoAudit: vi.fn((ctx: unknown) => {
    (ctx as { skipAutoAudit?: boolean }).skipAutoAudit = true;
  }),
  captureCustomerId: vi.fn(),
  readCapturedCustomerId: vi.fn(),
}));

import { customerRouter } from "@/server/trpc/router/customer";
import { writeAuditAsync } from "@/server/services/audit";

const writeMock = writeAuditAsync as unknown as ReturnType<typeof vi.fn>;

type AuditCall = {
  userId?: string;
  action?: string;
  entity?: string;
  entityId?: string;
  ipAddress?: string;
  userAgent?: string;
  newData?: Record<string, unknown>;
};

function makeCtx(opts: {
  doc?: {
    id: string;
    customerId: string;
    type: string;
    fileUrl: string;
    label: string | null;
  } | null;
} = {}) {
  const prisma = {
    customerDocument: {
      findFirst: vi.fn().mockResolvedValue(opts.doc ?? null),
    },
  };
  return {
    prisma,
    user: { id: "cust_1", role: "CUSTOMER" },
    session: { user: { id: "cust_1", role: "CUSTOMER", depotId: null } },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    reqId: "r-xyz",
    ipAddress: "203.0.113.5",
    userAgent: "vitest",
  };
}

describe("customer.recordDocumentAccess", () => {
  beforeEach(() => {
    writeMock.mockReset();
  });

  it("throws NOT_FOUND when the document doesn't exist", async () => {
    const ctx = makeCtx({ doc: null });
    const caller = customerRouter.createCaller(ctx as never);
    await expect(
      caller.recordDocumentAccess({ documentId: "missing" }),
    ).rejects.toBeInstanceOf(TRPCError);
  });

  it("throws NOT_FOUND when the document belongs to another customer", async () => {
    // findFirst filters by customerId — another user's doc resolves to null.
    const ctx = makeCtx({ doc: null });
    const caller = customerRouter.createCaller(ctx as never);
    await expect(
      caller.recordDocumentAccess({ documentId: "someone-elses-doc" }),
    ).rejects.toBeInstanceOf(TRPCError);

    // And the where clause must be scoped to the current user.
    const where = (
      ctx.prisma.customerDocument.findFirst as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[0]?.[0]?.where;
    expect(where).toMatchObject({ customerId: "cust_1" });
  });

  it("writes an audit row with action=document.viewed and customer scope", async () => {
    const ctx = makeCtx({
      doc: {
        id: "doc_abc",
        customerId: "cust_1",
        type: "LICENCE_FRONT",
        fileUrl: "drivers/cust_1/2026-04/front.jpg",
        label: "Driver licence (front)",
      },
    });
    const caller = customerRouter.createCaller(ctx as never);
    const result = await caller.recordDocumentAccess({ documentId: "doc_abc" });

    expect(result.url).toBe(
      "https://signed.example/drivers/cust_1/2026-04/front.jpg",
    );
    const entry = writeMock.mock.calls[0]?.[1] as AuditCall | undefined;
    expect(entry).toBeDefined();
    expect(entry!.action).toBe("document.viewed");
    expect(entry!.entity).toBe("User");
    expect(entry!.entityId).toBe("cust_1");
    expect(entry!.ipAddress).toBe("203.0.113.5");
    expect(entry!.userAgent).toBe("vitest");
    expect(entry!.newData).toMatchObject({
      documentId: "doc_abc",
      type: "LICENCE_FRONT",
      reason: "view",
    });
  });

  it("writes action=document.downloaded when reason is 'download'", async () => {
    const ctx = makeCtx({
      doc: {
        id: "doc_pdf",
        customerId: "cust_1",
        type: "CONSENT_TERMS",
        fileUrl: "https://public.example/terms.pdf",
        label: null,
      },
    });
    const caller = customerRouter.createCaller(ctx as never);
    await caller.recordDocumentAccess({
      documentId: "doc_pdf",
      reason: "download",
    });
    const entry = writeMock.mock.calls[0]?.[1] as AuditCall;
    expect(entry.action).toBe("document.downloaded");
  });

  it("passes through absolute URLs unchanged", async () => {
    const ctx = makeCtx({
      doc: {
        id: "doc_pdf",
        customerId: "cust_1",
        type: "CONSENT_TERMS",
        fileUrl: "https://already.absolute/x.pdf",
        label: null,
      },
    });
    const caller = customerRouter.createCaller(ctx as never);
    const { url } = await caller.recordDocumentAccess({ documentId: "doc_pdf" });
    expect(url).toBe("https://already.absolute/x.pdf");
  });
});
