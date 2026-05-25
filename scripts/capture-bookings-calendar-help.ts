/**
 * One-off (NOT wired into CI): capture real screenshots of /staff/calendar
 * for the Help Centre "Bookings & calendar" article.
 *
 * Same throwaway-user + minted-cookie recipe as capture-dashboard-help.ts:
 * the seed e2e users don't exist in this dev DB and every real back-office
 * user has TOTP, so we create a clearly-labelled THROWAWAY staff user, mint a
 * NextAuth v5 session cookie with AUTH_SECRET, shoot the views, then delete
 * the user in a finally block.
 *
 * Run: npx tsx scripts/capture-bookings-calendar-help.ts
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { encode } from "next-auth/jwt";
import { PrismaClient } from "@prisma/client";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const COOKIE_NAME = "xpertmoto.session-token"; // src/lib/auth.ts (dev)
const OUT = path.resolve(__dirname, "../public/help/bookings-calendar");

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

    await page.goto(`${BASE}/staff/calendar`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    if (/\/login|\/verify-2fa|\/totp/.test(page.url())) {
      throw new Error(`auth bounced to ${page.url()} — session not accepted`);
    }

    // Jump forward one month — the seeded bookings cluster around mid-June, so
    // the next month renders the richest spread of pickup/return markers.
    await page.locator(".fc-next-button").click();
    await page.waitForTimeout(1200);

    // 1) Calendar grid (month view) + filters + legend — element shot so the
    //    figure is the calendar itself, not the whole chrome.
    const calendar = page.locator(".fc-calendar").first();
    await calendar.screenshot({ path: path.join(OUT, "calendar-month.png") });
    console.log("  calendar-month → done");

    // 2) Walk-in / POS sheet. Open it, let availability resolve, pick the
    //    first vehicle so the Total card shows a real price.
    await page.getByRole("button", { name: "+ New walk-in" }).click();
    await page.waitForTimeout(2000); // availability query
    const firstVehicle = page.locator('[role="dialog"] button:has-text("/day")').first();
    if (await firstVehicle.count()) {
      await firstVehicle.click();
      await page.waitForTimeout(500);
    }
    const dialog = page.locator('[role="dialog"]').first();
    await dialog.screenshot({ path: path.join(OUT, "walk-in-pos.png") });
    console.log("  walk-in-pos → done");

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
