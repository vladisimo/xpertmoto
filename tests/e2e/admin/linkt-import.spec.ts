import path from "node:path";
import { test, expect } from "../_fixtures/test";

/**
 * Linkt toll CSV import — the upload path that replaced the
 * Incapsula-blocked portal scraper. Creates a Linkt account through the
 * admin integrations UI,
 * uploads the committed sample export (preamble + header + 2 trips on an
 * unknown plate), and asserts the import summary reports the rows landing
 * in the unmatched queue.
 */

test.use({ guardMode: "strict" });

test("admin uploads a Linkt CSV export and rows land in the unmatched queue", async ({
  page,
}) => {
  test.setTimeout(120_000);
  // The Linkt account + upload UI lives on the admin integrations hub;
  // the staff fleet Tolls tab is read-only transactions.
  await page.goto("/admin/integrations?tab=tolls");

  // One account per run — unique name so repeats don't collide.
  const accountName = `E2E Linkt ${Date.now().toString(36)}`;
  // Both Linkt and eToll render add-account forms on this tab — scope
  // everything to the Linkt (Transurban) section.
  const linkt = page.locator("section").filter({ hasText: "Linkt (Transurban)" });
  await expect(linkt.getByText("Add account").first()).toBeVisible({ timeout: 15_000 });
  await linkt.getByPlaceholder(/account label/i).fill(accountName);
  await linkt.getByPlaceholder(/username \/ email/i).fill("e2e-linkt-user");
  await linkt.getByPlaceholder("Password").fill("e2e-linkt-pass");
  await linkt.getByRole("button", { name: /add account/i }).click();
  await expect(linkt.getByText(accountName)).toBeVisible({ timeout: 15_000 });

  // "Upload export" opens a native file chooser (hidden input behind a ref).
  const chooserPromise = page.waitForEvent("filechooser");
  await linkt.getByRole("button", { name: /upload export/i }).first().click();
  const chooser = await chooserPromise;
  await chooser.setFiles(path.resolve(__dirname, "../_assets/linkt-sample.csv"));

  // Import summary: 2 rows fetched, 2 unmatched (unknown plate).
  await expect(linkt.getByText(/import .*2 rows/i)).toBeVisible({ timeout: 30_000 });
  await expect(linkt.getByText(/2 unmatched/i)).toBeVisible();
});
