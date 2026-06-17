/**
 * Reset (clear) a Linkt account's toll history, then optionally re-import a
 * complete trip export so the account has ONE clean authoritative baseline.
 *
 *   tsx scripts/linkt-reset.ts <accountId>                       # DRY RUN (reports only)
 *   tsx scripts/linkt-reset.ts <accountId> --apply              # clear
 *   tsx scripts/linkt-reset.ts <accountId> --apply --import=<csv|xlsx>
 *
 * If <accountId> is omitted and exactly one LinktAccount exists, it is used.
 *
 * SAFETY: the clear hard-deletes LinktSync, LinktUnmatchedRow and the
 * Linkt-sourced TOLL Infringements (hard, not soft — the unique externalHash /
 * referenceNumber must be freed so a re-import re-creates them). It REFUSES to
 * run if any target infringement has a recovery Payment (INFR-<ref>) or a
 * NominationSubmission, because deleting those would orphan financial / legal
 * records. Today none exist; this guard protects future runs.
 */
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../.env") });

import { PrismaClient } from "@prisma/client";

async function main() {
  const prisma = new PrismaClient();
  try {
    const args = process.argv.slice(2);
    const apply = args.includes("--apply");
    const importArg = args.find((a) => a.startsWith("--import="));
    const importPath = importArg ? importArg.slice("--import=".length) : null;
    const accountId =
      args.find((a) => !a.startsWith("--")) ??
      (await (async () => {
        const all = await prisma.linktAccount.findMany({ select: { id: true } });
        return all.length === 1 ? all[0]!.id : undefined;
      })());

    if (!accountId) {
      console.error("Pass an accountId (multiple or zero LinktAccounts found).");
      process.exit(1);
    }

    const account = await prisma.linktAccount.findUniqueOrThrow({ where: { id: accountId } });
    console.log(`Account: ${account.id} "${account.name}" (${account.region})\n`);

    const syncs = await prisma.linktSync.count({ where: { accountId } });
    const unmatched = await prisma.linktUnmatchedRow.count({ where: { accountId } });
    const infrs = await prisma.infringement.findMany({
      where: { type: "TOLL", issuer: { startsWith: `Linkt-${account.region} (${account.name})` } },
      select: { id: true, referenceNumber: true, status: true },
    });

    // Financial / legal safety check.
    const refs = infrs.map((i) => `INFR-${i.referenceNumber}`);
    const payments = refs.length
      ? await prisma.payment.count({ where: { reference: { in: refs } } })
      : 0;
    const submissions = infrs.length
      ? await prisma.nominationSubmission.count({
          where: { infringementId: { in: infrs.map((i) => i.id) } },
        })
      : 0;

    console.log("Will delete:");
    console.log(`  LinktSync rows:        ${syncs}`);
    console.log(`  LinktUnmatchedRow:     ${unmatched}`);
    console.log(`  TOLL Infringements:    ${infrs.length}`);
    console.log(`  (recovery Payments on those infringements: ${payments})`);
    console.log(`  (NominationSubmissions on those infringements: ${submissions})\n`);

    if (payments > 0 || submissions > 0) {
      console.error(
        `ABORT: ${payments} recovery Payment(s) and ${submissions} NominationSubmission(s) are\n` +
          `attached to these infringements. Deleting would orphan financial/legal records.\n` +
          `Reverse those charges/nominations first.`,
      );
      process.exit(1);
    }

    if (!apply) {
      console.log("DRY RUN — re-run with --apply to perform the clear.");
      if (importPath) console.log(`(would then import: ${importPath})`);
      return;
    }

    await prisma.$transaction(async (tx) => {
      if (infrs.length) {
        await tx.infringement.deleteMany({ where: { id: { in: infrs.map((i) => i.id) } } });
      }
      await tx.linktUnmatchedRow.deleteMany({ where: { accountId } });
      await tx.linktSync.deleteMany({ where: { accountId } });
      await tx.linktAccount.update({
        where: { id: accountId },
        data: {
          lastSyncAt: null,
          lastSyncStatus: null,
          lastSyncError: null,
          reauthNeededAt: null,
        },
      });
    });
    console.log("✓ Cleared toll history.\n");

    if (importPath) {
      const buffer = fs.readFileSync(path.resolve(importPath));
      console.log(`Importing ${importPath} (${buffer.length} bytes) …`);
      const { runLinktSync } = await import("../src/server/services/linkt");
      const res = await runLinktSync(prisma, accountId, { buffer });
      const sync = await prisma.linktSync.findUniqueOrThrow({ where: { id: res.syncId } });
      console.log(
        `✓ Import ${res.status}: fetched=${sync.rowsFetched} created=${sync.rowsCreated} ` +
          `duplicate=${sync.rowsDuplicate} unmatched=${sync.rowsUnmatched}`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
