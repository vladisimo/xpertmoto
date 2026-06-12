import { test, expect } from "./_fixtures/test";

/**
 * Smoke test for the Live Visitor View.
 *
 * Full happy-path (visitor → staff → reply → file → disconnect) requires
 * a Redis-backed environment and a seeded staff account. This test covers
 * the two things that don't require either:
 *
 *   1. Visitor heartbeat path is publicly reachable and sets a cookie.
 *   2. Staff /staff/live route is gated and redirects to /login.
 *
 * The rich integration scenario is documented in the plan file at
 * ~/.claude/plans/something-to-consider-i-jaunty-meadow.md and should be
 * expanded here once `STORYBOOK`-style staff session helpers land.
 */

test("public visit sets the xpertmoto_vid cookie", async ({ page, context }) => {
  await page.goto("/");
  const cookies = await context.cookies();
  const vid = cookies.find((c) => c.name === "xpertmoto_vid");
  expect(vid?.value).toMatch(/^v_/);
});

test("staff /staff/live redirects unauthenticated users to /login", async ({ page }) => {
  await page.goto("/staff/live");
  await expect(page).toHaveURL(/\/login/);
});

test("staff-online count endpoint responds to public GET via tRPC batch", async ({
  request,
}) => {
  const res = await request.get(
    "/api/trpc/live.staffOnlineCount?batch=1&input=" +
      encodeURIComponent(JSON.stringify({ "0": { json: null, meta: { values: ["undefined"] } } })),
  );
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as Array<{ result: { data: { json: { count: number } } } }>;
  const count = body?.[0]?.result?.data?.json?.count;
  expect(typeof count).toBe("number");
});
