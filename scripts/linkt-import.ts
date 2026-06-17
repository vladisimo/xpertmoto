/**
 * Import a Linkt trip export (CSV/XLSX) for one account via the normal
 * runLinktSync pipeline — the CLI analog of POST /api/staff/linkt/import.
 *
 *   tsx scripts/linkt-import.ts <accountId> <file>
 */
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../.env") });

import { PrismaClient } from "@prisma/client";
import { runLinktSync } from "../src/server/services/linkt";

async function main() {
  const [accountId, file] = process.argv.slice(2);
  if (!accountId || !file) {
    console.error("usage: tsx scripts/linkt-import.ts <accountId> <file>");
    process.exit(1);
  }
  const prisma = new PrismaClient();
  try {
    const buffer = fs.readFileSync(path.resolve(file));
    const res = await runLinktSync(prisma, accountId, { buffer });
    const sync = await prisma.linktSync.findUniqueOrThrow({ where: { id: res.syncId } });
    console.log(
      `${res.status}: fetched=${sync.rowsFetched} created=${sync.rowsCreated} ` +
        `duplicate=${sync.rowsDuplicate} unmatched=${sync.rowsUnmatched}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
