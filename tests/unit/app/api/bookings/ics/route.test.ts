import { beforeEach, describe, expect, it, vi } from "vitest";

// withAudit only emits an audit row; bypass it so the test exercises the
// handler's auth + owner-scoping directly (no DB writes for the audit trail).
vi.mock("@/lib/with-audit", () => ({
  withAudit: (_opts: unknown, handler: unknown) => handler,
}));

const authMock = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: () => authMock() }));

const findUniqueMock = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: { booking: { findUnique: (args: unknown) => findUniqueMock(args) } },
}));

vi.mock("@/lib/branding", () => ({
  getBranding: () => Promise.resolve({ siteName: "XPERT Moto" }),
}));

import { GET } from "@/app/api/bookings/[id]/ics/route";

const OWNER_ID = "user_owner";

const booking = {
  id: "bk_1",
  customerId: OWNER_ID,
  bookingReference: "SCT-20260616-YNAQ3D",
  pickupDateTime: new Date("2026-07-06T00:00:00Z"),
  returnDateTime: new Date("2026-07-09T00:00:00Z"),
  category: { name: "LAMS Motorcycle" },
  pickupDepot: {
    name: "Lewisham",
    addressLine1: "798 Parramatta Road",
    suburb: "Lewisham",
    state: "NSW",
    postcode: "2049",
  },
  returnDepot: { name: "Lewisham" },
};

const ctx = () => ({ params: Promise.resolve({ id: "bk_1" }) });

describe("GET /api/bookings/[id]/ics", () => {
  beforeEach(() => {
    authMock.mockReset();
    findUniqueMock.mockReset();
  });

  it("returns 401 when there is no session (R2-H1)", async () => {
    authMock.mockResolvedValue(null);

    const res = await GET(new Request("https://x/api/bookings/bk_1/ics"), ctx());

    expect(res.status).toBe(401);
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the booking does not exist", async () => {
    authMock.mockResolvedValue({ user: { id: OWNER_ID, role: "CUSTOMER" } });
    findUniqueMock.mockResolvedValue(null);

    const res = await GET(new Request("https://x/api/bookings/bk_1/ics"), ctx());

    expect(res.status).toBe(404);
  });

  it("returns 403 for an authenticated non-owner customer (cross-account)", async () => {
    authMock.mockResolvedValue({ user: { id: "user_attacker", role: "CUSTOMER" } });
    findUniqueMock.mockResolvedValue(booking);

    const res = await GET(new Request("https://x/api/bookings/bk_1/ics"), ctx());

    expect(res.status).toBe(403);
  });

  it("looks up by id only — never by bookingReference", async () => {
    authMock.mockResolvedValue({ user: { id: OWNER_ID, role: "CUSTOMER" } });
    findUniqueMock.mockResolvedValue(booking);

    await GET(new Request("https://x/api/bookings/bk_1/ics"), ctx());

    expect(findUniqueMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "bk_1" } }),
    );
  });

  it("serves the calendar to the booking owner", async () => {
    authMock.mockResolvedValue({ user: { id: OWNER_ID, role: "CUSTOMER" } });
    findUniqueMock.mockResolvedValue(booking);

    const res = await GET(new Request("https://x/api/bookings/bk_1/ics"), ctx());

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    const text = await res.text();
    expect(text).toContain("BEGIN:VEVENT");
    expect(text).toContain("LAMS Motorcycle");
  });

  it("serves the calendar to back-office staff for any booking", async () => {
    authMock.mockResolvedValue({ user: { id: "staff_1", role: "STAFF" } });
    findUniqueMock.mockResolvedValue(booking);

    const res = await GET(new Request("https://x/api/bookings/bk_1/ics"), ctx());

    expect(res.status).toBe(200);
  });
});
