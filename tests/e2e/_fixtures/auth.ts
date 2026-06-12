import { type Page, type Browser, type BrowserContext } from "@playwright/test";
import { STORAGE_STATE } from "../../../playwright.config";
import { test as guardTest, attachGuard, type BrowserIssue } from "./browser-guard";

type RoleContexts = {
  customerPage: Page;
  staffPage: Page;
  adminPage: Page;
  /**
   * A page in a brand-new context that has just registered a fresh customer
   * account with a unique email. Useful for registration / first-login specs
   * that must not collide with the seeded `sarah.smith@example.com` account.
   */
  freshCustomerPage: Page;
  freshCustomerEmail: string;
};

// Role fixtures create their own contexts (bypassing the guarded default
// `context` fixture), so each attaches the browser-issue guard itself. Issues
// land in the test's shared `browserIssues` sink.
async function newGuardedContext(
  browser: Browser,
  sink: BrowserIssue[],
  baseURL: string | undefined,
  storageState?: string,
): Promise<BrowserContext> {
  const ctx = await browser.newContext(storageState ? { storageState } : {});
  if (baseURL) attachGuard(ctx, sink, baseURL);
  return ctx;
}

export const test = guardTest.extend<RoleContexts>({
  customerPage: async ({ browser, browserIssues, baseURL }, use) => {
    const ctx = await newGuardedContext(browser, browserIssues, baseURL, STORAGE_STATE.customer);
    const page = await ctx.newPage();
    await use(page);
    await ctx.close();
  },
  staffPage: async ({ browser, browserIssues, baseURL }, use) => {
    const ctx = await newGuardedContext(browser, browserIssues, baseURL, STORAGE_STATE.staff);
    const page = await ctx.newPage();
    await use(page);
    await ctx.close();
  },
  adminPage: async ({ browser, browserIssues, baseURL }, use) => {
    const ctx = await newGuardedContext(browser, browserIssues, baseURL, STORAGE_STATE.admin);
    const page = await ctx.newPage();
    await use(page);
    await ctx.close();
  },
  freshCustomerEmail: async ({}, use) => {
    const email = `e2e+${Date.now()}-${Math.random().toString(36).slice(2, 8)}@xpertmoto.test`;
    await use(email);
  },
  freshCustomerPage: async ({ browser, browserIssues, baseURL, freshCustomerEmail }, use) => {
    const ctx = await newGuardedContext(browser, browserIssues, baseURL);
    const page = await ctx.newPage();
    await page.goto("/register");
    await page.fill('input[type="email"]', freshCustomerEmail);
    await page.fill('input[type="password"]', "FreshPass1234!");
    await page
      .getByRole("button", { name: /create account|register|sign up/i })
      .click();
    await page.waitForURL(/dashboard|verify|onboard/i, { timeout: 15_000 });
    await use(page);
    await ctx.close();
  },
});

export { expect } from "@playwright/test";
