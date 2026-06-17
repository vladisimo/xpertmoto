/**
 * Provision the Linkt (Transurban) account from environment variables and,
 * optionally, run an initial re-match sync.
 *
 * Credentials are read from env — NEVER hardcode or commit them:
 *   LINKT_USER     Linkt login email/username   (e.g. book@scootering.com.au)
 *   LINKT_PASS     Linkt password
 *   LINKT_REGION   NSW | VIC | QLD              (default NSW)
 *   LINKT_NAME     account label                (default "Linkt <REGION>")
 *
 * Usage:
 *   tsx scripts/linkt-upsert-account.ts                     # upsert account only
 *   tsx scripts/linkt-upsert-account.ts --sync             # … then run a re-match pass
 *
 * The password is stored AES-256-GCM encrypted (SECRET_ENC_KEY). New trips are
 * ingested by uploading the Linkt CSV/Excel export in the staff UI (Linkt has no
 * public API and its portal blocks headless browsers); --sync here only re-matches
 * already-captured unmatched rows against current bookings.
 */
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../.env") });

import { PrismaClient, type LinktRegion } from "@prisma/client";
import { encryptSecret } from "../src/lib/crypto";
import { runLinktSync } from "../src/server/services/linkt";

const REGIONS: LinktRegion[] = ["NSW", "VIC", "QLD"];

async function main() {
  const prisma = new PrismaClient();
  const doSync = process.argv.includes("--sync");

  const user = process.env.LINKT_USER;
  const pass = process.env.LINKT_PASS;
  if (!user || !pass) {
    throw new Error("LINKT_USER / LINKT_PASS must be set in .env");
  }
  const region = (process.env.LINKT_REGION ?? "NSW").toUpperCase() as LinktRegion;
  if (!REGIONS.includes(region)) {
    throw new Error(`LINKT_REGION must be one of ${REGIONS.join(", ")}`);
  }
  const name = process.env.LINKT_NAME ?? `Linkt ${region}`;

  const sec = encryptSecret(pass);
  const existing = await prisma.linktAccount.findFirst({ where: { username: user } });
  let accountId: string;
  if (existing) {
    await prisma.linktAccount.update({
      where: { id: existing.id },
      data: {
        name,
        region,
        passwordEnc: sec.enc,
        passwordIv: sec.iv,
        passwordTag: sec.tag,
        isActive: true,
      },
    });
    accountId = existing.id;
    console.log(`updated existing Linkt account ${existing.id} (${user}, ${region})`);
  } else {
    const a = await prisma.linktAccount.create({
      data: {
        name,
        region,
        username: user,
        passwordEnc: sec.enc,
        passwordIv: sec.iv,
        passwordTag: sec.tag,
      },
    });
    accountId = a.id;
    console.log(`created Linkt account ${a.id} (${user}, ${region})`);
  }

  if (doSync) {
    console.log(`\n=== syncing ${name} ===`);
    const t0 = Date.now();
    try {
      const result = await runLinktSync(prisma, accountId);
      console.log(`  → ${result.status} (sync ${result.syncId}) in ${Date.now() - t0}ms`);
      const sync = await prisma.linktSync.findUnique({ where: { id: result.syncId } });
      if (sync) {
        console.log(
          `  rows: fetched=${sync.rowsFetched} created=${sync.rowsCreated} dup=${sync.rowsDuplicate} unmatched=${sync.rowsUnmatched}`,
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
