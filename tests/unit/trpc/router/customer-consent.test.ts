import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn().mockResolvedValue({ ok: true, remaining: 10, resetAt: 0 }),
}));

vi.mock("@/server/services/audit", () => ({
  writeAudit: vi.fn().mockResolvedValue(undefined),
  writeAuditAsync: vi.fn(),
  skipAutoAudit: vi.fn(),
  captureCustomerId: vi.fn(),
  readCapturedCustomerId: vi.fn(),
}));

import { customerRouter } from "@/server/trpc/router/customer";
import { TERMS_VERSION, PRIVACY_VERSION } from "@/lib/consent-versions";

type Caller = ReturnType<typeof customerRouter.createCaller>;

function makeCtx(overrides: {
  profile?: Record<string, unknown> | null;
  userId?: string;
} = {}) {
  const profile = overrides.profile === undefined
    ? {
        termsAcceptedAt: null,
        termsVersion: null,
        privacyAcceptedAt: null,
        privacyVersion: null,
      }
    : overrides.profile;
  const prisma = {
    customerProfile: {
      findUnique: vi.fn().mockResolvedValue(profile),
      update: vi.fn().mockResolvedValue({}),
    },
  };
  return {
    prisma,
    ipAddress: "127.0.0.1",
    userAgent: "test",
    reqId: "r1",
    session: {
      user: {
        id: overrides.userId ?? "u_cust",
        role: "CUSTOMER",
        depotId: null,
      },
    },
    headers: undefined,
  } as unknown as Parameters<Caller["consentStatus"]>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("customer.consentStatus", () => {
  it("reports both flags false for a profile with NULL consent timestamps", async () => {
    const ctx = makeCtx();
    const c = customerRouter.createCaller(ctx as never);
    const out = await c.consentStatus();
    expect(out).toEqual({
      hasTerms: false,
      hasPrivacy: false,
      termsVersion: null,
      privacyVersion: null,
      currentTermsVersion: TERMS_VERSION,
      currentPrivacyVersion: PRIVACY_VERSION,
    });
  });

  it("reports both flags true when the profile holds the current version", async () => {
    const ctx = makeCtx({
      profile: {
        termsAcceptedAt: new Date("2026-01-01T00:00:00Z"),
        termsVersion: TERMS_VERSION,
        privacyAcceptedAt: new Date("2026-01-01T00:00:00Z"),
        privacyVersion: PRIVACY_VERSION,
      },
    });
    const c = customerRouter.createCaller(ctx as never);
    const out = await c.consentStatus();
    expect(out.hasTerms).toBe(true);
    expect(out.hasPrivacy).toBe(true);
    expect(out.termsVersion).toBe(TERMS_VERSION);
    expect(out.privacyVersion).toBe(PRIVACY_VERSION);
  });

  it("treats a non-grandfathered version as missing consent (re-prompt)", async () => {
    const ctx = makeCtx({
      profile: {
        termsAcceptedAt: new Date("2025-01-01T00:00:00Z"),
        termsVersion: "v0.1-prelaunch",
        privacyAcceptedAt: new Date("2025-01-01T00:00:00Z"),
        privacyVersion: "v0.1-prelaunch",
      },
    });
    const c = customerRouter.createCaller(ctx as never);
    const out = await c.consentStatus();
    expect(out.hasTerms).toBe(false);
    expect(out.hasPrivacy).toBe(false);
    expect(out.termsVersion).toBe("v0.1-prelaunch");
  });
});

describe("customer.acceptPlatformConsent", () => {
  it("stamps current versions + timestamp on the caller's profile", async () => {
    const ctx = makeCtx();
    const c = customerRouter.createCaller(ctx as never);
    await c.acceptPlatformConsent({ acceptedTerms: true, acceptedPrivacy: true });

    const prisma = (ctx as unknown as {
      prisma: { customerProfile: { update: ReturnType<typeof vi.fn> } };
    }).prisma;
    expect(prisma.customerProfile.update).toHaveBeenCalledTimes(1);
    const updateCall = prisma.customerProfile.update.mock.calls[0];
    if (!updateCall) throw new Error("update not called");
    const updateArgs = updateCall[0];
    expect(updateArgs.where).toEqual({ userId: "u_cust" });
    expect(updateArgs.data.termsVersion).toBe(TERMS_VERSION);
    expect(updateArgs.data.privacyVersion).toBe(PRIVACY_VERSION);
    expect(updateArgs.data.termsAcceptedAt).toBeInstanceOf(Date);
    expect(updateArgs.data.privacyAcceptedAt).toBeInstanceOf(Date);
    // Same timestamp instance for both — single `new Date()` per call.
    expect(updateArgs.data.termsAcceptedAt).toBe(updateArgs.data.privacyAcceptedAt);
  });

  it("is idempotent — calling again refreshes timestamps but keeps versions current", async () => {
    const ctx = makeCtx({
      profile: {
        termsAcceptedAt: new Date("2026-01-01T00:00:00Z"),
        termsVersion: TERMS_VERSION,
        privacyAcceptedAt: new Date("2026-01-01T00:00:00Z"),
        privacyVersion: PRIVACY_VERSION,
      },
    });
    const c = customerRouter.createCaller(ctx as never);
    await expect(
      c.acceptPlatformConsent({ acceptedTerms: true, acceptedPrivacy: true }),
    ).resolves.toEqual({ ok: true });
    const prisma = (ctx as unknown as {
      prisma: { customerProfile: { update: ReturnType<typeof vi.fn> } };
    }).prisma;
    expect(prisma.customerProfile.update).toHaveBeenCalledTimes(1);
  });

  it("rejects when acceptedTerms is false", async () => {
    const ctx = makeCtx();
    const c = customerRouter.createCaller(ctx as never);
    await expect(
      c.acceptPlatformConsent({
        acceptedTerms: false as unknown as true,
        acceptedPrivacy: true,
      }),
    ).rejects.toBeTruthy();
  });

  it("rejects when acceptedPrivacy is false", async () => {
    const ctx = makeCtx();
    const c = customerRouter.createCaller(ctx as never);
    await expect(
      c.acceptPlatformConsent({
        acceptedTerms: true,
        acceptedPrivacy: false as unknown as true,
      }),
    ).rejects.toBeTruthy();
  });
});
