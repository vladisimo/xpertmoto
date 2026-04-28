import { chromium, type Browser } from "playwright";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { decryptSecret } from "@/lib/crypto";

/**
 * Linkt (Transurban) operates motorway tolls in VIC, QLD and under the
 * CityLink/LinktGO brand. There is no public API for consumer accounts.
 * This module follows the same Playwright scraper pattern as
 * `src/server/services/etoll.ts`, driving the `linkt.com.au` customer
 * portal to download trip statements then matching each toll event to an
 * active booking via timestamp + vehicle plate.
 *
 * Selectors are placeholders — the portal markup must be inspected during
 * first integration run and updated.
 */

export type LinktTripRow = {
  plate: string;
  timestamp: Date;
  amountCents: number;
  tollpoint: string;
  issuer: "Linkt-VIC" | "Linkt-QLD";
  externalHash: string;
};

export type LinktAccount = {
  id: string;
  name: string;
  region: "VIC" | "QLD";
  username: string;
  passwordEnc: string;
  passwordIv: string;
  passwordTag: string;
  adminFeeCents: number;
};

const LOGIN_URLS: Record<LinktAccount["region"], string> = {
  VIC: "https://www.linkt.com.au/login",
  QLD: "https://www.linkt.com.au/login",
};

async function login(browser: Browser, account: LinktAccount) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(LOGIN_URLS[account.region], { waitUntil: "domcontentloaded" });
  await page.fill('input[name="username"]', account.username);
  await page.fill(
    'input[name="password"]',
    decryptSecret({
      enc: account.passwordEnc,
      iv: account.passwordIv,
      tag: account.passwordTag,
    }),
  );
  await page.click('button[type="submit"]');
  await page.waitForLoadState("networkidle", { timeout: 30_000 });
  return { ctx, page };
}

/**
 * Download the last N days of activity for a Linkt account and return
 * parsed trip rows. Selectors and CSV format TODO to be finalised on live
 * portal (Linkt provides CSV export through "Statements" / "Activity" tabs).
 */
export async function fetchLinktTrips(account: LinktAccount, sinceDays = 30): Promise<LinktTripRow[]> {
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    const { page } = await login(browser, account);

    await page.click('a:has-text("Statements")').catch(() => null);
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 30_000 }).catch(() => null),
      page.click('button:has-text("Export CSV")').catch(() => null),
    ]);

    if (!download) {
      logger.warn({ accountId: account.id }, "linkt: no CSV export triggered");
      return [];
    }

    const path = await download.path();
    if (!path) return [];
    const fs = await import("node:fs/promises");
    const csv = await fs.readFile(path, "utf8");
    return parseLinktCsv(csv, account, sinceDays);
  } finally {
    await browser?.close();
  }
}

export function parseLinktCsv(csv: string, account: LinktAccount, sinceDays: number): LinktTripRow[] {
  const lines = csv.split(/\r?\n/).filter(Boolean);
  const [header, ...rows] = lines;
  if (!header) return [];
  const columns = header.split(",").map((c) => c.trim().toLowerCase());
  const idx = {
    plate: columns.findIndex((c) => c.includes("vehicle") || c.includes("plate")),
    timestamp: columns.findIndex((c) => c.includes("date") || c.includes("time")),
    amount: columns.findIndex((c) => c.includes("amount") || c.includes("cost")),
    tollpoint: columns.findIndex((c) => c.includes("toll") || c.includes("location")),
  };

  const cutoff = Date.now() - sinceDays * 86_400_000;
  const out: LinktTripRow[] = [];
  for (const r of rows) {
    const cells = r.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    const plate = cells[idx.plate] ?? "";
    const ts = new Date(cells[idx.timestamp] ?? "");
    if (isNaN(ts.getTime()) || ts.getTime() < cutoff) continue;
    const amountStr = (cells[idx.amount] ?? "").replace(/[^0-9.]/g, "");
    const amountCents = Math.round(parseFloat(amountStr || "0") * 100);
    const tollpoint = cells[idx.tollpoint] ?? "";

    const hashInput = `${account.id}|${plate}|${ts.toISOString()}|${amountCents}|${tollpoint}`;
    out.push({
      plate: plate.toUpperCase().replace(/\s/g, ""),
      timestamp: ts,
      amountCents,
      tollpoint,
      issuer: account.region === "VIC" ? "Linkt-VIC" : "Linkt-QLD",
      externalHash: Buffer.from(hashInput).toString("base64url").slice(0, 32),
    });
  }
  return out;
}

/**
 * Run a full sync for a Linkt account and upsert matching Infringement
 * rows. Relies on Infringement.referenceNumber uniqueness for idempotency.
 */
export async function runLinktSync(accountId: string) {
  const account = await prisma.systemSetting.findUnique({
    where: { key: `linkt:account:${accountId}` },
  });
  if (!account) return { status: "not-found", created: 0, duplicate: 0 };
  const meta = account.value as unknown as LinktAccount;
  const rows = await fetchLinktTrips(meta, 30);
  let created = 0;
  let duplicate = 0;
  for (const r of rows) {
    const vehicle = await prisma.vehicle.findFirst({
      where: { rego: r.plate },
      select: { id: true },
    });
    if (!vehicle) continue;
    const booking = await prisma.booking.findFirst({
      where: {
        vehicleId: vehicle.id,
        pickupDateTime: { lte: r.timestamp },
        OR: [{ returnDateTime: { gte: r.timestamp } }, { actualReturnDateTime: { gte: r.timestamp } }],
      },
      select: { id: true, customerId: true },
    });
    try {
      const tollAud = r.amountCents / 100;
      // G10 alignment — store the admin fee in its own column so receipts
      // and statements can show the breakdown; the downstream charge
      // endpoint (fleet.chargeCustomerForInfringement) sums toll + fee.
      const { getTollAdminFee } = await import("./toll-admin-fee");
      const configuredFee = await getTollAdminFee();
      const feeAud = meta.adminFeeCents > 0 ? meta.adminFeeCents / 100 : configuredFee;
      const infringement = await prisma.infringement.create({
        data: {
          vehicleId: vehicle.id,
          bookingId: booking?.id,
          customerId: booking?.customerId,
          type: "TOLL",
          issuer: `${r.issuer} (${meta.name})`,
          referenceNumber: r.externalHash,
          offenceDate: r.timestamp,
          amount: tollAud.toFixed(2),
          adminFee: feeAud.toFixed(2),
          status: booking ? "CUSTOMER_CHARGED" : "RECEIVED",
        },
      });
      // Mirror the side-effects from services/etoll.ts when the row is
      // matched to a booking + customer: create the INFRINGEMENT_RECOVERY
      // Payment, increment booking.balanceDue, and best-effort issue the
      // adjustment note. Skipped for orphan rows (no booking/customer).
      if (booking?.id && booking?.customerId) {
        const { applyInfringementRecoveryCharge } = await import(
          "./infringement-charge"
        );
        await applyInfringementRecoveryCharge({
          prisma,
          infringement: {
            id: infringement.id,
            referenceNumber: infringement.referenceNumber,
            type: infringement.type,
            issuer: infringement.issuer,
            amount: tollAud,
            adminFee: feeAud,
            bookingId: booking.id,
            customerId: booking.customerId,
          },
        });
      }
      created++;
    } catch {
      duplicate++;
    }
  }
  return { status: "ok", created, duplicate };
}
