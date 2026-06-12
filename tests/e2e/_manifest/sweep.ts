import { expect, type Page, type TestInfo } from "@playwright/test";
import type { DynamicRoute } from "./routes";

/**
 * Shared body of the per-route render sweep. Asserts the route responds
 * < 400, keeps the session (no bounce to login / TOTP / portal-select),
 * mounts real content (not an error boundary or not-found shell), then waits
 * for client queries to settle so the strict browser-guard sees late tRPC
 * failures before the test ends.
 */
export async function assertRouteRenders(page: Page, route: string): Promise<void> {
  const res = await page.goto(route, { waitUntil: "domcontentloaded" });
  expect(res, `no response for ${route}`).toBeTruthy();
  expect(res!.status(), `HTTP status for ${route}`).toBeLessThan(400);
  if (!/^\/(login|portal-select)/.test(route)) {
    await expect(page).not.toHaveURL(/\/(login|portal-select|totp\/enroll|verify-2fa-step-up)(\?|$)/);
  }
  // Error-boundary / hard-crash markers only. Keep these phrases specific —
  // "application error" alone false-positives on the privacy policy's
  // "application error monitoring" sentence.
  await expect(page.locator("body")).not.toContainText(
    /application error: a (client|server)-side exception|something went wrong|internal server error|this page could not be found/i,
  );
  // Wait for the content to mount — redirect stubs (e.g. /staff/incidents →
  // /staff/fleet?tab=incidents) land here mid-stream showing only the
  // loading shell, so give <main> time to appear. Some layouts (auth pages)
  // render no <main> landmark at all — accept non-trivial body content.
  try {
    await expect(page.locator("main").first()).toBeVisible({ timeout: 15_000 });
  } catch {
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    const textLength = (await page.locator("body").innerText()).trim().length;
    expect(textLength, `page body looks empty for ${route}`).toBeGreaterThan(40);
  }
  // Allow client-side queries to land; ignore pages that keep polling.
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
}

/** Resolve a dynamic route inside the test; annotate-skip when unresolvable. */
export async function resolveOrSkip(
  dyn: DynamicRoute,
  testInfo: TestInfo,
): Promise<string | null> {
  const route = await dyn.resolve();
  if (!route) {
    testInfo.annotations.push({
      type: "skip-reason",
      description: `${dyn.name}: no seeded row to resolve a representative id`,
    });
  }
  return route;
}
