import path from "node:path";
import { test, expect } from "../_fixtures/test";

/**
 * NSW driver-nomination workspace smoke. The Fleet → Nominations tab is the
 * back-office surface for the semi-automated nomination workflow (there is no
 * Revenue NSW API). This spec asserts the workspace renders and exercises the
 * Service NSW portal-export upload — the sample notices are on unknown plates,
 * so they don't attach to a vehicle and the import summary reports them as
 * unmatched (the upload mutation still completes and surfaces its result).
 */

test.use({ guardMode: "strict" });

test("staff open the Nominations workspace and upload a Revenue NSW export", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/staff/fleet?tab=nominations");

  // The workspace and its import card render.
  await expect(page.getByText(/Import from Service NSW portal/i)).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText(/Awaiting review/i)).toBeVisible();
  await expect(page.getByText(/Nomination deadlines/i)).toBeVisible();

  // Upload the committed sample export via the file input.
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles(path.resolve(__dirname, "../_assets/revenue-nsw-sample.csv"));

  // The import summary message appears (unmatched count reflected).
  await expect(page.getByText(/Imported .* new/i)).toBeVisible({ timeout: 30_000 });
});
