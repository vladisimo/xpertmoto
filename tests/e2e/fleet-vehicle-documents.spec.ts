import { test, expect } from "./_fixtures/test";
import { login as sharedLogin } from "./_fixtures/login";
import { e2ePrisma as prisma } from "./_fixtures/db";

/**
 * Documents tab smoke. Staff uploads a CTP document with an expiry date
 * far in the future and confirms the Documents table surfaces the row
 * with a "Valid" status badge and the vehicle's `ctpExpiry` has been
 * updated to match.
 */

const STAFF = { email: "staff.lewisham@xpertmoto.com.au", password: "staff1234" };

test.afterAll(async () => {
  await prisma.$disconnect();
});

test("staff can upload a CTP document and it updates the vehicle's CTP expiry", async ({ page }) => {
  // Pick any seeded vehicle at the staff member's depot. The seed includes
  // several; we just need one.
  const vehicle = await prisma.vehicle.findFirst({ where: { isActive: true, deletedAt: null } });
  test.skip(!vehicle, "No seeded vehicle — run `npm run db:seed`");

  await sharedLogin(page, STAFF.email, STAFF.password);
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

  // The vehicle's ctpExpiry is the contract — assert it in the DB (display
  // format drifts; the date does not), then check the Overview tab shows it.
  await expect
    .poll(
      async () =>
        (
          await prisma.vehicle.findUnique({
            where: { id: vehicle!.id },
            select: { ctpExpiry: true },
          })
        )?.ctpExpiry?.toISOString().slice(0, 10),
      { timeout: 15_000 },
    )
    .toBe("2027-06-30");
  await page.getByRole("tab", { name: /overview/i }).click();
  await expect(page.getByText(/CTP expiry/i)).toBeVisible();
  await expect(page.getByText(/2027/).first()).toBeVisible();
});
