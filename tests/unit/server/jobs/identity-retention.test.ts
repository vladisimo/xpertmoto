import { describe, it, expect, vi, beforeEach } from "vitest";

import type { RetentionSignals } from "@/server/jobs/identity-retention";

const h = vi.hoisted(() => ({
  prisma: {} as Record<string, unknown>,
  deleteFile: vi.fn(),
  writeAudit: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: h.prisma }));
vi.mock("@/lib/storage", () => ({
  deleteFile: h.deleteFile,
  // Mirrors the real helper: resolves the dev `/uploads/` form, null otherwise.
  urlToKey: (url: string) =>
    url.startsWith("/uploads/") ? url.slice("/uploads/".length) : null,
}));
vi.mock("@/server/services/audit", () => ({ writeAudit: h.writeAudit }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/server/jobs/queue", () => ({
  getQueue: vi.fn(),
  registerWorker: vi.fn(),
  monitorCron: vi.fn(),
}));

import {
  disqualification,
  runIdentityRetention,
  storageKeyFor,
} from "@/server/jobs/identity-retention";

/** A customer nothing objects to: dormant, settled, verified long ago. */
const ELIGIBLE: RetentionSignals = {
  userId: "usr_1",
  hasIdentityArtefacts: true,
  recentBookings: 0,
  openBookings: 0,
  bookingsWithBalance: 0,
  openBonds: 0,
  unsettledPayments: 0,
  documentsUnderVerification: false,
};

describe("disqualification", () => {
  it("clears a dormant, fully-settled customer", () => {
    expect(disqualification(ELIGIBLE)).toBeNull();
  });

  it("skips a customer with nothing to purge", () => {
    expect(disqualification({ ...ELIGIBLE, hasIdentityArtefacts: false })).toBe(
      "no-identity-documents",
    );
  });

  it("blocks on an open booking", () => {
    expect(disqualification({ ...ELIGIBLE, openBookings: 1 })).toBe("open-booking");
  });

  it("blocks on booking activity inside the retention window", () => {
    expect(disqualification({ ...ELIGIBLE, recentBookings: 1 })).toBe(
      "recent-booking-activity",
    );
  });

  it("blocks on an outstanding balance of any age", () => {
    expect(disqualification({ ...ELIGIBLE, bookingsWithBalance: 1 })).toBe(
      "outstanding-balance",
    );
  });

  it("blocks while a bond is still held", () => {
    expect(disqualification({ ...ELIGIBLE, openBonds: 1 })).toBe("bond-held");
  });

  it("blocks on a pending or disputed payment", () => {
    expect(disqualification({ ...ELIGIBLE, unsettledPayments: 1 })).toBe(
      "unsettled-payment",
    );
  });

  it("blocks while documents sit in the staff verification queue", () => {
    expect(disqualification({ ...ELIGIBLE, documentsUnderVerification: true })).toBe(
      "awaiting-staff-verification",
    );
  });
});

describe("storageKeyFor", () => {
  it("passes a bare bucket key through", () => {
    expect(storageKeyFor("customers/licence/abc.jpg")).toBe("customers/licence/abc.jpg");
  });

  it("strips the local-dev /uploads/ prefix", () => {
    expect(storageKeyFor("/uploads/customers/abc.jpg")).toBe("customers/abc.jpg");
  });

  it("recovers the key from an absolute bucket URL", () => {
    expect(storageKeyFor("https://s3.example/xpertmoto/customers/abc.jpg")).toBe(
      "customers/abc.jpg",
    );
  });

  it("returns null for blank references", () => {
    expect(storageKeyFor(null)).toBeNull();
    expect(storageKeyFor("   ")).toBeNull();
  });
});

// --- job run --------------------------------------------------------------

const PROFILE = {
  licenceImageFront: "/uploads/customers/licence-front.jpg",
  licenceImageBack: null,
  passportImage: null,
  licenceVerifiedAt: new Date("2015-01-01"),
  passportVerifiedAt: new Date("2015-01-01"),
};

const DOCS = [
  {
    id: "doc_1",
    type: "LICENCE_FRONT",
    fileUrl: "/uploads/customers/licence-front.jpg",
    metadata: null,
  },
  {
    id: "doc_2",
    type: "PASSPORT",
    fileUrl: "customers/passport.jpg",
    metadata: { faceImageKey: "customers/face.jpg" },
  },
];

function mockPrisma(opts: {
  setting: unknown;
  candidates?: unknown[];
  counts?: number[];
  docs?: unknown[];
}) {
  const counts = opts.counts ?? [0, 0, 0];
  let bookingCall = 0;
  Object.assign(h.prisma, {
    systemSetting: {
      findUnique: vi.fn().mockResolvedValue(
        opts.setting === undefined ? null : { key: "privacy.identityRetention", value: opts.setting },
      ),
    },
    user: { findMany: vi.fn().mockResolvedValue(opts.candidates ?? []) },
    // Three booking.count calls per candidate, in run order:
    // recent activity, open bookings, outstanding balance.
    booking: { count: vi.fn(async () => counts[bookingCall++ % 3] ?? 0) },
    bondLedger: { count: vi.fn().mockResolvedValue(0) },
    payment: { count: vi.fn().mockResolvedValue(0) },
    customerDocument: {
      findMany: vi.fn().mockResolvedValue(opts.docs ?? DOCS),
      deleteMany: vi.fn().mockResolvedValue({ count: 2 }),
    },
    customerProfile: { update: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(h.prisma)),
  });
}

type AuditEntry = { action: string; entityId: string; newData: Record<string, unknown> };
const auditEntry = (i: number) => h.writeAudit.mock.calls[i]?.[1] as AuditEntry;

describe("runIdentityRetention", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.deleteFile.mockResolvedValue(undefined);
  });

  it("no-ops when the SystemSetting is absent (default: disabled)", async () => {
    mockPrisma({ setting: undefined });
    const out = await runIdentityRetention();

    expect(out).toMatchObject({ scanned: 0, purged: 0, dryRun: true });
    expect((h.prisma.user as { findMany: ReturnType<typeof vi.fn> }).findMany).not.toHaveBeenCalled();
    expect(h.writeAudit).not.toHaveBeenCalled();
    expect(h.deleteFile).not.toHaveBeenCalled();
  });

  it("no-ops when explicitly disabled, even with dryRun off", async () => {
    mockPrisma({ setting: { enabled: false, dryRun: false, retentionDays: 2555 } });
    const out = await runIdentityRetention();

    expect(out.purged).toBe(0);
    expect((h.prisma.user as { findMany: ReturnType<typeof vi.fn> }).findMany).not.toHaveBeenCalled();
    expect(h.deleteFile).not.toHaveBeenCalled();
  });

  it("dry run audits the candidate but deletes nothing", async () => {
    mockPrisma({
      setting: { enabled: true, dryRun: true, retentionDays: 2555 },
      candidates: [{ id: "usr_1", customerProfile: PROFILE }],
    });
    const out = await runIdentityRetention();

    expect(out).toMatchObject({ scanned: 1, purged: 1, documentsDeleted: 0, filesDeleted: 0, dryRun: true });
    expect(h.deleteFile).not.toHaveBeenCalled();
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
    expect(
      (h.prisma.customerDocument as { deleteMany: ReturnType<typeof vi.fn> }).deleteMany,
    ).not.toHaveBeenCalled();
    expect(
      (h.prisma.customerProfile as { update: ReturnType<typeof vi.fn> }).update,
    ).not.toHaveBeenCalled();

    expect(h.writeAudit).toHaveBeenCalledTimes(1);
    const entry = auditEntry(0);
    expect(entry).toMatchObject({
      action: "IDENTITY_RETENTION_DRY_RUN",
      entity: "User",
      entityId: "usr_1",
      newData: { dryRun: true, documentsWouldDelete: 2, filesWouldDelete: 3 },
    });
  });

  it("treats a malformed dryRun value as still-armed dry run", async () => {
    mockPrisma({
      setting: { enabled: true, dryRun: "no", retentionDays: 2555 },
      candidates: [{ id: "usr_1", customerProfile: PROFILE }],
    });
    const out = await runIdentityRetention();

    expect(out.dryRun).toBe(true);
    expect(h.deleteFile).not.toHaveBeenCalled();
  });

  it("deletes files, document rows and profile references, then audits", async () => {
    mockPrisma({
      setting: { enabled: true, dryRun: false, retentionDays: 2555 },
      candidates: [{ id: "usr_1", customerProfile: PROFILE }],
    });
    const out = await runIdentityRetention();

    expect(out).toMatchObject({
      scanned: 1,
      purged: 1,
      documentsDeleted: 2,
      filesDeleted: 3,
      dryRun: false,
    });

    // The licence front is referenced by both the profile column and a
    // CustomerDocument row — it must only be deleted once.
    expect(h.deleteFile).toHaveBeenCalledTimes(3);
    expect(h.deleteFile.mock.calls.map((c) => c[0]).sort()).toEqual([
      "customers/face.jpg",
      "customers/licence-front.jpg",
      "customers/passport.jpg",
    ]);

    expect(
      (h.prisma.customerProfile as { update: ReturnType<typeof vi.fn> }).update,
    ).toHaveBeenCalledWith({
      where: { userId: "usr_1" },
      data: { licenceImageFront: null, licenceImageBack: null, passportImage: null },
    });
    expect(
      (h.prisma.customerDocument as { deleteMany: ReturnType<typeof vi.fn> }).deleteMany,
    ).toHaveBeenCalledTimes(1);

    expect(h.writeAudit).toHaveBeenCalledTimes(1);
    const entry = auditEntry(0);
    expect(entry).toMatchObject({
      action: "IDENTITY_DOCUMENTS_PURGED",
      entityId: "usr_1",
      newData: { dryRun: false, documentsDeleted: 2, profileImagesCleared: 1, filesDeleted: 3 },
    });
    // PII never reaches the audit payload — IDs and counts only.
    expect(JSON.stringify(entry)).not.toContain("licence-front.jpg");
  });

  it("skips a candidate the eligibility rules reject and records the reason", async () => {
    mockPrisma({
      setting: { enabled: true, dryRun: false, retentionDays: 2555 },
      candidates: [{ id: "usr_1", customerProfile: PROFILE }],
      // recent activity, open bookings, outstanding balance
      counts: [1, 0, 0],
    });
    const out = await runIdentityRetention();

    expect(out).toMatchObject({
      scanned: 1,
      purged: 0,
      skipped: { "recent-booking-activity": 1 },
    });
    expect(h.deleteFile).not.toHaveBeenCalled();
    expect(h.writeAudit).not.toHaveBeenCalled();
  });

  it("skips a customer whose licence is still awaiting staff verification", async () => {
    mockPrisma({
      setting: { enabled: true, dryRun: false, retentionDays: 2555 },
      candidates: [
        { id: "usr_1", customerProfile: { ...PROFILE, licenceVerifiedAt: null } },
      ],
    });
    const out = await runIdentityRetention();

    expect(out.skipped).toEqual({ "awaiting-staff-verification": 1 });
    expect(h.deleteFile).not.toHaveBeenCalled();
  });

  it("blocks on an unverified passport document even with no profile image", async () => {
    mockPrisma({
      setting: { enabled: true, dryRun: false, retentionDays: 2555 },
      candidates: [
        {
          id: "usr_1",
          customerProfile: { ...PROFILE, passportVerifiedAt: null },
        },
      ],
    });
    const out = await runIdentityRetention();

    expect(out.skipped).toEqual({ "awaiting-staff-verification": 1 });
    expect(h.deleteFile).not.toHaveBeenCalled();
  });

  it("floors an implausibly short retention window", async () => {
    mockPrisma({
      setting: { enabled: true, dryRun: true, retentionDays: 5 },
      candidates: [{ id: "usr_1", customerProfile: PROFILE }],
    });
    await runIdentityRetention();

    expect(auditEntry(0).newData.retentionDays).toBe(365);
  });
});
