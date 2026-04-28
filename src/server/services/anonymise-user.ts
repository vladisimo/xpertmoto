import { Prisma, type PrismaClient } from "@prisma/client";

import { logger } from "@/lib/logger";
import { deleteFile } from "@/lib/storage";

// Australian Privacy Principle 13 (APP 13): a customer can request deletion
// of their personal information. We cannot hard-delete the User row because
// it is referenced by Bookings, Payments, Invoices, AuditLogs etc. which
// must be retained for 7 years of ATO tax compliance. Instead we:
//   1. Overwrite every PII field on User + CustomerProfile with a non-
//      identifiable placeholder.
//   2. Rename email to `user_<id>@deleted.scootering.local` so the original
//      address is immediately free for re-registration under a new account.
//   3. Set `deletedAt` so the Prisma extension auto-filters this row from
//      read paths.
// The linked audit / financial rows themselves are untouched — they contain
// no raw PII beyond the FK, and are scoped to their own retention window.

export interface AnonymiseOptions {
  // Optional reason recorded in the audit log. Defaults to "APP 13 request".
  reason?: string;
  // Who executed the action — for the audit trail.
  actorUserId?: string;
}

export async function anonymiseUser(
  prisma: PrismaClient,
  userId: string,
  opts: AnonymiseOptions = {},
): Promise<void> {
  const reason = opts.reason ?? "APP 13 request";
  const tombstoneEmail = `user_${userId}@deleted.scootering.local`;
  const now = new Date();

  const user = await prisma.user.findUnique({
    // deliberately bypass the soft-delete extension filter: re-anonymising
    // an already-deleted record is still valid (e.g. follow-up cleanup).
    where: { id: userId },
    include: { customerProfile: true, staffProfile: true },
  });
  if (!user) throw new Error(`anonymiseUser: user ${userId} not found`);
  if (user.email === tombstoneEmail) return;

  // APP 13 — collect every S3 key that holds this customer's PII imagery so
  // we can delete the blobs as well as the DB references. The profile image
  // slots + any face-crop thumbnails stored on CustomerDocument.metadata
  // would otherwise stay in the bucket forever.
  const keysToDelete = new Set<string>();
  for (const key of [
    user.customerProfile?.licenceImageFront,
    user.customerProfile?.licenceImageBack,
    user.customerProfile?.passportImage,
    user.customerProfile?.signatureImage,
    user.avatarUrl,
  ]) {
    if (key && !key.startsWith("http://") && !key.startsWith("https://")) {
      keysToDelete.add(key.startsWith("/uploads/") ? key.slice("/uploads/".length) : key);
    }
  }
  const customerDocs = await prisma.customerDocument.findMany({
    where: { customerId: userId },
    select: { fileUrl: true, metadata: true },
  });
  for (const d of customerDocs) {
    if (d.fileUrl) {
      const k = d.fileUrl.startsWith("/uploads/")
        ? d.fileUrl.slice("/uploads/".length)
        : d.fileUrl;
      if (!k.startsWith("http://") && !k.startsWith("https://")) keysToDelete.add(k);
    }
    const faceKey =
      d.metadata && typeof d.metadata === "object"
        ? (d.metadata as { faceImageKey?: unknown }).faceImageKey
        : undefined;
    if (typeof faceKey === "string" && faceKey) keysToDelete.add(faceKey);
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        firstName: "Deleted",
        lastName: "Customer",
        email: tombstoneEmail,
        phone: null,
        passwordHash: null,
        avatarUrl: null,
        dateOfBirth: null,
        emailVerified: null,
        phoneVerified: null,
        status: "BANNED",
        deletedAt: now,
      },
    });

    if (user.customerProfile) {
      await tx.customerProfile.update({
        where: { userId },
        data: {
          licenceNumber: null,
          licenceNumberEnc: Prisma.JsonNull,
          licenceState: null,
          licenceExpiry: null,
          licenceClass: null,
          licenceImageFront: null,
          licenceImageBack: null,
          licenceVerifiedAt: null,
          licenceVerifiedById: null,
          passportNumber: null,
          passportNumberEnc: Prisma.JsonNull,
          passportCountry: null,
          passportExpiry: null,
          passportImage: null,
          passportVerifiedAt: null,
          passportVerifiedById: null,
          signatureImage: null,
          emergencyContactName: null,
          emergencyContactPhone: null,
          emergencyContactRelationship: null,
          addressLine1: null,
          addressLine2: null,
          suburb: null,
          state: null,
          postcode: null,
          notes: null,
          blacklistReason: reason,
          marketingOptIn: false,
          marketingSmsOptIn: false,
          marketingEmailUnsubscribedAt: now,
          marketingSmsUnsubscribedAt: now,
          // Retain stripeCustomerId so we can reconcile historical
          // payments against Stripe. Stripe itself holds the PAN vault,
          // not us; leaving the opaque token is APP-compliant.
          defaultStripePaymentMethodId: null,
          stripePaymentMethodBrand: null,
          stripePaymentMethodLast4: null,
          stripePaymentMethodExpMonth: null,
          stripePaymentMethodExpYear: null,
          referralCreditBalance: 0,
        },
      });
    }

    // Drop every CustomerDocument row belonging to this user. We already
    // collected the S3 keys above so we can delete the blobs after the
    // transaction commits.
    const docDeletion = await tx.customerDocument.deleteMany({
      where: { customerId: userId },
    });

    // Staff anonymisation: keep employeeId (asset-ownership linkage to
    // certifications is business-relevant) but blank certifications.
    if (user.staffProfile) {
      await tx.staffProfile.update({
        where: { userId },
        data: { certifications: [] },
      });
    }

    // Kill active auth sessions so the deleted user cannot return.
    await tx.session.deleteMany({ where: { userId } });
    await tx.pushSubscription.deleteMany({ where: { userId } });
    // Drop OAuth provider links — otherwise NextAuth re-attaches the same
    // Google/Microsoft/Apple sub to this anonymised User on next sign-in,
    // bypassing the email rotation entirely.
    const accountDeletion = await tx.account.deleteMany({ where: { userId } });
    // Wipe TOTP secret + recovery codes. Keeping them would both leak
    // PII-adjacent data and let a residual session ever satisfy step-up.
    const totpDeletion = await tx.userTotp.deleteMany({ where: { userId } });

    await tx.auditLog.create({
      data: {
        userId: opts.actorUserId ?? null,
        action: "USER_ANONYMISED",
        entity: "User",
        entityId: userId,
        category: "MUTATION",
        status: "SUCCESS",
        newData: {
          reason,
          email: tombstoneEmail,
          filesToDelete: keysToDelete.size,
          documentsDeleted: docDeletion.count,
          oauthAccountsRemoved: accountDeletion.count,
          totpRemoved: totpDeletion.count,
        },
      },
    });
  });

  // Best-effort S3 cleanup — errors are logged and swallowed so a transient
  // bucket outage doesn't leave the customer DB record half-anonymised.
  let filesDeleted = 0;
  for (const key of keysToDelete) {
    try {
      await deleteFile(key);
      filesDeleted++;
    } catch (err) {
      logger.warn({ userId, key, err }, "anonymiseUser: failed to delete S3 blob");
    }
  }

  logger.info(
    { userId, reason, filesDeleted, keysAttempted: keysToDelete.size },
    "user anonymised",
  );
}

// Same idea for a Depot: rename the slug so it can be re-used, mark
// deletedAt, flag as inactive.
export async function archiveDepot(
  prisma: PrismaClient,
  depotId: string,
  opts: { actorUserId?: string; reason?: string } = {},
): Promise<void> {
  const now = new Date();
  const depot = await prisma.depot.findUnique({ where: { id: depotId } });
  if (!depot) throw new Error(`archiveDepot: depot ${depotId} not found`);
  if (depot.deletedAt) return;

  const archivedSlug = `archived-${depot.slug}-${now.getTime()}`;
  await prisma.$transaction(async (tx) => {
    await tx.depot.update({
      where: { id: depotId },
      data: { slug: archivedSlug, isActive: false, deletedAt: now },
    });
    await tx.auditLog.create({
      data: {
        userId: opts.actorUserId ?? null,
        action: "DEPOT_ARCHIVED",
        entity: "Depot",
        entityId: depotId,
        category: "MUTATION",
        status: "SUCCESS",
        depotId,
        newData: { reason: opts.reason ?? "manual archive", originalSlug: depot.slug },
      },
    });
  });
  logger.info({ depotId, originalSlug: depot.slug, archivedSlug }, "depot archived");
}
