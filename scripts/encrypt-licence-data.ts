#!/usr/bin/env tsx
/**
 * One-shot migration: encrypt every legacy plaintext licence + passport
 * number on `CustomerProfile` using the AES-256-GCM helpers in
 * `src/lib/crypto.ts`.
 *
 * Idempotent — rows that already have the encrypted field populated are
 * skipped. Safe to re-run after a partial failure.
 *
 * Usage:
 *   tsx scripts/encrypt-licence-data.ts [--dry-run]
 *
 * Requires `SECRET_ENC_KEY` to be set (same key used for e-toll
 * credentials in integration-config.ts).
 */

import { prisma } from "../src/lib/prisma";
import { writePiiField, needsEncryptionMigration } from "../src/lib/customer-pii";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const rows = await prisma.customerProfile.findMany({
    select: {
      id: true,
      licenceNumber: true,
      licenceNumberEnc: true,
      passportNumber: true,
      passportNumberEnc: true,
    },
  });

  let licenceMigrated = 0;
  let passportMigrated = 0;
  for (const row of rows) {
    const updates: Record<string, unknown> = {};
    if (needsEncryptionMigration(row.licenceNumber, row.licenceNumberEnc)) {
      Object.assign(
        updates,
        writePiiField("licenceNumber", "licenceNumberEnc", row.licenceNumber ?? null),
      );
      licenceMigrated += 1;
    }
    if (needsEncryptionMigration(row.passportNumber, row.passportNumberEnc)) {
      Object.assign(
        updates,
        writePiiField("passportNumber", "passportNumberEnc", row.passportNumber ?? null),
      );
      passportMigrated += 1;
    }
    if (Object.keys(updates).length === 0) continue;
    if (dryRun) continue;
    await prisma.customerProfile.update({
      where: { id: row.id },
      data: updates,
    });
  }

  console.log(
    `${dryRun ? "DRY RUN: " : ""}Encrypted ${licenceMigrated} licence numbers, ${passportMigrated} passport numbers.`,
  );
  console.log(
    `Next step (after verification): drop plaintext columns via a DROP COLUMN migration.`,
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
