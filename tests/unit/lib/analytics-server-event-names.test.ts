import { describe, expect, test } from "vitest";
import { SERVER_EVENTS, DEPOT_GROUP_TYPE } from "@/lib/analytics/server-event-names";

describe("SERVER_EVENTS registry", () => {
  test("every wire name is unique", () => {
    const values = Object.values(SERVER_EVENTS);
    expect(new Set(values).size).toBe(values.length);
  });

  test("every wire name is a non-empty dotted lowercase token", () => {
    for (const name of Object.values(SERVER_EVENTS)) {
      expect(name).toMatch(/^[a-z][a-z_]*\.[a-z][a-z_]*$/);
    }
  });

  test("does not collide with the visitor.* client pipeline namespace", () => {
    for (const name of Object.values(SERVER_EVENTS)) {
      expect(name.startsWith("visitor.")).toBe(false);
    }
  });

  test("does not use PostHog reserved $-prefixed names", () => {
    for (const name of Object.values(SERVER_EVENTS)) {
      expect(name.startsWith("$")).toBe(false);
    }
  });

  // Regression guard: these names already have data in PostHog and must not
  // drift. A rename here should be a deliberate, reviewed change.
  test("pins the wire names that pre-date the registry", () => {
    expect(SERVER_EVENTS.bookingCreated).toBe("booking.created");
    expect(SERVER_EVENTS.bookingConfirmed).toBe("booking.confirmed");
    expect(SERVER_EVENTS.bookingCancelled).toBe("booking.cancelled");
    expect(SERVER_EVENTS.bookingCheckedIn).toBe("booking.checked_in");
    expect(SERVER_EVENTS.bookingCheckedOut).toBe("booking.checked_out");
    expect(SERVER_EVENTS.paymentCaptured).toBe("payment.captured");
    expect(SERVER_EVENTS.paymentRefunded).toBe("payment.refunded");
    expect(SERVER_EVENTS.bondCaptured).toBe("bond.captured");
    expect(SERVER_EVENTS.bondReleased).toBe("bond.released");
    expect(SERVER_EVENTS.licenceVerified).toBe("licence.verified");
    expect(SERVER_EVENTS.maintenanceCreated).toBe("maintenance.created");
    expect(SERVER_EVENTS.incidentCreated).toBe("incident.created");
    expect(SERVER_EVENTS.customerRegistered).toBe("customer.registered");
  });

  test("depot group type is the stable slug-keyed 'depot'", () => {
    expect(DEPOT_GROUP_TYPE).toBe("depot");
  });
});
