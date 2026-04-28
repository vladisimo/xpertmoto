import { describe, expect, test, beforeEach } from "vitest";
import {
  sanitizeEvent,
  scrubPii,
  targetLooksPii,
  subscribeToEvents,
  trackEvent,
} from "@/lib/analytics/track";

describe("scrubPii", () => {
  test("replaces emails with [email]", () => {
    expect(scrubPii("reach me at jane.doe+test@example.com ok")).toContain("[email]");
    expect(scrubPii("reach me at jane.doe+test@example.com ok")).not.toContain("jane.doe");
  });

  test("replaces phone numbers with [phone]", () => {
    expect(scrubPii("call 0412 345 678 today")).toContain("[phone]");
    expect(scrubPii("call 0412 345 678 today")).not.toMatch(/0412/);
  });

  test("replaces card-like sequences with [card]", () => {
    expect(scrubPii("pan 4111 1111 1111 1111 ok")).toContain("[card]");
    expect(scrubPii("pan 4111 1111 1111 1111 ok")).not.toMatch(/4111 1111/);
  });

  test("leaves unrelated text alone", () => {
    expect(scrubPii("SUMMER10 discount applied")).toBe("SUMMER10 discount applied");
  });
});

describe("targetLooksPii", () => {
  test("flags obvious PII fields", () => {
    expect(targetLooksPii("email")).toBe(true);
    expect(targetLooksPii("firstName")).toBe(true);
    expect(targetLooksPii("licence_number")).toBe(true);
    expect(targetLooksPii("password")).toBe(true);
    expect(targetLooksPii("signatureDataUrl")).toBe(true);
  });

  test("does not flag safe field names", () => {
    expect(targetLooksPii("discount-code")).toBe(false);
    expect(targetLooksPii("fleet-card-book")).toBe(false);
    expect(targetLooksPii("hero-primary-cta")).toBe(false);
  });
});

describe("sanitizeEvent", () => {
  test("drops value entirely when target looks like a PII field", () => {
    const out = sanitizeEvent({
      kind: "FORM_FIELD_CHANGE",
      target: "email",
      value: "jane@example.com",
    });
    expect(out.value).toBeNull();
    expect(out.target).toBe("email");
  });

  test("scrubs PII from free-text value even when target is safe", () => {
    const out = sanitizeEvent({
      kind: "SEARCH",
      target: "booking-wizard-search",
      value: "contact me at jane@example.com please",
    });
    expect(out.value).toContain("[email]");
    expect(out.value).not.toContain("jane@");
  });

  test("trims value + target and caps to max length", () => {
    const huge = "a".repeat(1000);
    const out = sanitizeEvent({
      kind: "CUSTOM",
      target: `  ${huge}  `,
      value: `  ${huge}  `,
    });
    expect(out.target!.length).toBeLessThanOrEqual(120);
    expect(out.value!.length).toBeLessThanOrEqual(240);
  });

  test("empty / whitespace-only value is set to null", () => {
    const out = sanitizeEvent({ kind: "CLICK", target: "x", value: "   " });
    expect(out.value).toBeNull();
  });

  test("non-finite numericValue becomes null", () => {
    const out = sanitizeEvent({
      kind: "SCROLL_DEPTH",
      numericValue: Number.POSITIVE_INFINITY,
    });
    expect(out.numericValue).toBeNull();
  });
});

describe("trackEvent / subscribeToEvents", () => {
  beforeEach(() => {
    // Ensure no stale subscribers leak across tests.
  });

  test("delivers sanitized events to every subscribed listener", () => {
    const received: unknown[] = [];
    const unsub = subscribeToEvents((e) => received.push(e));
    trackEvent({
      kind: "CTA_CLICK",
      target: "hero-primary-cta",
      value: "Book now (jane@example.com leak)",
    });
    unsub();
    expect(received).toHaveLength(1);
    const first = received[0] as { value: string | null };
    expect(first.value).toContain("[email]");
  });

  test("no-op when nothing is subscribed", () => {
    // Should not throw; no listeners, nothing to verify other than
    // that the call returns cleanly.
    expect(() => trackEvent({ kind: "CLICK" })).not.toThrow();
  });

  test("misbehaving listener doesn't break the pipeline", () => {
    const received: unknown[] = [];
    const unsub1 = subscribeToEvents(() => {
      throw new Error("boom");
    });
    const unsub2 = subscribeToEvents((e) => received.push(e));
    trackEvent({ kind: "CLICK", target: "x" });
    unsub1();
    unsub2();
    expect(received).toHaveLength(1);
  });
});
