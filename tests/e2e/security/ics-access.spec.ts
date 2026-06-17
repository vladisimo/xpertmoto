import fs from "node:fs";
import { test, expect } from "../_fixtures/test";
import { STORAGE_STATE } from "../../../playwright.config";

/**
 * R2-H1 regression guard: GET /api/bookings/{id}/ics used to be completely
 * unauthenticated and leaked the booking reference, dates, category, and the
 * exact pickup street address across accounts. It must now require an
 * authenticated, owner-scoped (or staff) session.
 */

function cookieHeader(storageStatePath: string): string {
  if (!fs.existsSync(storageStatePath)) return "";
  const raw = JSON.parse(fs.readFileSync(storageStatePath, "utf-8")) as {
    cookies?: Array<{ name: string; value: string }>;
  };
  return (raw.cookies ?? []).map((c) => `${c.name}=${c.value}`).join("; ");
}

test.describe("ICS endpoint access control (R2-H1)", () => {
  test("an anonymous request is rejected and leaks no calendar data", async ({ baseURL }) => {
    const res = await fetch(`${baseURL}/api/bookings/any-booking-id/ics`);
    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain("BEGIN:VCALENDAR");
  });

  test("the booking owner can still download their own ICS", async ({ customerApi, baseURL }) => {
    const mine = await customerApi.booking.mine.query({ limit: 1 });
    test.skip(mine.items.length === 0, "no seeded booking for the customer account");
    const id = mine.items[0]!.id;

    const res = await fetch(`${baseURL}/api/bookings/${id}/ics`, {
      headers: { cookie: cookieHeader(STORAGE_STATE.customer) },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/calendar");
    expect(await res.text()).toContain("BEGIN:VEVENT");
  });
});
