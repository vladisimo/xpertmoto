import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

/**
 * Prisma client bound to the ISOLATED e2e database (`.env.e2e` DATABASE_URL).
 *
 * Specs must use this — never `src/lib/prisma`. The Playwright process is not
 * launched with `--env-file=.env.e2e`, so `src/lib/prisma` falls back to
 * dotenv-loading `.env` and silently reads/mutates the DEV database while the
 * server under test runs against `xpertmoto_e2e`.
 *
 * Refuses to construct outside the e2e profile (E2E_DB=1) so a stray import
 * can never touch dev data.
 */

function parseEnvFile(filePath: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fs.existsSync(filePath)) return out;
  for (const line of fs.readFileSync(filePath, "utf-8").split("\n")) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m?.[1]) continue;
    out[m[1]] = (m[2] ?? "").replace(/^["']|["']$/g, "");
  }
  return out;
}

function e2eDatabaseUrl(): string {
  if (process.env.E2E_DB !== "1") {
    throw new Error(
      "tests/e2e/_fixtures/db.ts may only be used in the e2e profile (E2E_DB=1). " +
        "Run via `npm run test:e2e:local`.",
    );
  }
  const envPath = path.resolve(__dirname, "../../../.env.e2e");
  const parsed = parseEnvFile(envPath);
  const url = parsed.DATABASE_URL;
  if (!url || !/xpertmoto_e2e/.test(url)) {
    throw new Error(
      `.env.e2e DATABASE_URL missing or not pointing at xpertmoto_e2e (got: ${url ?? "<unset>"})`,
    );
  }
  return url;
}

export const e2ePrisma = new PrismaClient({
  datasources: { db: { url: e2eDatabaseUrl() } },
});

/** Other values specs need from .env.e2e (the Playwright process doesn't load it). */
export function e2eEnv(key: string): string | undefined {
  return parseEnvFile(path.resolve(__dirname, "../../../.env.e2e"))[key];
}
