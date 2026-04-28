import { describe, expect, test } from "vitest";
import {
  deriveVisitorOutcome,
  deriveInteractionOutcome,
} from "@/server/jobs/visitor-session-cleanup";

describe("deriveVisitorOutcome", () => {
  test("converted when a booking was attributed, regardless of other signals", () => {
    expect(
      deriveVisitorOutcome({
        totalPageViews: 1,
        durationSeconds: 5,
        wizardHighestStep: null,
        convertedBookingId: "bk_1",
      }),
    ).toBe("CONVERTED");
  });

  test("bounced when single page view under 15s", () => {
    expect(
      deriveVisitorOutcome({
        totalPageViews: 1,
        durationSeconds: 10,
        wizardHighestStep: null,
        convertedBookingId: null,
      }),
    ).toBe("BOUNCED");
  });

  test("not bounced when duration hits 15s threshold", () => {
    expect(
      deriveVisitorOutcome({
        totalPageViews: 1,
        durationSeconds: 15,
        wizardHighestStep: null,
        convertedBookingId: null,
      }),
    ).toBe("LEFT");
  });

  test("abandoned wizard when engagement reached step >=1 but no booking", () => {
    expect(
      deriveVisitorOutcome({
        totalPageViews: 5,
        durationSeconds: 120,
        wizardHighestStep: 3,
        convertedBookingId: null,
      }),
    ).toBe("ABANDONED_WIZARD");
  });

  test("LEFT when multi-page but no wizard engagement and no booking", () => {
    expect(
      deriveVisitorOutcome({
        totalPageViews: 4,
        durationSeconds: 90,
        wizardHighestStep: null,
        convertedBookingId: null,
      }),
    ).toBe("LEFT");
  });

  test("CONVERTED takes precedence over BOUNCED even with a short session", () => {
    expect(
      deriveVisitorOutcome({
        totalPageViews: 1,
        durationSeconds: 3,
        wizardHighestStep: 1,
        convertedBookingId: "bk_2",
      }),
    ).toBe("CONVERTED");
  });
});

describe("deriveInteractionOutcome", () => {
  test("CONVERTED when a booking was attributed", () => {
    expect(
      deriveInteractionOutcome({
        attributedBookingId: "bk_1",
        staffMessageCount: 3,
        lastSenderRole: "STAFF",
      }),
    ).toBe("CONVERTED");
  });

  test("NO_RESPONSE when staff never replied", () => {
    expect(
      deriveInteractionOutcome({
        attributedBookingId: null,
        staffMessageCount: 0,
        lastSenderRole: "CUSTOMER",
      }),
    ).toBe("NO_RESPONSE");
  });

  test("ABANDONED when staff replied but customer sent the last message", () => {
    expect(
      deriveInteractionOutcome({
        attributedBookingId: null,
        staffMessageCount: 1,
        lastSenderRole: "CUSTOMER",
      }),
    ).toBe("ABANDONED");
  });

  test("RESOLVED when staff had the last word and no booking attributed", () => {
    expect(
      deriveInteractionOutcome({
        attributedBookingId: null,
        staffMessageCount: 2,
        lastSenderRole: "STAFF",
      }),
    ).toBe("RESOLVED");
  });

  test("CONVERTED outranks ABANDONED when a booking is present", () => {
    expect(
      deriveInteractionOutcome({
        attributedBookingId: "bk_3",
        staffMessageCount: 1,
        lastSenderRole: "CUSTOMER",
      }),
    ).toBe("CONVERTED");
  });
});
