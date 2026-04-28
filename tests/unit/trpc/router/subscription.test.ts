import { describe, expect, it } from "vitest";
import {
  ACTIVE_SUBSCRIPTION_STATUSES,
  canCancel,
  canPause,
  canResume,
  isActiveStatus,
} from "@/server/trpc/router/subscription";

describe("subscription policy helpers", () => {
  it("ACTIVE, TRIALING, PAUSED, PAST_DUE are considered active (block a new subscribe)", () => {
    expect(ACTIVE_SUBSCRIPTION_STATUSES.slice().sort()).toEqual(
      ["ACTIVE", "PAUSED", "PAST_DUE", "TRIALING"].sort(),
    );
    for (const s of ACTIVE_SUBSCRIPTION_STATUSES) {
      expect(isActiveStatus(s)).toBe(true);
    }
  });

  it("CANCELLED does not block a new subscription", () => {
    expect(isActiveStatus("CANCELLED")).toBe(false);
  });

  describe("canPause", () => {
    it("allows from ACTIVE and TRIALING", () => {
      expect(canPause("ACTIVE")).toBe(true);
      expect(canPause("TRIALING")).toBe(true);
    });
    it("rejects from PAUSED, PAST_DUE, CANCELLED", () => {
      expect(canPause("PAUSED")).toBe(false);
      expect(canPause("PAST_DUE")).toBe(false);
      expect(canPause("CANCELLED")).toBe(false);
    });
  });

  describe("canResume", () => {
    it("allows only from PAUSED", () => {
      expect(canResume("PAUSED")).toBe(true);
      expect(canResume("ACTIVE")).toBe(false);
      expect(canResume("CANCELLED")).toBe(false);
      expect(canResume("TRIALING")).toBe(false);
      expect(canResume("PAST_DUE")).toBe(false);
    });
  });

  describe("canCancel", () => {
    it("allows from every status except CANCELLED (idempotent no-op)", () => {
      expect(canCancel("ACTIVE")).toBe(true);
      expect(canCancel("TRIALING")).toBe(true);
      expect(canCancel("PAUSED")).toBe(true);
      expect(canCancel("PAST_DUE")).toBe(true);
      expect(canCancel("CANCELLED")).toBe(false);
    });
  });
});
