/**
 * Verifies that `customer.updateProfile` snapshots the previous values of
 * every field about to change and emits a single audit row carrying both
 * `previousData` and `newData`. The OCR-driven licence overwrite flow on
 * /dashboard/profile and /dashboard/documents relies on this behaviour for
 * the activity diff to be reconstructable.
 *
 * Note on assertion strategy: the auto-audit tRPC middleware also calls
 * `writeAuditAsync` (with no previousData). To distinguish the rich
 * resolver-emitted row from the bare middleware row, we look at the call
 * whose entry carries `previousData`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/storage", () => ({
  downloadFile: vi.fn(),
  getSignedUrl: vi.fn(),
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

// Important: skipAutoAudit must actually mutate ctx so the real audit
// middleware respects it — otherwise the middleware fires its own row and
// the assertions about "no auto row alongside the rich one" fail.
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

type AuditCall = { previousData?: unknown; newData?: unknown; action?: string; status?: string };

function richCalls(): AuditCall[] {
  return writeMock.mock.calls
    .map((c) => c[1] as AuditCall)
    .filter((entry) => entry.previousData !== undefined);
}

function autoCalls(): AuditCall[] {
  return writeMock.mock.calls
    .map((c) => c[1] as AuditCall)
    .filter((entry) => entry.previousData === undefined);
}

function makeCtx(opts: {
  prevUser?: Record<string, unknown>;
  prevProfile?: Record<string, unknown>;
} = {}) {
  const prisma = {
    user: {
      findUnique: vi.fn().mockResolvedValue({
        firstName: "Old First",
        lastName: "Old Last",
        phone: null,
        dateOfBirth: null,
        ...(opts.prevUser ?? {}),
        customerProfile: {
          addressLine1: null,
          addressLine2: null,
          suburb: null,
          state: null,
          postcode: null,
          country: null,
          emergencyContactName: null,
          emergencyContactPhone: null,
          emergencyContactRelationship: null,
          marketingOptIn: false,
          marketingSmsOptIn: false,
          licenceNumber: null,
          licenceNumberEnc: null,
          licenceState: null,
          licenceExpiry: null,
          licenceClass: null,
          passportNumber: null,
          passportNumberEnc: null,
          passportCountry: null,
          passportExpiry: null,
          ...(opts.prevProfile ?? {}),
        },
      }),
      update: vi.fn().mockResolvedValue(undefined),
    },
    customerProfile: {
      update: vi.fn().mockResolvedValue(undefined),
      upsert: vi.fn().mockResolvedValue(undefined),
    },
  };
  return {
    prisma,
    user: { id: "cust_1", role: "CUSTOMER" },
    session: { user: { id: "cust_1", role: "CUSTOMER", depotId: null } },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    reqId: "r1",
    ipAddress: "127.0.0.1",
    userAgent: "vitest",
  };
}

describe("customer.updateProfile — audit snapshot", () => {
  beforeEach(() => {
    writeMock.mockReset();
  });

  it("captures previousData when OCR overwrites a legacy plaintext licence number", async () => {
    const ctx = makeCtx({
      prevProfile: { licenceNumber: "OLD-123", licenceState: "QLD" },
    });
    const caller = customerRouter.createCaller(ctx as never);
    await caller.updateProfile({ licenceNumber: "NEW-987", licenceState: "NSW" });

    const rich = richCalls();
    expect(rich).toHaveLength(1);
    const entry = rich[0]!;
    expect(entry.action).toBe("customer.updateProfile");
    expect(entry.previousData).toMatchObject({
      licenceNumber: "OLD-123",
      licenceState: "QLD",
    });
    expect(entry.newData).toMatchObject({
      licenceNumber: "NEW-987",
      licenceState: "NSW",
    });
    // The bare auto-audit row must not also fire — that would double up
    // the activity feed for the same change.
    expect(autoCalls()).toHaveLength(0);
  });

  it("snapshots User-level fields too when name changes", async () => {
    const ctx = makeCtx({ prevUser: { firstName: "Alice", lastName: "Smith" } });
    const caller = customerRouter.createCaller(ctx as never);
    await caller.updateProfile({ firstName: "Alicia" });

    const rich = richCalls();
    expect(rich).toHaveLength(1);
    expect(rich[0]!.previousData).toEqual({ firstName: "Alice" });
    expect(rich[0]!.newData).toEqual({ firstName: "Alicia" });
  });

  it("does not emit a rich audit row when nothing actually changes", async () => {
    const ctx = makeCtx();
    const caller = customerRouter.createCaller(ctx as never);
    await caller.updateProfile({});

    expect(richCalls()).toHaveLength(0);
  });

  it("falls through to the auto-audit FAILURE row when the resolver throws on bad input", async () => {
    const ctx = makeCtx();
    const caller = customerRouter.createCaller(ctx as never);
    await expect(
      caller.updateProfile({ dateOfBirth: "not-a-date" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    expect(richCalls()).toHaveLength(0);
    expect(autoCalls().some((c) => c.status === "FAILURE")).toBe(true);
  });
});
