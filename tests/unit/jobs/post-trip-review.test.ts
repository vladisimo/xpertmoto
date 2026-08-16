import { beforeEach, describe, expect, it, vi } from "vitest";

// Focus (Area 2): loss-terminated hires land COMPLETED, but a customer whose
// hire ended because the vehicle was written off / stolen must never get the
// "how was your ride?" review + upsell email. The exclusion is structural —
// the candidate query filters `termination: null` — so the test pins the
// query shape and the ordinary happy path around it.

vi.mock("@/lib/prisma", () => ({
  prisma: {
    booking: { findMany: vi.fn() },
    notification: { findFirst: vi.fn(async () => null) },
    discount: { upsert: vi.fn(async () => ({})) },
  },
}));
const sendNotificationMock = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock("@/server/services/notification-sender", () => ({
  sendNotification: (...a: unknown[]) => sendNotificationMock(...a),
}));
vi.mock("@/server/services/referral", () => ({
  ensureReferralCode: vi.fn(async () => "REF-VLAD"),
}));
vi.mock("@/lib/branding", () => ({
  getBranding: vi.fn(async () => ({ siteName: "XPERT Moto" })),
}));
vi.mock("@react-email/render", () => ({
  render: vi.fn(async () => "<html />"),
}));
vi.mock("../../../emails/post-trip-review", () => ({ default: () => null }));

import { runPostTripReview } from "../../../src/server/jobs/post-trip-review";
import { prisma } from "../../../src/lib/prisma";

type MockFn = ReturnType<typeof vi.fn>;
const mockedFindMany = prisma.booking.findMany as unknown as MockFn;

function makeCompletedBooking() {
  return {
    id: "b1",
    customerId: "cust1",
    bookingReference: "XPM-20260810-0001",
    customer: { firstName: "Vlad", customerProfile: {} },
    category: { name: "Scooter 125" },
    pickupDepot: { name: "Brisbane CBD" },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedFindMany.mockResolvedValue([]);
});

describe("post-trip-review — terminated-booking skip (Area 2)", () => {
  it("the candidate query structurally excludes bookings with a termination row", async () => {
    await runPostTripReview();

    expect(mockedFindMany).toHaveBeenCalledTimes(1);
    const where = (mockedFindMany.mock.calls[0]![0] as {
      where: Record<string, unknown>;
    }).where;
    expect(where).toMatchObject({ status: "COMPLETED", termination: null });
  });

  it("still emails a normally-completed booking", async () => {
    mockedFindMany.mockResolvedValue([makeCompletedBooking()]);

    const res = await runPostTripReview();

    expect(res).toMatchObject({ scanned: 1, emailed: 1, skipped: 0 });
    expect(sendNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "cust1",
        type: "POST_TRIP_REVIEW_REQUEST",
        bookingId: "b1",
      }),
    );
  });
});
