/**
 * Phase 0 throwaway: log into NSW e-toll, navigate to activity, download CSV.
 * Run: npx tsx scripts/etoll-recon.ts
 *
 * Non-headless so we can solve CAPTCHA/MFA manually.
 * Credentials read from .env (ETOLL_USER, ETOLL_PASS).
 */
import { chromium } from "playwright";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const USER = process.env.ETOLL_USER;
const PASS = process.env.ETOLL_PASS;
const HEADLESS = process.env.ETOLL_HEADLESS === "1";
const OUT_DIR = path.resolve(__dirname, "../tmp");

if (!USER || !PASS) {
  console.error("Missing ETOLL_USER or ETOLL_PASS in .env");
  process.exit(1);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: HEADLESS, slowMo: 200 });
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();

  console.log("→ navigating to login");
  await page.goto("https://account.myetoll.transport.nsw.gov.au/login", {
    waitUntil: "domcontentloaded",
  });

  // Save initial page snapshot for inspection
  await page.waitForTimeout(2500);
  fs.writeFileSync(path.join(OUT_DIR, "login-page.html"), await page.content());
  await page.screenshot({ path: path.join(OUT_DIR, "login-page.png"), fullPage: true });
  console.log("  saved login-page.html + login-page.png");

  // Try common selectors
  const userSelectors = [
    'input[name="username"]',
    'input[name="email"]',
    'input[type="email"]',
    'input[id*="user" i]',
    'input[id*="email" i]',
  ];
  const passSelectors = [
    'input[name="password"]',
    'input[type="password"]',
    'input[id*="pass" i]',
  ];

  let userField = null;
  for (const sel of userSelectors) {
    if (await page.$(sel)) {
      userField = sel;
      break;
    }
  }
  let passField = null;
  for (const sel of passSelectors) {
    if (await page.$(sel)) {
      passField = sel;
      break;
    }
  }

  if (!userField || !passField) {
    console.error("Could not find login fields. Inspect tmp/login-page.html.");
    console.log("Pausing 60s so you can interact manually...");
    await page.waitForTimeout(60000);
  } else {
    console.log(`→ filling login (${userField}, ${passField})`);
    await page.fill(userField, USER!);
    await page.fill(passField, PASS!);

    const submitSelectors = [
      'button[type="submit"]',
      'button:has-text("Log in")',
      'button:has-text("Login")',
      'button:has-text("Sign in")',
    ];
    for (const sel of submitSelectors) {
      const el = await page.$(sel);
      if (el) {
        console.log(`→ clicking ${sel}`);
        await el.click();
        break;
      }
    }
  }

  console.log("→ waiting for post-login state (45s, solve CAPTCHA/MFA if needed)");
  await page.waitForTimeout(45000);

  fs.writeFileSync(path.join(OUT_DIR, "post-login.html"), await page.content());
  await page.screenshot({ path: path.join(OUT_DIR, "post-login.png"), fullPage: true });
  console.log("  saved post-login.html + post-login.png");
  console.log("  current url:", page.url());

  // Activity is already on the account-details page. Try to set widest date range.
  // The table has date inputs labelled "From date" and "To date" and a search button.
  try {
    const fromInput = await page.$('input[placeholder*="From" i], input[name*="from" i]');
    const toInput = await page.$('input[placeholder*="To" i], input[name*="to" i]');
    if (fromInput) await fromInput.fill("01/01/2020");
    if (toInput) {
      const today = new Date();
      const dd = String(today.getDate()).padStart(2, "0");
      const mm = String(today.getMonth() + 1).padStart(2, "0");
      await toInput.fill(`${dd}/${mm}/${today.getFullYear()}`);
    }
    const searchBtn = await page.$('button:has-text("Search"), button[aria-label*="Search" i]');
    if (searchBtn) {
      console.log("→ clicking search to widen date range");
      await searchBtn.click();
      await page.waitForTimeout(3000);
    }
  } catch (e) {
    console.log("  date range step skipped:", (e as Error).message);
  }

  // Try to download Excel/CSV — look for icons/links near the table
  const downloadTriggers = [
    'a[href*=".csv" i]',
    'a[href*=".xls" i]',
    'a[href*="export" i]',
    'a[title*="Excel" i]',
    'a[title*="CSV" i]',
    'a[aria-label*="Excel" i]',
    'a[aria-label*="CSV" i]',
    'img[alt*="Excel" i]',
    'button[title*="Excel" i]',
  ];
  let downloaded = false;
  for (const sel of downloadTriggers) {
    const el = await page.$(sel);
    if (el) {
      console.log(`→ trying download trigger ${sel}`);
      try {
        const [download] = await Promise.all([
          page.waitForEvent("download", { timeout: 15000 }),
          el.click(),
        ]);
        const suggested = download.suggestedFilename();
        const dest = path.join(OUT_DIR, `etoll-${Date.now()}-${suggested}`);
        await download.saveAs(dest);
        console.log(`  saved ${dest}`);
        downloaded = true;
        break;
      } catch (e) {
        console.log("  download didn't fire:", (e as Error).message);
      }
    }
  }

  if (!downloaded) {
    // Dump every link/button on the page so we can identify the export trigger
    const links = await page.$$eval("a, button, img", (els) =>
      els
        .map((el) => ({
          tag: el.tagName,
          text: (el.textContent || "").trim().slice(0, 40),
          href: (el as HTMLAnchorElement).href || "",
          title: el.getAttribute("title") || "",
          alt: el.getAttribute("alt") || "",
          aria: el.getAttribute("aria-label") || "",
          src: (el as HTMLImageElement).src || "",
        }))
        .filter((x) => /excel|csv|export|xls|download/i.test(JSON.stringify(x))),
    );
    fs.writeFileSync(path.join(OUT_DIR, "export-candidates.json"), JSON.stringify(links, null, 2));
    console.log(`  no auto-download — wrote ${links.length} export candidates to export-candidates.json`);
  }

  // Click the Vehicles section to learn how tag IDs map to rego
  console.log("→ expanding Vehicles section");
  try {
    const vehiclesHeader = await page.$('text="Vehicles"');
    if (vehiclesHeader) {
      await vehiclesHeader.click();
      await page.waitForTimeout(2500);
      fs.writeFileSync(path.join(OUT_DIR, "vehicles.html"), await page.content());
      await page.screenshot({ path: path.join(OUT_DIR, "vehicles.png"), fullPage: true });
      console.log("  saved vehicles.html + vehicles.png");
    }
  } catch (e) {
    console.log("  vehicles expand failed:", (e as Error).message);
  }

  // Also expand Tags section
  try {
    const tagsHeader = await page.$('text="Tags"');
    if (tagsHeader) {
      await tagsHeader.click();
      await page.waitForTimeout(2500);
      fs.writeFileSync(path.join(OUT_DIR, "tags.html"), await page.content());
      await page.screenshot({ path: path.join(OUT_DIR, "tags.png"), fullPage: true });
      console.log("  saved tags.html + tags.png");
    }
  } catch (e) {
    console.log("  tags expand failed:", (e as Error).message);
  }

  await browser.close();
  console.log("done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
