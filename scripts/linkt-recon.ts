/**
 * Phase 0 feasibility spike for the Linkt portal scraper. THROWAWAY / manual.
 *
 *   LINKT_USER=you@example.com LINKT_PASS=secret \
 *   LINKT_PROXY_URL=http://user:pass@host:port \   # optional residential proxy
 *   LINKT_HEADLESS=1 \                              # 1 = headless, else headful
 *   npx tsx scripts/linkt-recon.ts
 *
 * Confirms whether the stealth config in `launchLinktContext` reaches the
 * trips-financial-history data past Incapsula, and reverse-engineers the export
 * mechanism. Persistent context (tmp/linkt-sessions/recon) carries the session
 * forward between runs. Everything is dumped to tmp/linkt-debug/.
 */
import * as path from "path";
import * as fs from "fs";
import * as dotenv from "dotenv";
import { launchLinktContext } from "../src/server/services/linkt-scrape";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const USER = process.env.LINKT_USER;
const PASS = process.env.LINKT_PASS;
const HEADLESS = process.env.LINKT_HEADLESS === "1";
const LOGIN_URL = process.env.LINKT_LOGIN_URL ?? "https://www.linkt.com.au/login";
const TRIPS_URL =
  process.env.LINKT_TRIPS_URL ?? "https://www.linkt.com.au/my-account/trips-financial-history";
const OUT = path.resolve(__dirname, "../tmp/linkt-debug");

type NetEntry = { method: string; url: string; status: number | null; ct: string | null };

async function main() {
  if (!USER || !PASS) {
    console.error("Set LINKT_USER and LINKT_PASS in .env");
    process.exit(1);
  }
  fs.mkdirSync(OUT, { recursive: true });

  const context = await launchLinktContext({
    accountId: "recon",
    headless: HEADLESS,
    slowMo: HEADLESS ? 0 : 150,
  });
  const page = context.pages()[0] ?? (await context.newPage());

  // Capture API traffic from the very start so we see the trips/export XHRs.
  const net: NetEntry[] = [];
  page.on("requestfinished", async (req) => {
    const url = req.url();
    if (!/\/api\/|\/v1\/|export|transaction|trips|financial|statement|\.csv|\.xls/i.test(url)) return;
    let status: number | null = null;
    let ct: string | null = null;
    try {
      const resp = await req.response();
      status = resp ? resp.status() : null;
      ct = resp ? (resp.headers()["content-type"] ?? null) : null;
    } catch {
      /* ignore */
    }
    net.push({ method: req.method(), url, status, ct });
  });

  // Detailed capture of every dxapi.linkt.com.au call (auth model + JSON shapes)
  // so we can drive the export/history API directly. Full detail (incl. the auth
  // token + bodies) goes to gitignored tmp files; only non-secret summary is logged.
  const dxapi: Array<{ method: string; url: string; status: number; ctype: string | null; hasAuth: boolean; authLen: number }> = [];
  let dxapiSeq = 0;
  page.on("response", async (resp) => {
    const req = resp.request();
    const url = req.url();
    if (!/dxapi\.linkt\.com\.au/i.test(url)) return;
    const reqHeaders = await req.allHeaders().catch(() => ({}) as Record<string, string>);
    const auth = reqHeaders["authorization"] ?? "";
    const ctype = resp.headers()["content-type"] ?? null;
    let body = "";
    try {
      if (ctype && /json|text/i.test(ctype)) body = (await resp.text()).slice(0, 6000);
    } catch {
      /* some bodies aren't readable post-hoc */
    }
    const seq = String(++dxapiSeq).padStart(2, "0");
    fs.writeFileSync(
      path.join(OUT, `dxapi-${seq}.json`),
      JSON.stringify(
        { method: req.method(), url, status: resp.status(), ctype, reqHeaders, postData: req.postData() ?? null, body },
        null,
        2,
      ),
    );
    dxapi.push({ method: req.method(), url, status: resp.status(), ctype, hasAuth: !!auth, authLen: auth.length });
  });

  page.on("download", async (d) => {
    const fn = d.suggestedFilename();
    console.log("  ⤓ download:", fn);
    await d.saveAs(path.join(OUT, `download-${fn}`)).catch(() => {});
  });

  const snap = async (label: string) => {
    await page.screenshot({ path: path.join(OUT, `recon-${label}.png`), fullPage: true }).catch(() => {});
    fs.writeFileSync(path.join(OUT, `recon-${label}.html`), await page.content().catch(() => ""));
    console.log(`  saved recon-${label}.{png,html} — url=${page.url()}`);
  };

  console.log("→ login page");
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  await snap("login");

  // Two-step MUI login: Username → submit → Password → submit. Both steps share
  // data-testid="usernameCheck-submit". A persisted session may skip straight to
  // /my-account.
  const SUBMIT = 'button[data-testid="usernameCheck-submit"]';
  const userField = page.locator('#loginForm-username-field, input[name="username"]').first();
  const passField = page.locator('#password, input[name="password"], input[type="password"]').first();
  const onLogin = () => /\/(my-)?login/i.test(page.url());

  if ((await userField.count()) && onLogin()) {
    console.log("→ username step");
    await userField.click();
    await userField.pressSequentially(USER, { delay: 25 });
    await page.locator(SUBMIT).first().click().catch(() => {});
    await passField.waitFor({ state: "visible", timeout: 15_000 }).catch(() => {});
    if (await passField.isVisible().catch(() => false)) {
      console.log("→ password step");
      await passField.click();
      await passField.pressSequentially(PASS, { delay: 25 });
      await page.locator(SUBMIT).first().click().catch(() => {});
    }
    await page.waitForURL(() => !onLogin(), { timeout: 25_000 }).catch(() => {});
  }
  console.log(`  post-login url=${page.url()} (logged in: ${!onLogin()})`);

  console.log("→ trips / financial history");
  await page.goto(TRIPS_URL, { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 25_000 }).catch(() => {});
  await page.waitForTimeout(3000);
  await snap("trips");

  // Dump every clickable so we can pin the export trigger.
  const buttons = await page.$$eval("button, a, [role=button]", (els) =>
    els
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        text: (el.textContent ?? "").trim().slice(0, 50),
        aria: el.getAttribute("aria-label"),
        testid: el.getAttribute("data-testid"),
        title: el.getAttribute("title"),
      }))
      .filter((b) => b.text || b.aria || b.testid || b.title),
  );
  fs.writeFileSync(path.join(OUT, "trips-buttons.json"), JSON.stringify(buttons, null, 2));
  console.log(`  → trips-buttons.json (${buttons.length} clickables)`);

  // Try to open the export modal by several strategies, then pick CSV/Excel.
  const triggers = [
    page.getByRole("button", { name: /export/i }),
    page.getByRole("link", { name: /export/i }),
    page.locator('[aria-label*="export" i], [title*="export" i], [data-testid*="export" i]'),
    page.getByText(/^export$/i),
  ];
  let opened = false;
  for (const t of triggers) {
    if (await t.first().count()) {
      console.log(`→ clicking export trigger (${await t.count()} match)`);
      await t.first().click({ timeout: 6000 }).catch(() => {});
      await page.waitForTimeout(2500);
      opened = true;
      break;
    }
  }
  await snap("export-modal");
  if (opened) {
    const csv = page.getByRole("button", { name: /csv/i }).first();
    const xls = page.getByRole("button", { name: /excel|xls/i }).first();
    if (await csv.count()) {
      console.log("→ CSV export");
      await csv.click({ timeout: 6000 }).catch(() => {});
    } else if (await xls.count()) {
      console.log("→ Excel export");
      await xls.click({ timeout: 6000 }).catch(() => {});
    } else {
      console.log("  no CSV/Excel button in modal (see recon-export-modal.*)");
    }
    await page.waitForTimeout(12_000); // let the async export job run + download
  } else {
    console.log("  no export trigger found — see trips-buttons.json");
  }

  fs.writeFileSync(path.join(OUT, "export-network.json"), JSON.stringify(net, null, 2));
  console.log(`  → export-network.json (${net.length} API/export requests)`);

  fs.writeFileSync(path.join(OUT, "dxapi-summary.json"), JSON.stringify(dxapi, null, 2));
  console.log(`\n  dxapi calls (${dxapi.length}) — auth model + endpoints:`);
  for (const d of dxapi) {
    const pathOnly = d.url.replace(/^https?:\/\/dxapi\.linkt\.com\.au/, "").slice(0, 90);
    console.log(`    ${d.method} ${d.status} auth=${d.hasAuth ? `Bearer(${d.authLen})` : "none"} ${pathOnly}`);
  }

  console.log("\nDone. Inspect tmp/linkt-debug/.");
  await context.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
