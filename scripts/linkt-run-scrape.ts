/**
 * Ad-hoc: run a real Linkt scrape against the DB. Use after the recon spike
 * (scripts/linkt-recon.ts) confirms the portal is reachable.
 *
 *   tsx scripts/linkt-run-scrape.ts                 # scrape every scrape-enabled active account
 *   tsx scripts/linkt-run-scrape.ts <accountId>     # scrape one account by id
 *
 * Reads creds/proxy from the same env the worker uses (LINKT_PROXY_URL,
 * PLAYWRIGHT_CHROMIUM_PATH). The scrape decrypts the per-account password from
 * the DB, so SECRET_ENC_KEY must be set.
 */
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../.env") });

import { PrismaClient } from "@prisma/client";
import { runLinktScrape } from "../src/server/services/linkt-scrape";

async function main() {
  const prisma = new PrismaClient();
  try {
    const argId = process.argv[2];
    const accounts = argId
      ? await prisma.linktAccount.findMany({ where: { id: argId }, select: { id: true, name: true } })
      : await prisma.linktAccount.findMany({
          where: { isActive: true, scrapeEnabled: true },
          select: { id: true, name: true },
          orderBy: { createdAt: "asc" },
        });

    if (accounts.length === 0) {
      console.log(
        argId
          ? `No Linkt account with id ${argId}`
          : "No active, scrape-enabled Linkt accounts. Enable scraping in Admin → Integrations → Tolls, or pass an account id.",
      );
      return;
    }

    for (const a of accounts) {
      process.stdout.write(`→ scraping ${a.name} (${a.id}) … `);
      try {
        const res = await runLinktScrape(prisma, a.id);
        console.log(`${res.status} (sync ${res.syncId})`);
      } catch (e) {
        console.log(`FAILED — ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
