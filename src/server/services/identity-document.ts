/**
 * "Newest-document-wins" projection of CustomerDocument rows onto
 * CustomerProfile cache columns.
 *
 * Invariant (canonical — depended on by eligibility, check-out, and the
 * verification queue):
 *
 *     For each (customerId, type), the newest `CustomerDocument` row is
 *     authoritative. `CustomerProfile` image columns (licenceImageFront,
 *     licenceImageBack, passportImage) and document-metadata text columns
 *     (licenceExpiry, passportExpiry — plus other OCR-fillable fields) are
 *     projections of the newest row. Every mutation that creates, rotates,
 *     detects, or deletes a `CustomerDocument` MUST call
 *     `applyLatestDocumentToProfile` in the same transaction.
 *
 * Design points:
 *   - Image slots are a hard projection: newest row wins. If the newest row
 *     is deleted, the slot recomputes to the next-newest, or null if none
 *     remain.
 *   - Text fields (licenceNumber, passportNumber, state, class, expiry,
 *     country) are a soft projection: we only fill empty profile fields
 *     from detected metadata, never clobbering staff-entered values. This
 *     mirrors the discipline in staffCustomer.detectDocument.
 *   - PII (licenceNumber, passportNumber) is routed through the
 *     encryption helpers in src/lib/customer-pii.ts so APP-11 compliance
 *     is preserved.
 */

import type { Prisma, PrismaClient, CustomerDocument, CustomerDocumentType } from "@prisma/client";

import { writePiiField } from "@/lib/customer-pii";

import type {
  DetectedLicenceMetadata,
  DetectedPassportMetadata,
} from "@/server/services/document-extract";

/** Prisma-compatible transaction client (so callers can run us inside their
 *  own $transaction without a dedicated one). Accepts either the full
 *  PrismaClient or a TransactionClient. */
export type IdentityTxClient = PrismaClient | Prisma.TransactionClient;

/** The subset of CustomerDocument fields the projection needs. */
type ProjectableDoc = Pick<
  CustomerDocument,
  "id" | "fileUrl" | "expiryDate" | "metadata" | "createdAt"
>;

/** Find the newest CustomerDocument for (customerId, type). Returns null if
 *  none exist. Served by the composite index
 *  `CustomerDocument_customerId_type_createdAt_idx`. */
async function findLatestDocument(
  tx: IdentityTxClient,
  customerId: string,
  type: CustomerDocumentType,
): Promise<ProjectableDoc | null> {
  return tx.customerDocument.findFirst({
    where: { customerId, type },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      fileUrl: true,
      expiryDate: true,
      metadata: true,
      createdAt: true,
    },
  });
}

function parseLicenceMetadata(raw: unknown): DetectedLicenceMetadata | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as { kind?: unknown };
  if (m.kind !== "licence") return null;
  return raw as DetectedLicenceMetadata;
}

function parsePassportMetadata(raw: unknown): DetectedPassportMetadata | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as { kind?: unknown };
  if (m.kind !== "passport") return null;
  return raw as DetectedPassportMetadata;
}

function parseIsoDate(value: string | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Recompute the projection of the newest `type` document onto the customer
 * profile cache. Must be called inside a transaction whenever the set of
 * CustomerDocument rows for a customer changes (insert / update / delete /
 * rotation / detection).
 *
 * Safe to call when no documents of the given type exist — it clears the
 * corresponding cache slot(s) to null.
 */
export async function applyLatestDocumentToProfile(
  tx: IdentityTxClient,
  customerId: string,
  type: CustomerDocumentType,
): Promise<void> {
  const doc = await findLatestDocument(tx, customerId, type);

  switch (type) {
    case "LICENCE_FRONT": {
      await applyLicenceFrontProjection(tx, customerId, doc);
      return;
    }
    case "LICENCE_BACK": {
      await applyLicenceBackProjection(tx, customerId, doc);
      return;
    }
    case "PASSPORT": {
      await applyPassportProjection(tx, customerId, doc);
      return;
    }
    default: {
      // PASSPORT_STYLE_DL, VISA, INTL_DRIVING_PERMIT, PROOF_OF_ADDRESS, OTHER
      // don't have dedicated profile cache columns — nothing to project.
      return;
    }
  }
}

async function applyLicenceFrontProjection(
  tx: IdentityTxClient,
  customerId: string,
  doc: ProjectableDoc | null,
): Promise<void> {
  if (!doc) {
    // No licence-front row remains. Clear the image slot; leave text fields
    // alone (staff may have entered them manually before any image was
    // uploaded — clobbering would be destructive).
    await tx.customerProfile.update({
      where: { userId: customerId },
      data: { licenceImageFront: null },
    });
    return;
  }

  const profile = await tx.customerProfile.findUnique({
    where: { userId: customerId },
    select: {
      licenceNumber: true,
      licenceNumberEnc: true,
      licenceState: true,
      licenceExpiry: true,
      licenceClass: true,
    },
  });
  if (!profile) return;

  const metadata = parseLicenceMetadata(doc.metadata);
  const detectedExpiry = parseIsoDate(metadata?.expiryDate);
  const data: Prisma.CustomerProfileUpdateInput = {
    licenceImageFront: doc.fileUrl,
  };

  // Soft projection: only fill when the profile field is empty.
  // PII (licenceNumber) goes through writePiiField.
  const existingNumber = profile.licenceNumber || profile.licenceNumberEnc;
  if (!existingNumber && metadata?.licenceNumber) {
    Object.assign(data, writePiiField("licenceNumber", "licenceNumberEnc", metadata.licenceNumber));
  }
  if (!profile.licenceState && metadata?.state) {
    data.licenceState = metadata.state;
  }
  if (!profile.licenceClass && metadata?.licenceClass) {
    data.licenceClass = metadata.licenceClass;
  }
  if (!profile.licenceExpiry) {
    // Prefer the CustomerDocument.expiryDate (staff-confirmed on upload) over
    // the raw metadata string.
    const fromDoc = doc.expiryDate ?? detectedExpiry;
    if (fromDoc) data.licenceExpiry = fromDoc;
  }

  await tx.customerProfile.update({
    where: { userId: customerId },
    data,
  });
}

async function applyLicenceBackProjection(
  tx: IdentityTxClient,
  customerId: string,
  doc: ProjectableDoc | null,
): Promise<void> {
  // Same defensive guard as applyLicenceFrontProjection / applyPassportProjection:
  // the profile row may not exist yet (e.g. OAuth users who never went through
  // auth.register, or whose OCR-driven customer.updateProfile upsert hasn't
  // run yet). Without this guard, prisma throws ERR_NOT_FOUND.
  const profile = await tx.customerProfile.findUnique({
    where: { userId: customerId },
    select: { userId: true },
  });
  if (!profile) return;
  await tx.customerProfile.update({
    where: { userId: customerId },
    data: { licenceImageBack: doc?.fileUrl ?? null },
  });
}

async function applyPassportProjection(
  tx: IdentityTxClient,
  customerId: string,
  doc: ProjectableDoc | null,
): Promise<void> {
  if (!doc) {
    await tx.customerProfile.update({
      where: { userId: customerId },
      data: { passportImage: null },
    });
    return;
  }

  const profile = await tx.customerProfile.findUnique({
    where: { userId: customerId },
    select: {
      passportNumber: true,
      passportNumberEnc: true,
      passportCountry: true,
      passportExpiry: true,
    },
  });
  if (!profile) return;

  const metadata = parsePassportMetadata(doc.metadata);
  const detectedExpiry = parseIsoDate(metadata?.expiryDate);
  const data: Prisma.CustomerProfileUpdateInput = {
    passportImage: doc.fileUrl,
  };

  const existingNumber = profile.passportNumber || profile.passportNumberEnc;
  if (!existingNumber && metadata?.passportNumber) {
    Object.assign(
      data,
      writePiiField("passportNumber", "passportNumberEnc", metadata.passportNumber),
    );
  }
  if (!profile.passportCountry && metadata?.country) {
    data.passportCountry = metadata.country;
  }
  if (!profile.passportExpiry) {
    const fromDoc = doc.expiryDate ?? detectedExpiry;
    if (fromDoc) data.passportExpiry = fromDoc;
  }

  await tx.customerProfile.update({
    where: { userId: customerId },
    data,
  });
}

/**
 * One-shot repair: recompute every projectable type for a single customer.
 * Used by the admin "Repair identity cache" action and by the backfill
 * script run once after the passport-parity migration.
 */
export async function backfillProfileFromDocuments(
  tx: IdentityTxClient,
  customerId: string,
): Promise<{ licenceFrontUpdated: boolean; licenceBackUpdated: boolean; passportUpdated: boolean }> {
  await applyLatestDocumentToProfile(tx, customerId, "LICENCE_FRONT");
  await applyLatestDocumentToProfile(tx, customerId, "LICENCE_BACK");
  await applyLatestDocumentToProfile(tx, customerId, "PASSPORT");
  return {
    licenceFrontUpdated: true,
    licenceBackUpdated: true,
    passportUpdated: true,
  };
}

/** Convenience: the set of CustomerDocument types this service can project. */
export const PROJECTABLE_IDENTITY_TYPES = [
  "LICENCE_FRONT",
  "LICENCE_BACK",
  "PASSPORT",
] as const satisfies ReadonlyArray<CustomerDocumentType>;

export type ProjectableIdentityType = (typeof PROJECTABLE_IDENTITY_TYPES)[number];
