/**
 * One-off (NOT wired into CI): capture real screenshots of /staff/dashboard
 * for the Help Centre "Operations dashboard" article.
 *
 * Auth: the seed e2e users don't exist in this dev DB and every real
 * back-office user has TOTP enabled, so instead of impersonating anyone we
 * create a clearly-labelled THROWAWAY staff user, mint a NextAuth v5 session
 * cookie for it with AUTH_SECRET (no password / no TOTP code needed), shoot
 * the tabs, then delete the user in a finally block.
 *
 * Run: npx tsx scripts/capture-dashboard-help.ts
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { encode } from "next-auth/jwt";
import { PrismaClient } from "@prisma/client";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const COOKIE_NAME = "xpertmoto.session-token"; // src/lib/auth.ts (dev)
const OUT = path.resolve(__dirname, "../public/help/operations-dashboard");

const SHOTS = [
  { tab: "today", file: "today.png" },
  { tab: "overdue", file: "overdue.png" },
  { tab: "fleet", file: "fleet.png" },
];

function readEnv(key: string): string {
  const raw = fs.readFileSync(path.resolve(__dirname, "../.env"), "utf8");
  const line = raw.split("\n").find((l) => l.startsWith(`${key}=`));
  if (!line) throw new Error(`${key} not found in .env`);
  return line.slice(key.length + 1).replace(/^['"]|['"]$/g, "").trim();
}

async function main() {
  const prisma = new PrismaClient();
  const secret = readEnv("AUTH_SECRET");
  const depot = await prisma.depot.findFirst({ select: { id: true, name: true } });
  fs.mkdirSync(OUT, { recursive: true });

  // ── temp user ──────────────────────────────────────────────────────────
  const user = await prisma.user.create({
    data: {
      email: `help-screenshot-temp+${Date.now()}@example.invalid`,
      firstName: "Help",
      lastName: "Screenshot",
      role: "STAFF",
      depotId: depot?.id ?? null,
      totp: { create: { encryptedSecret: "screenshot-temp-not-a-real-secret", enabled: true } },
    },
    select: { id: true, email: true, role: true, depotId: true, firstName: true, lastName: true },
  });
  console.log("→ temp user", user.id, "depot", depot?.name ?? "(none)");

  try {
    const token = await encode({
      token: { id: user.id, sub: user.id, role: user.role, depotId: user.depotId, name: `${user.firstName} ${user.lastName}`, email: user.email },
      secret,
      salt: COOKIE_NAME,
    });

    const browser = await chromium.launch();
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 1100 },
      deviceScaleFactor: 2,
      locale: "en-AU",
      timezoneId: "Australia/Brisbane",
    });
    await ctx.addCookies([
      { name: COOKIE_NAME, value: token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
    ]);
    const page = await ctx.newPage();

    for (const { tab, file } of SHOTS) {
      const url = `${BASE}/staff/dashboard?tab=${tab}`;
      await page.goto(url, { waitUntil: "networkidle" });
      await page.waitForTimeout(1500); // let Suspense-streamed content settle
      if (/\/login|\/verify-2fa|\/totp/.test(page.url())) {
        throw new Error(`auth bounced to ${page.url()} — session not accepted`);
      }
      const dest = path.join(OUT, file);
      await page.screenshot({ path: dest, fullPage: true });
      console.log(`  ${tab} → ${dest}`);
    }

    await browser.close();
  } finally {
    await prisma.userTotp.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
    console.log("→ temp user deleted");
    await prisma.$disconnect();
  }
  console.log("done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
