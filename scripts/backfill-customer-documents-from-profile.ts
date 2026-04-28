/**
 * Backfill CustomerDocument rows from the legacy per-slot profile image
 * columns (`licenceImageFront`, `licenceImageBack`, `passportImage`).
 *
 * Why this exists
 * ---------------
 * Prior to the passport-parity work, customers' licence / passport images
 * lived only as keys on CustomerProfile. The new identity subsystem treats
 * the CustomerDocument table as the source of truth — each upload becomes a
 * row, the newest wins, older rows stay as history. `applyLatestDocument-
 * ToProfile` projects the newest row onto the profile image columns.
 *
 * For customers that pre-date the new subsystem, we need one CustomerDocument
 * row per populated profile slot, otherwise:
 *   - The /dashboard/identity history view will show nothing until they
 *     re-upload.
 *   - Any future staff `deleteDocument` / `rotateDocument` on a later row
 *     would cause `applyLatestDocumentToProfile` to clear the profile slot
 *     (because there'd be no newest row for that type).
 *
 * What this script does
 * ---------------------
 * For each CustomerProfile that has `licenceImageFront`, `licenceImageBack`,
 * or `passportImage`:
 *   - If no CustomerDocument exists for that (customerId, type, fileUrl),
 *     insert one, carrying the profile's matching expiryDate (licenceExpiry
 *     or passportExpiry) as the document's expiryDate. `createdAt` is set
 *     to the profile's `updatedAt` (or `createdAt` if earlier) so the
 *     backfilled row lives in the past — any subsequent upload becomes
 *     strictly newer and wins the projection.
 *   - `uploadedById` is left null to indicate a backfilled / unknown
 *     provenance (distinct from staff- or customer-driven uploads).
 *
 * Idempotency
 * -----------
 * The (customerId, type, fileUrl) triple is the dedup key. Running the
 * script twice is a no-op on the second run.
 *
 * Usage
 * -----
 *     pnpm tsx scripts/backfill-customer-documents-from-profile.ts
 *
 * To preview without writing, pass --dry-run:
 *     pnpm tsx scripts/backfill-customer-documents-from-profile.ts --dry-run
 */

import { PrismaClient, type CustomerDocumentType } from "@prisma/client";

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes("--dry-run");

type SlotMeta = {
  type: CustomerDocumentType;
  label: string;
};

const SLOTS: Array<
  SlotMeta & {
    imageKey: (p: ProfileRow) => string | null;
    expiry: (p: ProfileRow) => Date | null;
  }
> = [
  {
    type: "LICENCE_FRONT",
    label: "Licence (front, legacy)",
    imageKey: (p) => p.licenceImageFront,
    expiry: (p) => p.licenceExpiry,
  },
  {
    type: "LICENCE_BACK",
    label: "Licence (back, legacy)",
    imageKey: (p) => p.licenceImageBack,
    // Backs never carry an expiry on CustomerDocument.
    expiry: () => null,
  },
  {
    type: "PASSPORT",
    label: "Passport (legacy)",
    imageKey: (p) => p.passportImage,
    expiry: (p) => p.passportExpiry,
  },
];

type ProfileRow = {
  userId: string;
  licenceImageFront: string | null;
  licenceImageBack: string | null;
  passportImage: string | null;
  licenceExpiry: Date | null;
  passportExpiry: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

async function main() {
  const profiles = (await prisma.customerProfile.findMany({
    where: {
      OR: [
        { licenceImageFront: { not: null } },
        { licenceImageBack: { not: null } },
        { passportImage: { not: null } },
      ],
    },
    select: {
      userId: true,
      licenceImageFront: true,
      licenceImageBack: true,
      passportImage: true,
      licenceExpiry: true,
      passportExpiry: true,
      createdAt: true,
      updatedAt: true,
    },
  })) as ProfileRow[];

  console.log(
    `[${DRY_RUN ? "dry-run" : "write"}] Scanning ${profiles.length} customer profile(s) with at least one legacy image...`,
  );

  let created = 0;
  let skipped = 0;
  let missingProfileUpdatedAt = 0;

  for (const profile of profiles) {
    // Pick a stable "legacy row created at" timestamp that sits in the past.
    // Use the earlier of the profile's createdAt / updatedAt so that any new
    // upload after the backfill is strictly newer and wins the projection.
    const legacyCreatedAt =
      profile.createdAt.getTime() < profile.updatedAt.getTime()
        ? profile.createdAt
        : profile.updatedAt;
    if (!legacyCreatedAt) {
      missingProfileUpdatedAt++;
      continue;
    }

    for (const slot of SLOTS) {
      const fileUrl = slot.imageKey(profile);
      if (!fileUrl) continue;

      const already = await prisma.customerDocument.findFirst({
        where: {
          customerId: profile.userId,
          type: slot.type,
          fileUrl,
        },
        select: { id: true },
      });
      if (already) {
        skipped++;
        continue;
      }

      if (DRY_RUN) {
        console.log(
          `  + ${profile.userId} :: ${slot.type} <- ${fileUrl} (expiry ${slot.expiry(profile)?.toISOString() ?? "none"})`,
        );
      } else {
        await prisma.customerDocument.create({
          data: {
            customerId: profile.userId,
            type: slot.type,
            fileUrl,
            label: slot.label,
            expiryDate: slot.expiry(profile),
            // uploadedById null = unknown/legacy backfill.
            uploadedById: null,
            createdAt: legacyCreatedAt,
            // updatedAt defaults to now(); that's fine.
          },
        });
      }
      created++;
    }
  }

  console.log(
    `\nDone. ${created} CustomerDocument row(s) ${DRY_RUN ? "WOULD BE" : "were"} created, ${skipped} skipped (already present)${missingProfileUpdatedAt ? `, ${missingProfileUpdatedAt} skipped (profile missing timestamps)` : ""}.`,
  );

  if (DRY_RUN) {
    console.log("No rows were written (--dry-run). Re-run without the flag to apply.");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
