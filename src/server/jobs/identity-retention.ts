import type { BookingStatus, CustomerDocumentType } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { deleteFile, urlToKey } from "@/lib/storage";
import { SETTING_DEFAULTS } from "@/lib/settings-defaults";
import { writeAudit } from "@/server/services/audit";
import { getQueue, registerWorker } from "./queue";

const QUEUE = "identity-retention" as const;
const SETTING_KEY = "privacy.identityRetention" as const;

/** Bounded page size — one run only ever touches this many customers. */
const PAGE_SIZE = 200;

/**
 * Floor on the operator-configurable window. A fat-fingered `retentionDays: 5`
 * would otherwise destroy the identity documents of the entire active customer
 * base on the next tick. Twelve months is well below any plausible legitimate
 * setting and still leaves the guard meaningful.
 */
const MIN_RETENTION_DAYS = 365;

/**
 * Documents collected purely to verify who the renter is. Consent records
 * (CONSENT_*), proof of address, customer photos and OTHER are deliberately
 * out of scope: consent evidence has its own retention rationale, and the
 * rest are not the licence/passport imagery APP 11.2 obliges us to destroy.
 */
const IDENTITY_DOCUMENT_TYPES: CustomerDocumentType[] = [
  "LICENCE_FRONT",
  "LICENCE_BACK",
  "PASSPORT",
  "PASSPORT_STYLE_DL",
  "INTL_DRIVING_PERMIT",
  "VISA",
];

/**
 * Which staff sign-off (`licenceVerifiedAt` / `passportVerifiedAt`) covers a
 * given document type. A document family with no sign-off yet is still in the
 * verification queue, so it is not "no longer needed".
 */
const LICENCE_DOCUMENT_TYPES: CustomerDocumentType[] = [
  "LICENCE_FRONT",
  "LICENCE_BACK",
  // A passport-format driver's licence is a licence, not a passport.
  "PASSPORT_STYLE_DL",
  "INTL_DRIVING_PERMIT",
];

/**
 * Live bookings — the customer either holds a vehicle, is about to, or the
 * booking is in dispute. Identity documents are still needed operationally.
 * QUOTE is absent by design: a stale quote from eight years ago is not
 * activity, and a fresh one is caught by the recency rule instead.
 */
const OPEN_BOOKING_STATUSES: BookingStatus[] = [
  "PENDING_PAYMENT",
  "CONFIRMED",
  "CHECKED_OUT",
  "ACTIVE",
  "OVERDUE",
  "RETURNED",
  "DISPUTED",
];

/** Bond states where money is still authorised or partially held. */
const OPEN_BOND_STATUSES = ["HELD", "PARTIALLY_CAPTURED"] as const;

/** Payment states that are neither settled nor written off. */
const UNSETTLED_PAYMENT_STATUSES = ["PENDING", "DISPUTED"] as const;

export type IdentityRetentionConfig = {
  enabled: boolean;
  dryRun: boolean;
  retentionDays: number;
};

const DEFAULT_CONFIG: IdentityRetentionConfig = SETTING_DEFAULTS[SETTING_KEY];

async function loadConfig(): Promise<IdentityRetentionConfig> {
  const row = await prisma.systemSetting.findUnique({ where: { key: SETTING_KEY } });
  if (!row) return DEFAULT_CONFIG;
  const v = row.value as unknown;
  if (typeof v !== "object" || v === null) return DEFAULT_CONFIG;
  const cfg = v as Partial<IdentityRetentionConfig>;
  const days =
    typeof cfg.retentionDays === "number" && Number.isFinite(cfg.retentionDays)
      ? Math.floor(cfg.retentionDays)
      : DEFAULT_CONFIG.retentionDays;
  return {
    enabled: Boolean(cfg.enabled),
    // Only an explicit `false` arms the destructive path. A malformed or
    // partially-written setting must never silently start deleting.
    dryRun: cfg.dryRun !== false,
    retentionDays: Math.max(MIN_RETENTION_DAYS, days),
  };
}

/**
 * Per-customer signals the eligibility rules are evaluated against. Kept as a
 * plain record so the rules below are a pure function — the destructive
 * decision is unit-testable without a database.
 */
export type RetentionSignals = {
  userId: string;
  /** Any licence/passport imagery at all — nothing to do otherwise. */
  hasIdentityArtefacts: boolean;
  /** Non-cancelled bookings touched inside the retention window. */
  recentBookings: number;
  /** Bookings in a live state (upcoming, on hire, returned-not-closed). */
  openBookings: number;
  /** Bookings still carrying an unpaid balance, at any age. */
  bookingsWithBalance: number;
  /** Bond ledgers still holding or partially holding funds. */
  openBonds: number;
  /** Payments neither settled nor written off (pending, disputed). */
  unsettledPayments: number;
  /** Licence/passport imagery uploaded but not yet ticked off by staff. */
  documentsUnderVerification: boolean;
};

/**
 * The conservative eligibility gate. Returns a reason string when the
 * customer must be kept, or null when their identity documents may go.
 *
 * `documentsUnderVerification` intentionally blocks forever, not just inside
 * the window: imagery sitting in the staff verification queue is by
 * definition still needed, and "unverified" is the state a purge would be
 * hardest to explain after the fact.
 */
export function disqualification(s: RetentionSignals): string | null {
  if (!s.hasIdentityArtefacts) return "no-identity-documents";
  if (s.openBookings > 0) return "open-booking";
  if (s.recentBookings > 0) return "recent-booking-activity";
  if (s.bookingsWithBalance > 0) return "outstanding-balance";
  if (s.openBonds > 0) return "bond-held";
  if (s.unsettledPayments > 0) return "unsettled-payment";
  if (s.documentsUnderVerification) return "awaiting-staff-verification";
  return null;
}

/**
 * Reduce any storage reference (bare bucket key, `/uploads/…` dev URL, or an
 * absolute bucket URL) to the key `deleteFile` expects. Null for anything
 * that isn't ours to delete.
 */
export function storageKeyFor(ref: string | null | undefined): string | null {
  const raw = ref?.trim();
  if (!raw) return null;
  const viaConfig = urlToKey(raw);
  if (viaConfig) return viaConfig;
  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    // A URL written under a previous S3_PUBLIC_URL / endpoint configuration.
    try {
      const parts = new URL(raw).pathname.replace(/^\//, "").split("/");
      const bucket = process.env.S3_BUCKET ?? "xpertmoto";
      if (parts[0] === bucket) parts.shift();
      return parts.join("/") || null;
    } catch {
      return null;
    }
  }
  return raw;
}

function faceImageKey(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const key = (metadata as { faceImageKey?: unknown }).faceImageKey;
  return typeof key === "string" && key ? key : null;
}

export type IdentityRetentionResult = {
  scanned: number;
  purged: number;
  documentsDeleted: number;
  filesDeleted: number;
  dryRun: boolean;
  skipped: Record<string, number>;
};

/**
 * Daily: destroy licence/passport imagery for customers with no booking
 * activity, no open money and no pending verification inside the retention
 * window (APP 11.2 — destroy personal information no longer needed).
 *
 * Reads config from the `privacy.identityRetention` SystemSetting. No-ops
 * when `enabled: false`, and only reports candidates when `dryRun: true` —
 * both default on, so the job is inert until an operator opts in. Every
 * candidate (purged or dry-run) writes an AuditLog row.
 */
export async function runIdentityRetention(): Promise<IdentityRetentionResult> {
  const cfg = await loadConfig();
  if (!cfg.enabled) {
    logger.info("identity-retention: disabled via SystemSetting, skipping");
    return {
      scanned: 0,
      purged: 0,
      documentsDeleted: 0,
      filesDeleted: 0,
      dryRun: cfg.dryRun,
      skipped: {},
    };
  }

  const cutoff = new Date(Date.now() - cfg.retentionDays * 24 * 60 * 60 * 1000);

  // Pre-filter in SQL so quiet-but-ineligible customers can't crowd the page
  // out. The pure guard below is still authoritative — this only narrows.
  const candidates = await prisma.user.findMany({
    where: {
      OR: [
        {
          customerProfile: {
            OR: [
              { licenceImageFront: { not: null } },
              { licenceImageBack: { not: null } },
              { passportImage: { not: null } },
            ],
          },
        },
        { customerDocuments: { some: { type: { in: IDENTITY_DOCUMENT_TYPES } } } },
      ],
      bookings: { none: { status: { in: OPEN_BOOKING_STATUSES } } },
    },
    select: {
      id: true,
      customerProfile: {
        select: {
          licenceImageFront: true,
          licenceImageBack: true,
          passportImage: true,
          licenceVerifiedAt: true,
          passportVerifiedAt: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
    take: PAGE_SIZE,
  });

  const skipped: Record<string, number> = {};
  let purged = 0;
  let documentsDeleted = 0;
  let filesDeleted = 0;

  for (const candidate of candidates) {
    const profile = candidate.customerProfile;
    const [recentBookings, openBookings, bookingsWithBalance, openBonds, unsettledPayments, docs] =
      await Promise.all([
        prisma.booking.count({
          where: {
            customerId: candidate.id,
            status: { not: "CANCELLED" },
            OR: [
              { updatedAt: { gte: cutoff } },
              { createdAt: { gte: cutoff } },
              { pickupDateTime: { gte: cutoff } },
              { returnDateTime: { gte: cutoff } },
            ],
          },
        }),
        prisma.booking.count({
          where: { customerId: candidate.id, status: { in: OPEN_BOOKING_STATUSES } },
        }),
        prisma.booking.count({
          where: { customerId: candidate.id, balanceDue: { gt: 0 } },
        }),
        prisma.bondLedger.count({
          where: { customerId: candidate.id, status: { in: [...OPEN_BOND_STATUSES] } },
        }),
        prisma.payment.count({
          where: { customerId: candidate.id, status: { in: [...UNSETTLED_PAYMENT_STATUSES] } },
        }),
        prisma.customerDocument.findMany({
          where: { customerId: candidate.id, type: { in: IDENTITY_DOCUMENT_TYPES } },
          select: { id: true, type: true, fileUrl: true, metadata: true },
        }),
      ]);

    // Verification state lives on the profile, but the imagery it covers can
    // sit in either place — a document row that was never applied to the
    // profile is still unverified imagery, not an orphan we may destroy.
    const docTypes = new Set(docs.map((d) => d.type));
    const hasLicenceArtefacts =
      !!(profile?.licenceImageFront || profile?.licenceImageBack) ||
      LICENCE_DOCUMENT_TYPES.some((t) => docTypes.has(t));
    const hasPassportArtefacts = !!profile?.passportImage || docTypes.has("PASSPORT");
    const reason = disqualification({
      userId: candidate.id,
      hasIdentityArtefacts: docs.length > 0 || hasLicenceArtefacts || hasPassportArtefacts,
      recentBookings,
      openBookings,
      bookingsWithBalance,
      openBonds,
      unsettledPayments,
      documentsUnderVerification:
        (hasLicenceArtefacts && profile?.licenceVerifiedAt == null) ||
        (hasPassportArtefacts && profile?.passportVerifiedAt == null),
    });
    if (reason) {
      skipped[reason] = (skipped[reason] ?? 0) + 1;
      continue;
    }

    const keys = new Set<string>();
    for (const ref of [
      profile?.licenceImageFront,
      profile?.licenceImageBack,
      profile?.passportImage,
    ]) {
      const key = storageKeyFor(ref);
      if (key) keys.add(key);
    }
    for (const doc of docs) {
      const key = storageKeyFor(doc.fileUrl);
      if (key) keys.add(key);
      const face = faceImageKey(doc.metadata);
      if (face) keys.add(face);
    }

    if (cfg.dryRun) {
      // Deliberately no writes of any kind — only the audit trail of what a
      // live run would have destroyed. IDs and counts only, never URLs.
      await writeAudit(prisma, {
        category: "JOB",
        action: "IDENTITY_RETENTION_DRY_RUN",
        entity: "User",
        entityId: candidate.id,
        method: "JOB",
        path: QUEUE,
        status: "SUCCESS",
        newData: {
          retentionDays: cfg.retentionDays,
          dryRun: true,
          documentsWouldDelete: docs.length,
          filesWouldDelete: keys.size,
        },
      });
      purged++;
      continue;
    }

    const clearedProfileImages = [
      profile?.licenceImageFront,
      profile?.licenceImageBack,
      profile?.passportImage,
    ].filter(Boolean).length;

    await prisma.$transaction(async (tx) => {
      if (profile) {
        await tx.customerProfile.update({
          where: { userId: candidate.id },
          data: { licenceImageFront: null, licenceImageBack: null, passportImage: null },
        });
      }
      await tx.customerDocument.deleteMany({
        where: { customerId: candidate.id, type: { in: IDENTITY_DOCUMENT_TYPES } },
      });
    });

    // Best-effort blob cleanup — the DB references are already gone, so a
    // transient bucket outage costs us an orphan object, not a torn record.
    let deletedForUser = 0;
    for (const key of keys) {
      try {
        await deleteFile(key);
        deletedForUser++;
      } catch (err) {
        logger.warn(
          { userId: candidate.id, err },
          "identity-retention: failed to delete stored object",
        );
      }
    }

    await writeAudit(prisma, {
      category: "JOB",
      action: "IDENTITY_DOCUMENTS_PURGED",
      entity: "User",
      entityId: candidate.id,
      method: "JOB",
      path: QUEUE,
      status: "SUCCESS",
      newData: {
        retentionDays: cfg.retentionDays,
        dryRun: false,
        documentsDeleted: docs.length,
        profileImagesCleared: clearedProfileImages,
        filesDeleted: deletedForUser,
        filesAttempted: keys.size,
      },
    });

    purged++;
    documentsDeleted += docs.length;
    filesDeleted += deletedForUser;
  }

  const result: IdentityRetentionResult = {
    scanned: candidates.length,
    purged,
    documentsDeleted,
    filesDeleted,
    dryRun: cfg.dryRun,
    skipped,
  };
  logger.info(result, "identity-retention: completed");
  return result;
}

export function startIdentityRetentionScheduler() {
  registerWorker(QUEUE, async () => runIdentityRetention());
  const q = getQueue(QUEUE);
  if (!q) return;
  q.add(
    "daily",
    {},
    {
      repeat: { pattern: "35 3 * * *", tz: "Australia/Brisbane" },
      jobId: "identity-retention-daily",
    },
  );
}
