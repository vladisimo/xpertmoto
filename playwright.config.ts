import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const PORT = process.env.PORT ?? "3000";
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
      testIgnore: /(_fixtures|_pom|auth\.setup|global-setup)/,
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
        command: "npm run dev",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
