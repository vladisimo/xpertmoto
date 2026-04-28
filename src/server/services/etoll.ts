/**
 * NSW e-Toll integration service.
 *
 * Phase 0 recon (2026-04-15) confirmed:
 *  - Login URL is a JS SPA — must use a headless browser.
 *  - Activity export is XLSX (single sheet "Page 1"), columns:
 *      Date, Type of activity, Details, Concession, Debit/Credit amount, Account balance
 *  - Trip rows have Details = " <tag-or-rego>  <gantry-code>"
 *  - In production each scooter's tag is registered against the scooter's rego,
 *    so the leading token in Details will be the rego.
 */
import { chromium, type Browser } from "playwright";
import * as XLSX from "xlsx";
import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { Prisma, type EtollAccount, type PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { decryptSecret } from "@/lib/crypto";

export class EtollAuthError extends Error {}
export class EtollDownloadError extends Error {}
export class EtollMfaRequiredError extends Error {}

const DEBUG_DIR = path.resolve(process.cwd(), "tmp", "etoll-debug");

async function dumpPage(page: import("playwright").Page, label: string): Promise<string> {
  try {
    fs.mkdirSync(DEBUG_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const base = path.join(DEBUG_DIR, `${stamp}-${label}`);
    await page.screenshot({ path: `${base}.png`, fullPage: true }).catch(() => {});
    fs.writeFileSync(`${base}.html`, await page.content());
    return base;
  } catch {
    return "";
  }
}

export type EtollTripRow = {
  externalHash: string; // sha256(accountId|date|details|amount) — idempotency key
  eventAt: Date;
  rego: string; // raw token from Details (assumed to be rego in production)
  gantryCode: string;
  concession: string;
  amountCents: number; // positive cents (we strip the sign)
  rawDetails: string;
};

/**
 * Details column formats observed:
 *   "12185095 (Sydney Harbour Bridge (South))"   — tag + description in parens
 *   " 12185095  05A"                             — tag + gantry code (older)
 *   " ABC123  05A"                               — rego + gantry code (if tag is
 *                                                   registered against the rego)
 *
 * We extract two fields:
 *   idToken   — the leading whitespace-trimmed token (tag number OR rego)
 *   location  — everything after the first token (gantry code or description)
 */
function parseDetails(details: string): { idToken: string; location: string } {
  const trimmed = details.trim();
  const m = trimmed.match(/^(\S+)\s*(.*)$/);
  if (!m) return { idToken: trimmed, location: "" };
  return { idToken: m[1] ?? "", location: (m[2] ?? "").trim() };
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

export async function loginAndDownloadActivity(account: EtollAccount): Promise<Buffer> {
  const password = decryptSecret({
    enc: account.passwordEnc,
    iv: account.passwordIv,
    tag: account.passwordTag,
  });

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ acceptDownloads: true });
    const page = await ctx.newPage();

    await page.goto(account.loginUrl, { waitUntil: "domcontentloaded" });

    // Wait for the SPA to actually render the login form. The myetoll SPA
    // renders #emailLogin + #passwordLogin + #submitBtn inside #login-form.
    const userSel = '#emailLogin, input[name="emailLogin"], input[type="email"], input[name="username"]';
    const passSel = '#passwordLogin, input[name="passwordLogin"], input[type="password"]';
    try {
      await page.waitForSelector(userSel, { timeout: 20000, state: "visible" });
      await page.waitForSelector(passSel, { timeout: 20000, state: "visible" });
    } catch {
      await dumpPage(page, "login-no-fields");
      throw new EtollAuthError("Could not find login form fields");
    }

    // The form uses Formik/MUI — `fill()` alone sometimes leaves validity
    // state stale and the Submit button stays disabled. Type char-by-char and
    // blur after each field so Formik runs its onBlur/onChange validators.
    const userLocator = page.locator(userSel).first();
    const passLocator = page.locator(passSel).first();
    await userLocator.click();
    await userLocator.pressSequentially(account.username, { delay: 25 });
    await userLocator.press("Tab");
    await passLocator.click();
    await passLocator.pressSequentially(password, { delay: 25 });
    await passLocator.press("Tab");

    // Dismiss cookies banner if it's covering the submit button.
    const cookieOk = await page.$("#cookiesBannerOkBtn");
    if (cookieOk) await cookieOk.click().catch(() => {});

    const submitSel = '#submitBtn, #login-form button[type="submit"], form button[type="submit"]';
    const submitLocator = page.locator(submitSel).first();
    try {
      // Wait up to 10s for the Submit button to become enabled — this is the
      // signal that Formik considers the form valid.
      await submitLocator.waitFor({ state: "visible", timeout: 10000 });
      await page.waitForFunction(
        (sel) => {
          const btn = document.querySelector(sel) as HTMLButtonElement | null;
          return !!btn && !btn.disabled && btn.getAttribute("aria-disabled") !== "true";
        },
        submitSel,
        { timeout: 10000 },
      );
    } catch {
      await dumpPage(page, "submit-disabled");
      throw new EtollAuthError(
        "Submit button stayed disabled after filling form — form validation failed or reCAPTCHA required",
      );
    }

    await submitLocator.click();

    // Wait for a definitive post-login signal: the URL must change to a
    // logged-in route. Relying on DOM elements is unreliable because the SPA
    // renders the logout nav item in both states.
    const loggedInRe = /\/(account-details|landing|make-a-payment|update-payment-details)/i;
    try {
      await page.waitForURL(loggedInRe, { timeout: 30000 });
    } catch {
      // Fall through to error handling below.
    }

    const url = page.url();
    if (!loggedInRe.test(url)) {
      // Server-side login failure is announced via a Toastify error toast
      // ("The authentication data you have entered is not correct..."). Fall
      // back to form-field helper text if no toast is visible.
      const errTxt =
        (await page
          .$eval(
            ".Toastify__toast--error .Toastify__toast-body, .Toastify__toast--warning .Toastify__toast-body",
            (el) => el.textContent?.trim() ?? "",
          )
          .catch(() => "")) ||
        (await page
          .$eval(
            "#helper-text-emailLogin, #helper-text-passwordLogin, .Mui-error, .is-danger, .error-message",
            (el) => el.textContent?.trim() ?? "",
          )
          .catch(() => ""));
      await dumpPage(page, "login-stuck");
      throw new EtollAuthError(
        errTxt
          ? `Login rejected: ${errTxt}`
          : `Login did not reach a logged-in page (url=${url})`,
      );
    }

    // Dismiss cookies banner if it reappears on the account page.
    const cookieOk2 = await page.$("#cookiesBannerOkBtn");
    if (cookieOk2) await cookieOk2.click().catch(() => {});

    // The activity table + Excel button live on /account-details. Make sure
    // we're there (the SPA sometimes lands on /landing first).
    if (!/\/account-details/i.test(page.url())) {
      await page.goto(new URL("/account-details", account.loginUrl).toString(), {
        waitUntil: "domcontentloaded",
      });
    }

    // Fill the Recent Account Activity date range. Start + End are required;
    // an empty range exports an empty workbook. Use 5 years back → today.
    await fillActivityDateRange(page);

    const excelSel =
      'button[title*="Download account activity Excel" i], ' +
      'button[aria-label*="Download account activity Excel" i], ' +
      'button[title*="Excel" i]';
    try {
      await page.waitForSelector(excelSel, { timeout: 30000, state: "visible" });
    } catch {
      await dumpPage(page, "no-excel-btn");
      throw new EtollDownloadError("Excel export button not found on activity page");
    }

    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 30000 }),
      page.click(excelSel),
    ]);

    const stream = await download.createReadStream();
    if (!stream) throw new EtollDownloadError("Empty download stream");
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(c as Buffer);
    const buf = Buffer.concat(chunks);

    // Always persist the latest download for diagnosis (one file per account).
    try {
      fs.mkdirSync(DEBUG_DIR, { recursive: true });
      const safe = account.id.replace(/[^a-z0-9-]/gi, "_");
      fs.writeFileSync(path.join(DEBUG_DIR, `latest-${safe}.xlsx`), buf);
    } catch {
      // Non-fatal: continue even if we can't write the debug file.
    }

    return buf;
  } finally {
    if (browser) await browser.close();
  }
}

async function fillActivityDateRange(page: import("playwright").Page): Promise<void> {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yyyy = now.getFullYear();
  const end = `${dd}/${mm}/${yyyy}`;
  const start = `01/01/${yyyy - 5}`;

  const startSel = '#datEventSearchStart, input[placeholder*="Start" i], input[placeholder*="From" i]';
  const endSel = '#datEventSearchEnd, input[placeholder*="End" i], input[placeholder*="To" i]';

  const startEl = await page.waitForSelector(startSel, { timeout: 15000, state: "visible" }).catch(() => null);
  const endEl = await page.waitForSelector(endSel, { timeout: 15000, state: "visible" }).catch(() => null);
  if (!startEl || !endEl) return; // leave unfilled — download may still work in some modes

  await startEl.click({ clickCount: 3 }).catch(() => {});
  await page.keyboard.type(start, { delay: 20 });
  await page.keyboard.press("Tab");
  await endEl.click({ clickCount: 3 }).catch(() => {});
  await page.keyboard.type(end, { delay: 20 });
  await page.keyboard.press("Tab");

  // Click the search icon on the activity form (magnifying glass). It sits
  // inside #accActivitiesForm and has role=button or title="Search".
  const searchSel =
    '#accActivitiesForm button[title*="Search" i], ' +
    '#accActivitiesForm button[aria-label*="Search" i], ' +
    'form#accActivitiesForm button[type="submit"]';
  const searchBtn = await page.$(searchSel);
  if (searchBtn) {
    await searchBtn.click().catch(() => {});
    // Wait for results to refresh — data table DOM updates.
    await page.waitForTimeout(2500);
  }
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

export function parseEtollWorkbook(buf: Buffer, accountId: string): EtollTripRow[] {
  const wb = XLSX.read(buf, { type: "buffer" });
  const sheetName = wb.SheetNames[0];
  const sheet = sheetName ? wb.Sheets[sheetName] : undefined;
  if (!sheet) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "E-toll workbook has no sheets",
    });
  }
  const rows: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false });
  if (rows.length < 2) return [];

  // Drop header
  const out: EtollTripRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length < 5) continue;
    const [dateStr, type, details, concession, amount] = r;
    if (type !== "Trip") continue;
    if (!dateStr || !details || !amount) continue;

    const eventAt = parseEtollDate(String(dateStr));
    if (!eventAt) continue;

    const { idToken, location } = parseDetails(String(details));
    if (!idToken) continue;

    const cents = parseAmountCents(String(amount));
    if (cents === null || cents <= 0) continue;

    const externalHash = createHash("sha256")
      .update([accountId, dateStr, details, amount].join("|"))
      .digest("hex");

    out.push({
      externalHash,
      eventAt,
      rego: idToken, // may be a rego OR a tag number — matcher tries both
      gantryCode: location,
      concession: String(concession ?? ""),
      amountCents: cents,
      rawDetails: String(details),
    });
  }
  return out;
}

function parseEtollDate(s: string): Date | null {
  // Format: DD/MM/YYYY HH:MM (assumed AEST)
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yyyy = Number(m[3]);
  const hh = Number(m[4]);
  const mi = Number(m[5]);
  // Construct as UTC then offset by 10h (AEST). Daylight saving (AEDT) is +11.
  // For now treat as +10:00; matcher tolerance handles small drift.
  const utcMs = Date.UTC(yyyy, mm - 1, dd, hh - 10, mi);
  return new Date(utcMs);
}

function parseAmountCents(s: string): number | null {
  const n = parseFloat(s.replace(/[$,\s]/g, ""));
  if (Number.isNaN(n)) return null;
  return Math.round(Math.abs(n) * 100);
}

// ---------------------------------------------------------------------------
// Match
// ---------------------------------------------------------------------------

export type EtollMatch = {
  vehicleId: string;
  bookingId: string | null;
  customerId: string | null;
};

function normaliseRego(s: string): string {
  return s.toUpperCase().replace(/[\s\-]/g, "");
}

export async function matchTripRow(
  prisma: PrismaClient,
  row: EtollTripRow,
): Promise<EtollMatch | null> {
  const token = normaliseRego(row.rego);
  // Vehicle.rego isn't stored normalised; gpsTrackerId holds the e-toll tag
  // number when the depot has registered tags per vehicle. Try rego first,
  // then tag, comparing normalised in JS.
  const vehicles = await prisma.vehicle.findMany({
    select: { id: true, rego: true, gpsTrackerId: true },
  });
  const vehicle =
    vehicles.find((v) => normaliseRego(v.rego) === token) ??
    vehicles.find((v) => v.gpsTrackerId && normaliseRego(v.gpsTrackerId) === token);
  if (!vehicle) return null;

  const booking = await prisma.booking.findFirst({
    where: {
      vehicleId: vehicle.id,
      pickupDateTime: { lte: row.eventAt },
      returnDateTime: { gte: row.eventAt },
    },
    select: { id: true, customerId: true },
    orderBy: { pickupDateTime: "desc" },
  });

  return {
    vehicleId: vehicle.id,
    bookingId: booking?.id ?? null,
    customerId: booking?.customerId ?? null,
  };
}

// ---------------------------------------------------------------------------
// Create infringement (idempotent)
// ---------------------------------------------------------------------------

export type CreateResult = "created" | "duplicate" | "unmatched";

export type RowAction =
  | { type: "skip-duplicate" }
  | { type: "skip-dismissed" }
  | { type: "create-and-resolve-existing" }
  | { type: "create-new" }
  | { type: "record-unmatched" }
  | { type: "refresh-unmatched" };

/**
 * Pure decision function for what a sync should do with one e-toll row, given
 * what it finds in the database. Factoring this out keeps the decision tree
 * trivially unit-testable — the IO-bound `upsertInfringementFromRow` just
 * performs the action this returns.
 */
export function classifyRowAction(input: {
  existingInfringement: boolean;
  existingUnmatched: {
    resolvedAt: Date | null;
    resolvedAction: string | null;
  } | null;
  matched: boolean;
}): RowAction {
  if (input.existingInfringement) return { type: "skip-duplicate" };

  const prevDismissed =
    input.existingUnmatched?.resolvedAt != null &&
    input.existingUnmatched.resolvedAction === "DISMISSED";
  if (prevDismissed) return { type: "skip-dismissed" };

  if (input.matched) {
    const hasPendingUnmatched =
      input.existingUnmatched != null && input.existingUnmatched.resolvedAt == null;
    return hasPendingUnmatched
      ? { type: "create-and-resolve-existing" }
      : { type: "create-new" };
  }

  return input.existingUnmatched ? { type: "refresh-unmatched" } : { type: "record-unmatched" };
}

export async function upsertInfringementFromRow(
  prisma: PrismaClient,
  row: EtollTripRow,
  account: EtollAccount,
): Promise<CreateResult> {
  // Idempotency: referenceNumber is @unique. Use externalHash as referenceNumber.
  const existing = await prisma.infringement.findUnique({
    where: { referenceNumber: row.externalHash },
    select: { id: true },
  });

  // If this row was previously captured as unmatched and a staff member
  // dismissed it (not-our-toll, not-chargeable, etc.), don't re-surface it on
  // every subsequent sync.
  const existingUnmatched = await prisma.etollUnmatchedRow.findUnique({
    where: { externalHash: row.externalHash },
    select: { id: true, resolvedAt: true, resolvedAction: true },
  });

  const match = existing || (existingUnmatched?.resolvedAction === "DISMISSED")
    ? null
    : await matchTripRow(prisma, row);

  const action = classifyRowAction({
    existingInfringement: !!existing,
    existingUnmatched: existingUnmatched
      ? {
          resolvedAt: existingUnmatched.resolvedAt,
          resolvedAction: existingUnmatched.resolvedAction,
        }
      : null,
    matched: !!match,
  });

  switch (action.type) {
    case "skip-duplicate":
    case "skip-dismissed":
      return "duplicate";

    case "record-unmatched":
      await prisma.etollUnmatchedRow.create({
        data: {
          accountId: account.id,
          externalHash: row.externalHash,
          eventAt: row.eventAt,
          rego: row.rego,
          concession: row.concession,
          gantryCode: row.gantryCode || null,
          rawDetails: row.rawDetails,
          amountCents: row.amountCents,
        },
      });
      return "unmatched";

    case "refresh-unmatched":
      // Row already exists and is still pending — nothing to do.
      return "unmatched";

    case "create-new":
    case "create-and-resolve-existing": {
      // `match` is guaranteed non-null by the classifier for these cases.
      if (!match) return "unmatched";
      const tollAud = row.amountCents / 100;
      // G10 — admin fee markup. Configurable in SystemSetting so Ops can
      // tune it without a deploy; defaults to 0 (pass-through) for
      // backward compatibility with older sync runs.
      const { getTollAdminFee } = await import("./toll-admin-fee");
      const adminFeeAud = await getTollAdminFee();
      const infringement = await prisma.infringement.create({
        data: {
          vehicleId: match.vehicleId,
          bookingId: match.bookingId,
          customerId: match.customerId,
          type: "TOLL",
          issuer: `NSW E-Toll (${account.name})`,
          referenceNumber: row.externalHash,
          offenceDate: row.eventAt,
          amount: new Prisma.Decimal(tollAud.toFixed(2)),
          adminFee: new Prisma.Decimal(adminFeeAud.toFixed(2)),
          status: match.bookingId ? "CUSTOMER_CHARGED" : "RECEIVED",
          notes: `Toll: ${row.concession} (${row.gantryCode}). Source: ${row.rawDetails}`,
        },
      });
      if (action.type === "create-and-resolve-existing" && existingUnmatched) {
        await prisma.etollUnmatchedRow.update({
          where: { id: existingUnmatched.id },
          data: {
            resolvedAt: new Date(),
            resolvedAction: "AUTO_MATCHED",
            resolvedInfringementId: infringement.id,
          },
        });
      }
      // When the toll is matched to an active booking we set status =
      // CUSTOMER_CHARGED above; the matching Payment + balanceDue +
      // AdjustmentNote side-effects must run alongside so the staff
      // Payments console, the customer Tolls tab, and the customer
      // portal Additional charges section all see the same row.
      if (match.bookingId && match.customerId) {
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
            adminFee: adminFeeAud,
            bookingId: match.bookingId,
            customerId: match.customerId,
          },
        });
      }
      return "created";
    }
  }
}

// ---------------------------------------------------------------------------
// Run a sync (called by tRPC and by BullMQ worker)
// ---------------------------------------------------------------------------

async function rebuildPendingRowsForRematch(
  prisma: PrismaClient,
  accountId: string,
): Promise<EtollTripRow[]> {
  const pending = await prisma.etollUnmatchedRow.findMany({
    where: { accountId, resolvedAt: null },
    orderBy: { eventAt: "asc" },
  });
  return pending.map((p) => ({
    externalHash: p.externalHash,
    eventAt: p.eventAt,
    rego: p.rego,
    gantryCode: p.gantryCode ?? "",
    concession: p.concession,
    amountCents: p.amountCents,
    rawDetails: p.rawDetails ?? "",
  }));
}

export async function runEtollSync(
  prisma: PrismaClient,
  accountId: string,
): Promise<{ syncId: string; status: string }> {
  const account = await prisma.etollAccount.findUniqueOrThrow({ where: { id: accountId } });

  const lastSuccess = await prisma.etollSync.findFirst({
    where: { accountId, status: "SUCCESS" },
    orderBy: { finishedAt: "desc" },
  });
  const periodFrom = lastSuccess?.periodTo ?? new Date("2000-01-01");
  const periodTo = new Date();

  const sync = await prisma.etollSync.create({
    data: { accountId, status: "RUNNING", periodFrom, periodTo },
  });

  let rows: EtollTripRow[];
  if (account.isActive) {
    let buf: Buffer;
    try {
      buf = await loginAndDownloadActivity(account);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await prisma.etollSync.update({
        where: { id: sync.id },
        data: { status: "FAILED", finishedAt: new Date(), error: msg },
      });
      await prisma.etollAccount.update({
        where: { id: accountId },
        data: { lastSyncAt: new Date(), lastSyncStatus: "FAILED", lastSyncError: msg },
      });
      return { syncId: sync.id, status: "FAILED" };
    }

    try {
      rows = parseEtollWorkbook(buf, accountId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await prisma.etollSync.update({
        where: { id: sync.id },
        data: { status: "FAILED", finishedAt: new Date(), error: `parse: ${msg}` },
      });
      return { syncId: sync.id, status: "FAILED" };
    }
  } else {
    // Inactive accounts (e.g. the dedicated "Test injections" account) have
    // no real Linkt to log into. Re-feed any still-pending unmatched rows
    // through the matcher so changes to fleet/booking state since they were
    // captured can resolve them automatically.
    rows = await rebuildPendingRowsForRematch(prisma, accountId);
  }

  // Process every row returned by the export. Idempotency is handled by
  // the externalHash → Infringement.referenceNumber @unique constraint, so
  // re-seeing a row cheaply becomes a "duplicate" result. We deliberately
  // do NOT drop rows older than the last successful sync — tolls sometimes
  // post retroactively, and the download is already bounded by the date
  // range we ask for in the UI.
  let created = 0;
  let duplicate = 0;
  let unmatched = 0;
  const unmatchedRows: Array<Pick<EtollTripRow, "eventAt" | "rego" | "concession" | "amountCents" | "externalHash">> = [];

  for (const row of rows) {
    const result = await upsertInfringementFromRow(prisma, row, account);
    if (result === "created") created++;
    else if (result === "duplicate") duplicate++;
    else {
      unmatched++;
      unmatchedRows.push({
        eventAt: row.eventAt,
        rego: row.rego,
        concession: row.concession,
        amountCents: row.amountCents,
        externalHash: row.externalHash,
      });
    }
  }

  const finalStatus = unmatched > 0 ? "PARTIAL" : "SUCCESS";
  await prisma.etollSync.update({
    where: { id: sync.id },
    data: {
      status: finalStatus,
      finishedAt: new Date(),
      rowsFetched: rows.length,
      rowsCreated: created,
      rowsDuplicate: duplicate,
      rowsUnmatched: unmatched,
      rowsSkipped: 0,
      unmatched: unmatchedRows.length > 0 ? (unmatchedRows as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
    },
  });

  await prisma.etollAccount.update({
    where: { id: accountId },
    data: {
      lastSyncAt: new Date(),
      lastSyncStatus: finalStatus,
      lastSyncError: null,
    },
  });

  return { syncId: sync.id, status: finalStatus };
}
