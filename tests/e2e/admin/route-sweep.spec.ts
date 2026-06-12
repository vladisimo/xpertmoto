import { test } from "../_fixtures/test";
import { backOfficeRoutes, ADMIN_DYNAMIC } from "../_manifest/routes";
import { assertRouteRenders, resolveOrSkip } from "../_manifest/sweep";

/**
 * Render sweep over the admin back-office (runs under the `admin` project —
 * admin@xpertmoto.com.au is SUPER_ADMIN, so /admin/platform and
 * /admin/settings are in scope). Strict guard throughout.
 */

test.use({ guardMode: "strict" });

for (const route of backOfficeRoutes("SUPER_ADMIN")) {
  test(`renders ${route}`, async ({ page }) => {
    await assertRouteRenders(page, route);
  });
}

for (const dyn of ADMIN_DYNAMIC) {
  test(`renders ${dyn.name}`, async ({ page }, testInfo) => {
    const route = await resolveOrSkip(dyn, testInfo);
    test.skip(!route, `no representative row for ${dyn.name}`);
    await assertRouteRenders(page, route!);
  });
}
