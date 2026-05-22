import { test as base, type Page, type BrowserContext } from "@playwright/test";
import { STORAGE_STATE } from "../../../playwright.config";

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

async function newContextFromState(
  browser: import("@playwright/test").Browser,
  storageState: string,
): Promise<BrowserContext> {
  return browser.newContext({ storageState });
}

export const test = base.extend<RoleContexts>({
  customerPage: async ({ browser }, use) => {
    const ctx = await newContextFromState(browser, STORAGE_STATE.customer);
    const page = await ctx.newPage();
    await use(page);
    await ctx.close();
  },
  staffPage: async ({ browser }, use) => {
    const ctx = await newContextFromState(browser, STORAGE_STATE.staff);
    const page = await ctx.newPage();
    await use(page);
    await ctx.close();
  },
  adminPage: async ({ browser }, use) => {
    const ctx = await newContextFromState(browser, STORAGE_STATE.admin);
    const page = await ctx.newPage();
    await use(page);
    await ctx.close();
  },
  freshCustomerEmail: async ({}, use) => {
    const email = `e2e+${Date.now()}-${Math.random().toString(36).slice(2, 8)}@xpertmoto.test`;
    await use(email);
  },
  freshCustomerPage: async ({ browser, freshCustomerEmail }, use) => {
    const ctx = await browser.newContext();
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
