import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

// E2E_DB=1 runs against the isolated `xpertmoto_e2e` database via `npm run
// dev:e2e` (see .env.e2e + package.json). Default port shifts to 3100 so it
// never reuses a plain dev server already running on 3000 against the dev DB.
const E2E_DB = process.env.E2E_DB === "1";
const PORT = process.env.PORT ?? (E2E_DB ? "3137" : "3000");
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

const STORAGE_DIR = path.resolve(__dirname, "tests/e2e/.auth");
export const STORAGE_STATE = {
  customer: path.join(STORAGE_DIR, "customer.json"),
  staff: path.join(STORAGE_DIR, "staff.json"),
  admin: path.join(STORAGE_DIR, "admin.json"),
};

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  globalSetup: require.resolve("./tests/e2e/global-setup"),
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    locale: "en-AU",
    timezoneId: "Australia/Brisbane",
  },
  projects: [
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: "public",
      use: { ...devices["Desktop Chrome"] },
      // Public, unauthenticated specs only. Exclude fixtures/POMs and the
      // role-scoped dirs (those run in the customer/staff/admin projects with
      // their own storage state — running them here would have no session).
      testIgnore:
        /(_fixtures|_pom|auth\.setup|global-setup|[/\\](customer|staff|admin|booking|payments)[/\\])/,
    },
    {
      name: "customer",
      use: { ...devices["Desktop Chrome"], storageState: STORAGE_STATE.customer },
      testMatch: /(customer|booking|payments)\/.*\.spec\.ts/,
      dependencies: ["setup"],
    },
    {
      name: "staff",
      use: { ...devices["Desktop Chrome"], storageState: STORAGE_STATE.staff },
      testMatch: /staff\/.*\.spec\.ts/,
      dependencies: ["setup"],
    },
    {
      name: "admin",
      use: { ...devices["Desktop Chrome"], storageState: STORAGE_STATE.admin },
      testMatch: /admin\/.*\.spec\.ts/,
      dependencies: ["setup"],
    },
    {
      name: "mobile-customer",
      use: { ...devices["iPhone 14"], storageState: STORAGE_STATE.customer },
      testMatch: /booking\/.*mobile.*\.spec\.ts/,
      dependencies: ["setup"],
    },
    {
      name: "tablet-staff",
      use: { ...devices["iPad (gen 7)"], storageState: STORAGE_STATE.staff },
      testMatch: /staff\/.*(inspect|tablet).*\.spec\.ts/,
      dependencies: ["setup"],
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: E2E_DB ? "npm run dev:e2e" : "npm run dev",
        url: baseURL,
        // For the e2e DB profile always start a fresh server bound to the e2e
        // database — never reuse whatever happens to be on 3000.
        reuseExistingServer: E2E_DB ? false : !process.env.CI,
        timeout: 120_000,
      },
});
