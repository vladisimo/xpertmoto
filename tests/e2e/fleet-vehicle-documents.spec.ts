import { test, expect } from "@playwright/test";
import { prisma } from "../../src/lib/prisma";

/**
 * Documents tab smoke. Staff uploads a CTP document with an expiry date
 * far in the future and confirms the Documents table surfaces the row
 * with a "Valid" status badge and the vehicle's `ctpExpiry` has been
 * updated to match.
 */

const STAFF = { email: "staff.gold-coast@xpertmoto.com.au", password: "staff1234" };

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.fill('input[type="email"]', STAFF.email);
  await page.fill('input[type="password"]', STAFF.password);
  await Promise.all([
    page
      .waitForURL((url) => !/\/login(\?|$)/.test(url.toString()), { timeout: 30_000 })
      .catch(() => undefined),
    page.getByRole("button", { name: /sign in|log in/i }).click(),
  ]);
}

test.afterAll(async () => {
  await prisma.$disconnect();
});

test("staff can upload a CTP document and it updates the vehicle's CTP expiry", async ({ page }) => {
  // Pick any seeded vehicle at the staff member's depot. The seed includes
  // several; we just need one.
  const vehicle = await prisma.vehicle.findFirst({ where: { isActive: true, deletedAt: null } });
  test.skip(!vehicle, "No seeded vehicle — run `npm run db:seed`");

  await login(page);
  await page.goto(`/staff/fleet/vehicles/${vehicle!.id}?tab=documents`);

  await expect(page.getByRole("heading", { name: /documents/i })).toBeVisible();
  await page.getByRole("button", { name: /upload document/i }).click();

  // Drop zone renders — dropzone input is a native file input, so we can
  // set its files directly rather than simulating a drag event.
  const fileInput = page.locator('input[type="file"]').last();
  const pdfBuffer = Buffer.from("%PDF-1.4\n%EOF\n");
  await fileInput.setInputFiles({ name: "ctp.pdf", mimeType: "application/pdf", buffer: pdfBuffer });

  // Wait for the upload to resolve — the "Save document" button is
  // enabled only once we have a stored URL.
  const saveBtn = page.getByRole("button", { name: /save document/i });
  await expect(saveBtn).toBeEnabled({ timeout: 15_000 });

  // Type is CTP by default. Fill the expiry field.
  await page.locator('input[type="date"]').first().fill("2027-06-30");
  await saveBtn.click();

  // Back on the Documents tab — the new row is visible with a valid badge.
  await expect(page.getByText("CTP").first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/valid/i).first()).toBeVisible();

  // Overview tab reflects the updated CTP expiry.
  await page.getByRole("tab", { name: /overview/i }).click();
  await expect(page.getByText(/CTP expiry/i)).toBeVisible();
  await expect(page.getByText(/30 Jun 2027/i)).toBeVisible();
});
