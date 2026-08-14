import { test, expect } from "../_fixtures/test";
import { login } from "../_fixtures/login";
import { e2ePrisma } from "../_fixtures/db";
import { createConfirmedBooking } from "../_fixtures/factory";
import type { Api } from "../_fixtures/api";
import type { Page } from "@playwright/test";

/**
 * Money-lifecycle remediation (Aug 2026) — staff dialog smokes.
 *
 * Covers the five surfaces added by branch `money-lifecycle-remediation`:
 * change-category (Area 4), terminate-for-loss (Area 2), confirm-theft
 * (Area 3), the incident "Charge customer" card (Area 5) and the
 * decommission results view (Area 6).
 *
 * These assert the dialogs mount, gate on role, and render their LIVE
 * SERVER PREVIEW — the part that would silently rot, since every one of
 * them reads a freshly added preview/quote procedure. The committing
 * mutations (real Stripe capture/refund) stay in the Vitest router suites
 * and the Stripe sandbox checklist; the one commit exercised here is the
 * decommission of a throwaway vehicle this spec creates itself, whose
 * results view has no other coverage.
 *
 * Role note: this file runs in the `staff` project (storage state =
 * staff.lewisham, role STAFF). Manager-gated surfaces clear cookies and
 * log in as manager.lewisham — the api fixtures read their cookies from
 * the storage-state files on disk, so they are unaffected by that swap.
 */

const MANAGER = { email: "manager.lewisham@xpertmoto.com.au", password: "staff1234" };

/**
 * Swap the browser session from the project's STAFF storage state to a
 * MANAGER. `manager.lewisham` may carry a customerProfile (auth-and-portal
 * attaches one), which lands the login on /portal-select — take the staff
 * portal when that happens.
 */
async function loginAsManager(page: Page): Promise<void> {
  await page.context().clearCookies();
  await login(page, MANAGER.email, MANAGER.password, {
    expectedUrl: /staff|portal-select/i,
  });
  if (/portal-select/.test(page.url())) {
    await page.getByRole("link", { name: /staff portal/i }).click();
    await page.waitForURL(/staff/i, { timeout: 15_000 });
  }
}

/**
 * A second *rentable* category is needed to preview a category change:
 * `vehicle.listCategories` filters to categories that own bookable stock,
 * and the seed parks every vehicle in one category — so the dialog's
 * dropdown would otherwise be empty. Give the runner-up category a single
 * throwaway vehicle so the preview has somewhere to go.
 */
async function ensureSecondRentableCategory(
  adminApi: Api,
  currentCategoryId: string,
  depotId: string,
): Promise<string | null> {
  const cat = await e2ePrisma.vehicleCategory.findFirst({
    where: { isActive: true, id: { not: currentCategoryId } },
    select: { id: true, name: true },
  });
  if (!cat) return null;

  // "Rentable" means an active vehicle whose catalogue model is rentable —
  // see CATEGORY_HAS_RENTABLE_VEHICLE in src/lib/fleet/consumer-visibility.ts.
  const stocked = await e2ePrisma.vehicle.findFirst({
    where: { categoryId: cat.id, isActive: true, catalogueModel: { isRentable: true } },
    select: { id: true },
  });
  if (!stocked) {
    const model = await e2ePrisma.vehicleModel.findFirst({
      where: { isRentable: true },
      select: { id: true },
    });
    if (!model) return null;

    const tag = `E2ECAT${Date.now().toString().slice(-7)}`;
    const created = await adminApi.fleet.createVehicle.mutate({
      internalCode: tag,
      rego: tag,
      regoState: "NSW",
      make: "Smoke",
      model: "Category",
      year: 2026,
      colour: "Silver",
      categoryId: cat.id,
      depotId,
      currentOdometerKm: 0,
      // IN_MAINTENANCE deliberately: CATEGORY_HAS_RENTABLE_VEHICLE keys off
      // isActive + a rentable catalogue model and ignores status, so this is
      // enough to surface the category in the dialog's dropdown — while
      // factory.refData(), which needs an AVAILABLE vehicle, keeps ignoring
      // the category and allocating out of the seed's 30-strong LAMS pool.
      // An AVAILABLE unit here would hijack every later factory booking into
      // a one-vehicle category and starve them.
      status: "IN_MAINTENANCE",
    });
    // createVehicle takes no catalogue-model link, so wire it here — without
    // it the category stays invisible to `vehicle.listCategories`.
    await e2ePrisma.vehicle.update({
      where: { id: created.id },
      data: { modelId: model.id },
    });
  }
  return cat.name;
}

/**
 * The terminate dialog gates on an in-flight hire. Reaching ACTIVE from a
 * factory booking means driving the whole check-out wizard (agreement
 * signing included), so reuse whatever the seed already has out on the
 * road and skip when it has none — same approach as swap-wizard.spec.ts.
 */
async function findInFlightBookingId(): Promise<string | null> {
  const row = await e2ePrisma.booking.findFirst({
    where: { status: { in: ["ACTIVE", "CHECKED_OUT", "OVERDUE"] }, vehicleId: { not: null } },
    select: { id: true },
  });
  return row?.id ?? null;
}

test.describe("Area 4 — change category", () => {
  test("manager sees all three pricing modes and a live delta preview", async ({
    page,
    customerApi,
    adminApi,
  }) => {
    const booking = await createConfirmedBooking(customerApi, { slot: 11 });
    const row = await e2ePrisma.booking.findUniqueOrThrow({
      where: { id: booking.bookingId },
      select: { categoryId: true, pickupDepotId: true },
    });

    // Stock the target category BEFORE the dialog mounts — its
    // `vehicle.listCategories` query carries a 60s staleTime, so a category
    // that becomes rentable later never reaches the open dropdown.
    const target = await ensureSecondRentableCategory(
      adminApi,
      row.categoryId,
      row.pickupDepotId,
    );

    await loginAsManager(page);
    await page.goto(`/staff/bookings/${booking.bookingId}`);

    await page.getByRole("button", { name: /change category/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(/change vehicle category/i)).toBeVisible();

    // Manager-only pricing modes (staff get CHARGE_DELTA only — asserted below).
    await expect(dialog.getByText(/charge the difference/i)).toBeVisible();
    await expect(dialog.getByText(/goodwill free upgrade/i)).toBeVisible();
    await expect(dialog.getByText(/manager price override/i)).toBeVisible();

    // Before a category is picked the preview panel says so.
    await expect(dialog.getByText(/pick a new category to see the price/i)).toBeVisible();

    if (!target) {
      test.skip(true, "Seed exposes no second rentable category — no change to preview.");
      return;
    }

    await dialog.getByRole("combobox").first().click();
    await page.getByRole("option", { name: target, exact: true }).click();

    // amendCategoryPreview resolved: the quote table replaces the hint. Match
    // the <dt> labels exactly — the dialog prose repeats most of these words.
    await expect(dialog.getByText("Current total", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(dialog.getByText("Delta to settle", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Eligibility", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Availability", { exact: true })).toBeVisible();
  });

  test("staff get charge-the-difference only, and no terminate action", async ({
    page,
    customerApi,
  }) => {
    // Default storage state for this project is staff.lewisham (role STAFF).
    const booking = await createConfirmedBooking(customerApi, { slot: 12 });

    await page.goto(`/staff/bookings/${booking.bookingId}`);
    await page.getByRole("button", { name: /change category/i }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(/change vehicle category/i)).toBeVisible();
    // visibleModes collapses to one entry, so the radio fieldset never renders.
    await expect(dialog.getByText(/goodwill free upgrade/i)).toHaveCount(0);
    await expect(dialog.getByText(/manager price override/i)).toHaveCount(0);

    // TerminateForLossDialog returns null for non-managers.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: /terminate for loss/i })).toHaveCount(0);
  });
});

test.describe("Area 2 — terminate for loss", () => {
  test("manager gets the write-down preview before committing", async ({ page }) => {
    const bookingId = await findInFlightBookingId();
    if (!bookingId) {
      test.skip(true, "No ACTIVE/CHECKED_OUT/OVERDUE booking seeded — skipping.");
      return;
    }

    await loginAsManager(page);
    await page.goto(`/staff/bookings/${bookingId}`);

    await page.getByRole("button", { name: /terminate for loss/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(/terminate hire — vehicle lost/i)).toBeVisible();

    // Settlement + bond choices are the manager's decision, never implied.
    await expect(dialog.getByText(/refund — return the unused days/i)).toBeVisible();
    await expect(dialog.getByText(/credit — issue the unused days/i)).toBeVisible();
    await expect(dialog.getByText(/forfeit — customer keeps no claim/i)).toBeVisible();
    await expect(dialog.getByText(/release the bond hold now/i)).toBeVisible();

    // previewLossTermination resolved — the quote drives the submit button's
    // disabled state, so a rendered figure is the real precondition. Exact
    // <dt> text: the settlement copy above repeats "unused days" three times.
    await expect(dialog.getByText("Unused days", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(dialog.getByText("Invoice write-down", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Balance after", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: /^terminate hire$/i })).toBeEnabled();

    // Cause pre-selects the settlement mode; STOLEN flips it to FORFEIT.
    await dialog.getByRole("combobox").first().click();
    await page.getByRole("option", { name: /^stolen$/i }).click();
    await expect(dialog.getByRole("radio", { name: /forfeit/i })).toBeChecked();
  });
});

test.describe("Area 3/5 — incident theft + charging", () => {
  /** A THEFT incident on a real booking's vehicle, customer-liable. */
  async function seedTheftIncident(
    staffApi: Api,
    booking: { bookingId: string; vehicleId: string | null },
  ): Promise<string> {
    if (!booking.vehicleId) throw new Error("spec: booking has no allocated vehicle");
    const inc = await staffApi.fleet.createIncident.mutate({
      vehicleId: booking.vehicleId,
      bookingId: booking.bookingId,
      type: "THEFT",
      severity: "TOTAL_LOSS",
      dateTime: new Date(),
      description: "e2e smoke — vehicle reported stolen from the depot car park",
      estimatedDamageCost: 4_000,
      customerLiable: true,
    });
    return inc.id;
  }

  test("confirm-theft dialog validates paperwork and offers the charge", async ({
    page,
    customerApi,
    staffApi,
  }) => {
    const booking = await createConfirmedBooking(customerApi, { slot: 13 });
    const incidentId = await seedTheftIncident(staffApi, booking);

    await loginAsManager(page);
    await page.goto(`/staff/incidents/${incidentId}`);

    await page.getByRole("button", { name: /confirm theft/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(/confirm theft — INC/i)).toBeVisible();

    const submit = dialog.getByRole("button", { name: /^confirm theft$/i });

    // Police report is mandatory unless explicitly marked pending with a reason.
    await dialog.locator("#theft-report").fill("");
    await expect(submit).toBeDisabled();

    await dialog.getByText(/report number not yet issued/i).click();
    await expect(submit).toBeDisabled(); // reason still blank
    await dialog.getByPlaceholder(/why is the report pending/i).fill("Lodged, event number to follow");
    await expect(submit).toBeEnabled();

    // The charge defaults inside the insurance-excess headroom.
    await expect(dialog.locator("#theft-charge")).not.toHaveValue("");
    await expect(dialog.getByText(/forfeit — customer keeps no claim/i)).toBeVisible();
    await expect(dialog.getByText(/end the hire now/i)).toBeVisible();
  });

  test("charge-customer card shows the bond-vs-card split and is manager-only", async ({
    page,
    customerApi,
    staffApi,
  }) => {
    const booking = await createConfirmedBooking(customerApi, { slot: 14 });
    const incidentId = await seedTheftIncident(staffApi, booking);

    // Staff (default storage state) must not see the card at all.
    await page.goto(`/staff/incidents/${incidentId}`);
    await expect(page.getByText(/charge customer/i)).toHaveCount(0);

    await loginAsManager(page);
    await page.goto(`/staff/incidents/${incidentId}`);

    await expect(page.getByText(/charge customer/i)).toBeVisible({ timeout: 15_000 });
    const amount = page.locator("#incident-charge-amount");
    await expect(amount).toBeVisible();
    // Excess cap + bond-first split are computed from the live quote.
    await expect(page.getByText(/chargeable/i).first()).toBeVisible();
  });
});

test.describe("Area 6 — decommission results", () => {
  test("decommissioning reports what happened to the vehicle's bookings", async ({
    page,
    adminApi,
  }) => {
    // Throwaway vehicle — decommission is terminal, so never touch seed stock.
    const depot = await e2ePrisma.depot.findFirstOrThrow({
      where: { isActive: true },
      select: { id: true },
    });
    const category = await e2ePrisma.vehicleCategory.findFirstOrThrow({
      where: { isActive: true },
      select: { id: true },
    });
    const tag = `E2E${Date.now().toString().slice(-8)}`;
    const vehicle = await adminApi.fleet.createVehicle.mutate({
      internalCode: tag,
      rego: tag,
      regoState: "NSW",
      make: "Smoke",
      model: "Test",
      year: 2026,
      colour: "Black",
      categoryId: category.id,
      depotId: depot.id,
      currentOdometerKm: 0,
      status: "AVAILABLE",
    });

    await loginAsManager(page);
    await page.goto(`/staff/fleet/vehicles/${vehicle.id}`);

    await page.getByRole("button", { name: /change status/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(new RegExp(`change status — ${tag}`, "i"))).toBeVisible();

    await dialog.getByRole("combobox").first().click();
    await page.getByRole("option", { name: /^written off$/i }).click();
    await dialog.locator("#reason").fill("e2e smoke — decommission results view");
    await dialog.getByRole("button", { name: /save|update|confirm|change/i }).last().click();

    // The dialog swaps to the results view instead of closing — that swap is
    // the whole point of Area 6.
    await expect(dialog.getByText(new RegExp(`status changed — ${tag}`, "i"))).toBeVisible({
      timeout: 20_000,
    });
    // A fresh vehicle carries no bookings, so the empty branch renders.
    await expect(dialog.getByText(/no bookings were affected/i)).toBeVisible();
    // Radix renders its own corner dismiss button also named "Close" — the
    // footer action is the first in DOM order.
    await dialog.getByRole("button", { name: /^close$/i }).first().click();

    const after = await e2ePrisma.vehicle.findUniqueOrThrow({
      where: { id: vehicle.id },
      select: { status: true },
    });
    expect(after.status).toBe("WRITTEN_OFF");
  });
});
