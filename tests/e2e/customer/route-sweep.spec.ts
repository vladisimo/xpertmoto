import { test } from "../_fixtures/test";
import { CUSTOMER_ROUTES, CUSTOMER_DYNAMIC } from "../_manifest/routes";
import { assertRouteRenders, resolveOrSkip } from "../_manifest/sweep";

/**
 * Render sweep over the authenticated customer portal (runs under the
 * `customer` project with sarah.smith's storage state). Strict guard: any
 * console error, page error, or failed same-origin request fails the route.
 */

test.use({ guardMode: "strict" });

for (const route of CUSTOMER_ROUTES) {
  test(`renders ${route}`, async ({ page }) => {
    await assertRouteRenders(page, route);
  });
}

for (const dyn of CUSTOMER_DYNAMIC) {
  test(`renders ${dyn.name}`, async ({ page }, testInfo) => {
    const route = await resolveOrSkip(dyn, testInfo);
    test.skip(!route, `no representative row for ${dyn.name}`);
    await assertRouteRenders(page, route!);
  });
}
