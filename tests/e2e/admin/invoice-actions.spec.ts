import { test, expect } from "../_fixtures/test";
import { createConfirmedBooking } from "../_fixtures/factory";
import { e2ePrisma } from "../_fixtures/db";

/**
 * Finance → Invoices actions. A factory booking generates its own invoice
 * (stub confirm issues one), so the spec never touches seeded rows. The
 * page uses window.prompt/confirm for credit/void — handled via dialog
 * events.
 */

test.use({ guardMode: "strict" });

test("void an invoice from the invoices table (prompt + confirm)", async ({
  page,
  customerApi,
}) => {
  test.setTimeout(120_000);
  const booking = await createConfirmedBooking(customerApi, { slot: 3, durationDays: 2 });
  const invoice = await e2ePrisma.invoice.findFirst({
    where: { bookingId: booking.bookingId },
    select: { id: true, invoiceNumber: true },
  });
  expect(invoice, "stub confirm issues an invoice").toBeTruthy();

  await page.goto("/admin/finance/invoices");
  const row = page.getByRole("row").filter({ hasText: invoice!.invoiceNumber });
  await expect(row).toBeVisible({ timeout: 20_000 });

  // window.prompt (reason) then window.confirm — accept both.
  page.on("dialog", (dialog) => {
    void dialog.accept(dialog.type() === "prompt" ? "e2e void test" : undefined);
  });
  await row.getByRole("button", { name: /^void$/i }).click();

  await expect
    .poll(
      async () =>
        (await e2ePrisma.invoice.findUnique({ where: { id: invoice!.id }, select: { status: true } }))
          ?.status,
      { timeout: 20_000 },
    )
    .toBe("VOID");
  await expect(row.getByText(/void/i).first()).toBeVisible();
});
