import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn().mockResolvedValue({ ok: true, remaining: 10, resetAt: 0 }),
}));
vi.mock("@/server/services/audit", async () => ({
  writeAudit: vi.fn().mockResolvedValue(undefined),
  writeAuditAsync: vi.fn(),
  captureCustomerId: vi.fn(),
  readCapturedCustomerId: vi.fn().mockReturnValue(undefined),
  capturePageView: vi.fn(),
  skipAutoAudit: vi.fn(),
}));
vi.mock("@/lib/branding", () => ({
  getBranding: vi.fn().mockResolvedValue({
    siteName: "XPERT Moto",
    legalName: "Mercury Road Equipment Pty Ltd",
    abn: "36 614 422 187",
    supportEmail: "support@example.com",
    privacyEmail: "privacy@example.com",
    tagline: "",
    brandColor: "#000",
    supportPhone: null,
    postalAddress: null,
    logoWideUrl: null,
    logoBlackUrl: null,
    logoSquareUrl: null,
    faviconUrl: null,
    social: { facebook: null, instagram: null, tiktok: null, youtube: null },
  }),
}));
vi.mock("@/lib/storage", () => ({
  uploadFile: vi.fn(async ({ folder }: { folder: string }) => ({
    key: `${folder}/mock-key.bin`,
    url: `https://mock/${folder}/mock-key.bin`,
  })),
  downloadFile: vi.fn(),
  getSignedUrl: vi.fn(),
  deleteFile: vi.fn(),
}));
vi.mock("@/lib/pdf/consent-document", () => ({
  renderConsentDocumentPdf: vi.fn(async () => Buffer.from("PDFBYTES")),
}));
vi.mock("@/lib/customer-pii", () => ({
  readPiiField: (plain: string | null | undefined) => plain ?? null,
  writePiiField: (col: string, enc: string, value: string | null) => ({
    [col]: value,
    [enc]: null,
  }),
}));
// The onboarding OCR procedures call the vision service — stub it so no
// provider/network call is made.
const extractLicenceData = vi.fn();
const extractPassportData = vi.fn();
vi.mock("@/server/services/document-extract", () => ({
  extractLicenceData: (...args: unknown[]) => extractLicenceData(...args),
  extractPassportData: (...args: unknown[]) => extractPassportData(...args),
}));

import { onboardingRouter } from "@/server/trpc/router/onboarding";
import { buildOnboardingVersion } from "@/lib/onboarding-status";
import { TRPCError } from "@trpc/server";

type Caller = ReturnType<typeof onboardingRouter.createCaller>;

interface ProfileRow {
  userId: string;
  onboardedAt: Date | null;
  onboardingVersion: string | null;
  signatureImage: string | null;
  termsAcceptedAt: Date | null;
  privacyAcceptedAt: Date | null;
  addressLine1: string | null;
  licenceType: "AU_LICENCE" | "INTERNATIONAL" | null;
  licenceImageFront: string | null;
  marketingOptIn: boolean;
  marketingSmsOptIn: boolean;
  // PII fields readPiiField unwraps from
  licenceNumber: string | null;
  licenceNumberEnc: unknown;
  passportNumber: string | null;
  passportNumberEnc: unknown;
  // Identity prefill
  licenceState: string | null;
  licenceCountry: string | null;
  licenceExpiry: Date | null;
  licenceClass: string | null;
  licenceImageBack: string | null;
  passportCountry: string | null;
  passportExpiry: Date | null;
  passportImage: string | null;
  // Address prefill
  addressLine2: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  country: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  emergencyContactRelationship: string | null;
}

function emptyProfile(userId: string): ProfileRow {
  return {
    userId,
    onboardedAt: null,
    onboardingVersion: null,
    signatureImage: null,
    termsAcceptedAt: null,
    privacyAcceptedAt: null,
    addressLine1: null,
    licenceType: null,
    licenceImageFront: null,
    marketingOptIn: false,
    marketingSmsOptIn: false,
    licenceNumber: null,
    licenceNumberEnc: null,
    passportNumber: null,
    passportNumberEnc: null,
    licenceState: null,
    licenceCountry: null,
    licenceExpiry: null,
    licenceClass: null,
    licenceImageBack: null,
    passportCountry: null,
    passportExpiry: null,
    passportImage: null,
    addressLine2: null,
    suburb: null,
    state: null,
    postcode: null,
    country: null,
    emergencyContactName: null,
    emergencyContactPhone: null,
    emergencyContactRelationship: null,
  };
}

function makeCtx(profileOverride?: Partial<ProfileRow>) {
  const profile = { ...emptyProfile("u1"), ...(profileOverride ?? {}) };
  const user = {
    id: "u1",
    firstName: "Vlad",
    lastName: "Tester",
    email: "vlad@example.com",
    phone: "0412 000 000",
    dateOfBirth: new Date("1990-01-01"),
    role: "CUSTOMER" as const,
    customerProfile: profile,
  };
  const documents: Array<Record<string, unknown>> = [];

  const prisma = {
    user: {
      findUnique: vi.fn(async () => user),
      update: vi.fn(async () => user),
    },
    customerProfile: {
      findUnique: vi.fn(async () => profile),
      update: vi.fn(async ({ data }: { data: Partial<ProfileRow> }) => {
        Object.assign(profile, data);
        return profile;
      }),
      upsert: vi.fn(async ({ create, update }: { create: Partial<ProfileRow>; update: Partial<ProfileRow> }) => {
        Object.assign(profile, profile.userId ? update : create);
        return profile;
      }),
    },
    customerDocument: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const created = { id: `doc-${documents.length + 1}`, ...data };
        documents.push(created);
        return created;
      }),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };

  const ctx = {
    prisma,
    session: {
      user: { id: "u1", role: "CUSTOMER" as const, email: "vlad@example.com", depotId: null },
      requiresOnboarding: true,
    },
    user: { id: "u1", role: "CUSTOMER" as const, email: "vlad@example.com" },
    ipAddress: "127.0.0.1",
    userAgent: "test",
    reqId: "r1",
  };
  return { ctx, prisma, profile, documents };
}

function caller(ctx: unknown): Caller {
  return onboardingRouter.createCaller(ctx as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("onboardingProcedure gate (profile-based, not role-based)", () => {
  it("admits a back-office user whose profile still needs onboarding", async () => {
    const { ctx } = makeCtx(); // bare profile → needs onboarding
    // Flip the session/user to a back-office role; the gate must admit them
    // based on the profile state, not the role.
    ctx.session.user.role = "STAFF" as never;
    ctx.user.role = "STAFF" as never;
    await expect(caller(ctx).bootstrap()).resolves.toBeDefined();
  });

  it("rejects a fully-onboarded user of any role with FORBIDDEN", async () => {
    const { ctx } = makeCtx({
      onboardedAt: new Date(),
      onboardingVersion: buildOnboardingVersion(),
    });
    await expect(caller(ctx).bootstrap()).rejects.toMatchObject({
      code: "FORBIDDEN",
    } satisfies Partial<TRPCError>);
  });
});

describe("onboarding.bootstrap", () => {
  it("returns user + profile + interpolated consent docs", async () => {
    const { ctx } = makeCtx();
    const result = await caller(ctx).bootstrap();
    expect(result.user.id).toBe("u1");
    expect(result.consentDocs).toHaveLength(4);
    expect(result.consentDocs[0]?.key).toBe("TERMS");
    // Branding tokens were interpolated in body
    expect(result.consentDocs[0]?.body).toContain("XPERT Moto");
    expect(result.versions.terms).toMatch(/^v\d/);
  });
});

describe("onboarding.acceptConsents", () => {
  it("stamps timestamps + versions and propagates marketing opt-in", async () => {
    const { ctx, profile, prisma } = makeCtx();
    await caller(ctx).acceptConsents({
      acceptedTerms: true,
      acceptedPrivacy: true,
      acceptedCancellation: true,
      acceptedMarketing: true,
      marketingEmailOptIn: true,
      marketingSmsOptIn: false,
    });
    expect(prisma.customerProfile.update).toHaveBeenCalledOnce();
    expect(profile.termsAcceptedAt).toBeTruthy();
    expect(profile.privacyAcceptedAt).toBeTruthy();
    expect(profile.marketingOptIn).toBe(true);
    expect(profile.marketingSmsOptIn).toBe(false);
  });

  it("rejects when a consent flag is not literally true", async () => {
    const { ctx } = makeCtx();
    await expect(
      caller(ctx).acceptConsents({
        // @ts-expect-error — feeding the failure path on purpose.
        acceptedTerms: false,
        acceptedPrivacy: true,
        acceptedCancellation: true,
        acceptedMarketing: true,
        marketingEmailOptIn: false,
        marketingSmsOptIn: false,
      }),
    ).rejects.toThrow();
  });
});

describe("onboarding.complete", () => {
  it("rejects when the customer profile is missing required pieces", async () => {
    const { ctx } = makeCtx({
      // Missing signature, terms, privacy, address, licence — the
      // server-side defence-in-depth guard should catch this.
      signatureImage: null,
      termsAcceptedAt: null,
    });
    await expect(caller(ctx).complete()).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    } satisfies Partial<TRPCError>);
  });

  it("sets onboardedAt + joint onboardingVersion when every prereq is present", async () => {
    const { ctx, profile } = makeCtx({
      signatureImage: "signatures/x.png",
      termsAcceptedAt: new Date(),
      privacyAcceptedAt: new Date(),
      addressLine1: "1 Test St",
      licenceType: "AU_LICENCE",
      licenceImageFront: "drivers/u1/x.jpg",
    });
    const res = await caller(ctx).complete();
    expect(res.ok).toBe(true);
    expect(profile.onboardedAt).toBeInstanceOf(Date);
    expect(profile.onboardingVersion).toMatch(/\|.*\|.*\|/); // joint key
  });
});

describe("onboarding.extractLicenceFromImage", () => {
  it("rejects a key outside the caller's own folder (no OCR runs)", async () => {
    const { ctx } = makeCtx();
    await expect(
      caller(ctx).extractLicenceFromImage({ imageKey: "drivers/someone-else/x.jpg" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" } satisfies Partial<TRPCError>);
    expect(extractLicenceData).not.toHaveBeenCalled();
  });

  it("passes the extraction (incl. documentType) through for an own-folder key", async () => {
    extractLicenceData.mockResolvedValue({ documentType: "PASSPORT", confidence: 0 });
    const { ctx } = makeCtx();
    const r = await caller(ctx).extractLicenceFromImage({ imageKey: "drivers/u1/x.jpg" });
    expect(r.documentType).toBe("PASSPORT");
    expect(extractLicenceData).toHaveBeenCalledTimes(1);
  });
});

describe("onboarding.extractPassportFromImage", () => {
  it("rejects a key outside the caller's own folder", async () => {
    const { ctx } = makeCtx();
    await expect(
      caller(ctx).extractPassportFromImage({ imageKey: "drivers/other/p.jpg" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" } satisfies Partial<TRPCError>);
  });

  it("surfaces an OTHER classification without throwing for an own-folder key", async () => {
    extractPassportData.mockResolvedValue({ documentType: "OTHER", confidence: 0 });
    const { ctx } = makeCtx();
    const r = await caller(ctx).extractPassportFromImage({ imageKey: "drivers/u1/p.jpg" });
    expect(r.documentType).toBe("OTHER");
    expect(extractPassportData).toHaveBeenCalledTimes(1);
  });
});

describe("onboarding.generateSignedPdfs", () => {
  it("uploads a signature once + creates four CONSENT_* CustomerDocument rows", async () => {
    const { ctx, profile, documents } = makeCtx({
      // Required for renderer to embed branding/marketing slice
      marketingOptIn: true,
      marketingSmsOptIn: false,
    });
    const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9ZjJ4DcAAAAASUVORK5CYII=";
    const res = await caller(ctx).generateSignedPdfs({ signatureDataUrl: PNG });
    expect(res.documents).toHaveLength(4);
    expect(res.documents.map((d) => d.key)).toEqual([
      "TERMS",
      "PRIVACY",
      "CANCELLATION",
      "MARKETING",
    ]);
    expect(documents).toHaveLength(4);
    expect(profile.signatureImage).toBe(res.signatureKey);
    expect(documents.every((d) => typeof d.fileUrl === "string")).toBe(true);
  });
});
