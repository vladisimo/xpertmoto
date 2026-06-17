/**
 * customer.extract{Licence,Passport}FromImage are thin pass-throughs over the
 * vision service. They must surface the new `documentType` classification in
 * their result and must NOT reject on a wrong-type result — the customer UI
 * decides how to handle a mismatch (accept the other ID type with a nudge;
 * reject only a genuine non-ID before it is stored). The strict server-side
 * gate lives in staffCustomer.detectDocument, tested separately.
 */
import { describe, expect, it, vi } from "vitest";

const extractLicenceData = vi.fn();
const extractPassportData = vi.fn();

vi.mock("@/lib/storage", () => ({
  downloadFile: vi.fn().mockResolvedValue(Buffer.from([1, 2, 3])),
}));

vi.mock("@/server/services/document-extract", () => ({
  extractLicenceData: (...args: unknown[]) => extractLicenceData(...args),
  extractPassportData: (...args: unknown[]) => extractPassportData(...args),
}));

// Audit is mocked so the auto-audit middleware doesn't need a real prisma.
vi.mock("@/server/services/audit", () => ({
  writeAudit: vi.fn().mockResolvedValue(undefined),
  writeAuditAsync: vi.fn(),
  skipAutoAudit: vi.fn(),
  captureCustomerId: vi.fn(),
  readCapturedCustomerId: vi.fn(),
}));

import { customerRouter } from "@/server/trpc/router/customer";

function makeCtx() {
  return {
    prisma: {},
    user: { id: "cust_1", role: "CUSTOMER" },
    session: { user: { id: "cust_1", role: "CUSTOMER", depotId: null } },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    reqId: "r1",
    ipAddress: "203.0.113.5",
    userAgent: "vitest",
  };
}

describe("customer.extractLicenceFromImage", () => {
  it("passes a successful licence result straight through", async () => {
    extractLicenceData.mockResolvedValue({
      documentType: "DRIVERS_LICENCE",
      licenceNumber: "12345678",
      confidence: 0.95,
    });
    const caller = customerRouter.createCaller(makeCtx() as never);

    const r = await caller.extractLicenceFromImage({ imageKey: "drivers/cust_1/x.jpg" });
    expect(r.documentType).toBe("DRIVERS_LICENCE");
    expect(r.licenceNumber).toBe("12345678");
  });

  it("does NOT throw on a wrong-type result — it returns the classification", async () => {
    extractLicenceData.mockResolvedValue({ documentType: "PASSPORT", confidence: 0 });
    const caller = customerRouter.createCaller(makeCtx() as never);

    const r = await caller.extractLicenceFromImage({ imageKey: "drivers/cust_1/x.jpg" });
    expect(r.documentType).toBe("PASSPORT");
    expect(r.confidence).toBe(0);
    expect(r.licenceNumber).toBeUndefined();
  });
});

describe("customer.extractPassportFromImage", () => {
  it("surfaces an OTHER (non-ID) classification without throwing", async () => {
    extractPassportData.mockResolvedValue({ documentType: "OTHER", confidence: 0 });
    const caller = customerRouter.createCaller(makeCtx() as never);

    const r = await caller.extractPassportFromImage({ imageKey: "drivers/cust_1/p.jpg" });
    expect(r.documentType).toBe("OTHER");
    expect(r.confidence).toBe(0);
  });
});
