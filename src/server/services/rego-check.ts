import { chromium, type Browser } from "playwright";
import { logger } from "@/lib/logger";

export type RegoCheckResult = {
  plate: string;
  state: "NSW";
  status: "CURRENT" | "EXPIRED" | "SUSPENDED" | "UNKNOWN";
  expiryDate: Date | null;
  make?: string;
  model?: string;
  body?: string;
  colour?: string;
  checkedAt: Date;
};

const NSW_CHECK_URL = "https://check-rego.service.nsw.gov.au/frc-fo/app/rego-summary";

/**
 * Check a NSW vehicle registration via the public Service NSW rego check page.
 * There is no public API; we drive the public form with Playwright.
 *
 * The Service NSW page shows a recaptcha checkbox; for unattended use this
 * will fail. In practice rego checks are low-volume (daily batch) so we
 * retry with a longer delay on recaptcha failures and log if manual
 * intervention is needed.
 */
export async function checkNswRego(plate: string): Promise<RegoCheckResult> {
  const normalised = plate.toUpperCase().replace(/[^A-Z0-9]/g, "");
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    });
    const page = await ctx.newPage();
    await page.goto(NSW_CHECK_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.fill('input[name="plateNumber"]', normalised);
    await page.check('input[name="termsAndConditions"]').catch(() => null);
    await page.click('button[type="submit"]');
    await page.waitForLoadState("networkidle", { timeout: 30_000 });

    const bodyText = await page.innerText("body");
    const expiryMatch = bodyText.match(
      /Registration expires(?: on)?:\s*(\d{1,2}\s+[A-Za-z]+\s+\d{4})/,
    );
    const statusMatch = bodyText.match(/Status:\s*(Current|Expired|Suspended)/i);
    const make = bodyText.match(/Make:\s*([A-Za-z0-9 -]+)/)?.[1]?.trim();
    const model = bodyText.match(/Model:\s*([A-Za-z0-9 -]+)/)?.[1]?.trim();
    const body = bodyText.match(/Body(?: type)?:\s*([A-Za-z ]+)/)?.[1]?.trim();
    const colour = bodyText.match(/Colour:\s*([A-Za-z ]+)/)?.[1]?.trim();

    const statusStr = statusMatch?.[1];
    const expiryStr = expiryMatch?.[1];
    return {
      plate: normalised,
      state: "NSW",
      status: statusStr
        ? ((statusStr.toUpperCase() as RegoCheckResult["status"]) ?? "UNKNOWN")
        : "UNKNOWN",
      expiryDate: expiryStr ? new Date(expiryStr) : null,
      make,
      model,
      body,
      colour,
      checkedAt: new Date(),
    };
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), plate: normalised },
      "NSW rego check failed",
    );
    return {
      plate: normalised,
      state: "NSW",
      status: "UNKNOWN",
      expiryDate: null,
      checkedAt: new Date(),
    };
  } finally {
    await browser?.close();
  }
}
