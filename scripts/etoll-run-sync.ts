/**
 * Ad-hoc: run a real e-toll sync against the DB for every active account,
 * OR upsert a throwaway "driver" account from ETOLL_USER/ETOLL_PASS and sync it.
 *
 *   tsx scripts/etoll-run-sync.ts            # sync existing active accounts
 *   tsx scripts/etoll-run-sync.ts --upsert   # also create/update a "driver" account first
 */
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../.env") });

import { PrismaClient } from "@prisma/client";
import { encryptSecret } from "../src/lib/crypto";
import { runEtollSync } from "../src/server/services/etoll";

async function main() {
  const prisma = new PrismaClient();
  const upsertFromEnv = process.argv.includes("--upsert");

  if (upsertFromEnv) {
    const user = process.env.ETOLL_USER;
    const pass = process.env.ETOLL_PASS;
    if (!user || !pass) {
      throw new Error("ETOLL_USER / ETOLL_PASS must be set in .env");
    }
    const sec = encryptSecret(pass);
    const existing = await prisma.etollAccount.findFirst({ where: { username: user } });
    if (existing) {
      await prisma.etollAccount.update({
        where: { id: existing.id },
        data: {
          passwordEnc: sec.enc,
          passwordIv: sec.iv,
          passwordTag: sec.tag,
          isActive: true,
        },
      });
      console.log(`updated existing account ${existing.id} (${user})`);
    } else {
      const a = await prisma.etollAccount.create({
        data: {
          name: "driver (scripts)",
          username: user,
          loginUrl: "https://account.myetoll.transport.nsw.gov.au/login",
          passwordEnc: sec.enc,
          passwordIv: sec.iv,
          passwordTag: sec.tag,
        },
      });
      console.log(`created account ${a.id} (${user})`);
    }
  }

  const accounts = await prisma.etollAccount.findMany({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
  });
  if (accounts.length === 0) {
    console.log("no active e-toll accounts — pass --upsert or create one in admin UI");
    return;
  }

  for (const a of accounts) {
    console.log(`\n=== syncing ${a.name} (${a.username}) ===`);
    const t0 = Date.now();
    try {
      const result = await runEtollSync(prisma, a.id);
      console.log(`  → ${result.status} (sync ${result.syncId}) in ${Date.now() - t0}ms`);
      const sync = await prisma.etollSync.findUnique({ where: { id: result.syncId } });
      if (sync) {
        console.log(
          `  rows: fetched=${sync.rowsFetched} created=${sync.rowsCreated} dup=${sync.rowsDuplicate} unmatched=${sync.rowsUnmatched} skipped=${sync.rowsSkipped}`,
        );
        if (sync.error) console.log(`  error: ${sync.error}`);
      }
    } catch (e) {
      console.error(`  FAILED: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
