/**
 * `customer.updateProfile` — passport-group write contract (NT-008).
 *
 * Profile forms post every field they render, so a blank passport box on
 * the wire means "this form had nothing to say", not "delete my passport".
 * Silently nulling the passport destroys verified identity data and breaks
 * LAMS eligibility for class-C customers whose only ID is a passport, so
 * removal must be asked for explicitly via `clearPassport`.
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
import { readPiiField } from "@/lib/customer-pii";

/** A customer with a passport already on file. */
const STORED_PASSPORT = {
  passportNumber: "PA1000000",
  passportNumberEnc: null,
  passportCountry: "AU",
  passportExpiry: new Date("2030-01-01"),
};

function makeCtx() {
  const prisma = {
    user: {
      findUnique: vi.fn().mockResolvedValue({
        firstName: "Sarah",
        lastName: "Smith",
        phone: null,
        dateOfBirth: null,
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
          licenceClass: "C",
          ...STORED_PASSPORT,
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

/** The `update` half of the single customerProfile.upsert, or `{}` when the
 *  resolver decided there was nothing to write. */
function writtenProfileData(ctx: ReturnType<typeof makeCtx>): Record<string, unknown> {
  const call = ctx.prisma.customerProfile.upsert.mock.calls[0]?.[0] as
    | { update: Record<string, unknown> }
    | undefined;
  return call?.update ?? {};
}

const PASSPORT_COLUMNS = [
  "passportNumber",
  "passportNumberEnc",
  "passportCountry",
  "passportExpiry",
] as const;

describe("customer.updateProfile — passport group", () => {
  let ctx: ReturnType<typeof makeCtx>;

  beforeEach(() => {
    ctx = makeCtx();
  });

  it("leaves a stored passport untouched when the form posts empty strings", async () => {
    const caller = customerRouter.createCaller(ctx as never);
    await caller.updateProfile({
      firstName: "Sarah",
      passportNumber: "",
      passportCountry: "",
      passportExpiry: "",
    });

    const written = writtenProfileData(ctx);
    for (const column of PASSPORT_COLUMNS) {
      expect(written).not.toHaveProperty(column);
    }
  });

  it("leaves a stored passport untouched when the fields are omitted entirely", async () => {
    const caller = customerRouter.createCaller(ctx as never);
    await caller.updateProfile({ licenceClass: "RE" });

    const written = writtenProfileData(ctx);
    expect(written).toMatchObject({ licenceClass: "RE" });
    for (const column of PASSPORT_COLUMNS) {
      expect(written).not.toHaveProperty(column);
    }
  });

  it("clears the whole passport group when clearPassport is set", async () => {
    const caller = customerRouter.createCaller(ctx as never);
    await caller.updateProfile({ clearPassport: true });

    expect(writtenProfileData(ctx)).toMatchObject({
      passportNumber: null,
      passportNumberEnc: null,
      passportCountry: null,
      passportExpiry: null,
    });
  });

  it("writes a supplied passport, encrypting the number", async () => {
    const caller = customerRouter.createCaller(ctx as never);
    await caller.updateProfile({
      passportNumber: "PB2000001",
      passportCountry: "NZ",
      passportExpiry: "2031-06-30",
    });

    const written = writtenProfileData(ctx);
    // Plaintext column is always nulled — the value lives in `*Enc`.
    expect(written.passportNumber).toBeNull();
    expect(readPiiField(null, written.passportNumberEnc)).toBe("PB2000001");
    expect(written.passportCountry).toBe("NZ");
    expect(written.passportExpiry).toBeInstanceOf(Date);
    expect((written.passportExpiry as Date).toISOString()).toContain("2031-06-30");
  });

  it("rejects a request that both clears and updates the passport", async () => {
    const caller = customerRouter.createCaller(ctx as never);
    await expect(
      caller.updateProfile({ clearPassport: true, passportNumber: "PB2000001" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    expect(ctx.prisma.customerProfile.upsert).not.toHaveBeenCalled();
  });

  it("still rejects a malformed passport number", async () => {
    const caller = customerRouter.createCaller(ctx as never);
    await expect(
      caller.updateProfile({ passportNumber: "no" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    expect(ctx.prisma.customerProfile.upsert).not.toHaveBeenCalled();
  });
});
