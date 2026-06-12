import { mergeTests } from "@playwright/test";
import { test as authTest } from "./auth";
import { test as apiTest } from "./api";

/**
 * The single `test` every spec should import. Merges:
 *  - browser-guard (via auth): console/pageerror/network-failure capture on
 *    every page — see _fixtures/browser-guard.ts for modes and allowlist
 *  - auth: customerPage / staffPage / adminPage / freshCustomerPage
 *  - api: publicApi / customerApi / staffApi / adminApi tRPC clients
 *
 * `auth.setup.ts` intentionally stays on plain @playwright/test — pre-auth
 * flows produce expected 401s the guard would flag.
 */
export const test = mergeTests(authTest, apiTest);

export { expect } from "@playwright/test";
