import { test } from "../_fixtures/test";
import { backOfficeRoutes, STAFF_DYNAMIC, KNOWN_BUG_ROUTES } from "../_manifest/routes";
import { assertRouteRenders, resolveOrSkip } from "../_manifest/sweep";

/**
 * Render sweep over the staff back-office (runs under the `staff` project
 * with staff.lewisham's storage state — role STAFF, so MANAGER_PLUS routes
 * like /staff/ai-insights are excluded by the manifest's role filter).
 * Strict guard throughout.
 */

test.use({ guardMode: "strict" });

for (const route of backOfficeRoutes("STAFF")) {
  test(`renders ${route}`, async ({ page }) => {
    test.fixme(route in KNOWN_BUG_ROUTES, KNOWN_BUG_ROUTES[route]);
    await assertRouteRenders(page, route);
  });
}

for (const dyn of STAFF_DYNAMIC) {
  test(`renders ${dyn.name}`, async ({ page }, testInfo) => {
    const route = await resolveOrSkip(dyn, testInfo);
    test.skip(!route, `no representative row for ${dyn.name}`);
    await assertRouteRenders(page, route!);
  });
}
