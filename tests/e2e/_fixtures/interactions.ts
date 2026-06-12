import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Shared interaction helpers for "does clicking this actually do something"
 * assertions. The browser guard catches handlers that throw or mutations
 * that 4xx/5xx; these helpers catch the quieter failure mode — a click that
 * produces no observable effect at all.
 */

/**
 * Click every Radix tab on the page in order and assert each one selects and
 * shows a tabpanel. Returns the tab names crawled.
 */
export async function crawlTabs(page: Page): Promise<string[]> {
  const names: string[] = [];
  const count = await page.getByRole("tab").count();
  for (let i = 0; i < count; i++) {
    const tab = page.getByRole("tab").nth(i);
    const name = (await tab.innerText()).trim();
    names.push(name);
    const urlBefore = page.url();
    await tab.click();
    await expect(tab, `tab "${name}" did not select`).toHaveAttribute("aria-selected", "true");
    // Two tab-bar styles exist: real Radix Tabs (TabsContent → role=tabpanel)
    // and URL-driven bars (TabsTrigger only; the page swaps content off
    // `?tab=`). Accept either a visible tabpanel or a URL change. (The
    // URL-driven style leaves role=tab without a tabpanel — ARIA gap noted
    // in docs/frontend-test-findings.md.)
    const hasPanel = (await page.getByRole("tabpanel").count()) > 0;
    if (hasPanel) {
      await expect(
        page.getByRole("tabpanel").first(),
        `no visible tabpanel after selecting "${name}"`,
      ).toBeVisible();
    } else if (page.url() === urlBefore && i > 0) {
      throw new Error(
        `tab "${name}" selected but produced neither a tabpanel nor a URL change`,
      );
    }
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
  }
  return names;
}

/**
 * Click a control and require at least one observable effect within the
 * timeout: URL change, a dialog/sheet opening, an aria-expanded flip, a
 * same-origin network request, or a DOM mutation under <main>. Use on
 * primary CTAs — not as a blanket button crawl (mutating surfaces need flow
 * specs with explicit success/error assertions instead).
 */
export async function expectObservableEffect(
  page: Page,
  locator: Locator,
  opts: { timeoutMs?: number; label?: string } = {},
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 3_000;
  const label = opts.label ?? (await locator.innerText().catch(() => "control"));

  const urlBefore = page.url();
  const expandedBefore = await locator.getAttribute("aria-expanded").catch(() => null);
  const mutationFlag = await page.evaluate(() => {
    const target = document.querySelector("main") ?? document.body;
    const w = window as unknown as { __e2eMutated?: boolean; __e2eObserver?: MutationObserver };
    w.__e2eMutated = false;
    w.__e2eObserver?.disconnect();
    w.__e2eObserver = new MutationObserver(() => {
      w.__e2eMutated = true;
    });
    w.__e2eObserver.observe(target, { childList: true, subtree: true, attributes: true });
    return true;
  });
  expect(mutationFlag).toBe(true);

  let sawRequest = false;
  const onRequest = () => {
    sawRequest = true;
  };
  page.on("request", onRequest);
  try {
    await locator.click();
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (page.url() !== urlBefore) return;
      if (sawRequest) return;
      if (await page.getByRole("dialog").first().isVisible().catch(() => false)) return;
      if (await page.getByRole("alertdialog").first().isVisible().catch(() => false)) return;
      const expandedNow = await locator.getAttribute("aria-expanded").catch(() => null);
      if (expandedNow !== expandedBefore) return;
      const mutated = await page
        .evaluate(() => (window as unknown as { __e2eMutated?: boolean }).__e2eMutated === true)
        .catch(() => false);
      if (mutated) return;
      await page.waitForTimeout(150);
    }
    throw new Error(
      `Dead control: clicking "${label}" produced no observable effect within ${timeoutMs}ms ` +
        `(no navigation, dialog, aria-expanded change, network request, or DOM mutation).`,
    );
  } finally {
    page.off("request", onRequest);
    await page
      .evaluate(() => {
        const w = window as unknown as { __e2eObserver?: MutationObserver };
        w.__e2eObserver?.disconnect();
      })
      .catch(() => {});
  }
}
