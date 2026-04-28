// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import {
  currentScrollPercentage,
  isInteractiveElement,
  isRageClick,
  nextScrollBreakpoint,
  scoreEngagement,
  RAGE_CLICK_WINDOW_MS,
} from "@/lib/analytics/engagement";

describe("currentScrollPercentage", () => {
  test("returns 0 when no scrollable area", () => {
    expect(
      currentScrollPercentage({ scrollTop: 0, clientHeight: 800, scrollHeight: 800 }),
    ).toBe(0);
  });

  test("returns 100 when scrolled to bottom", () => {
    expect(
      currentScrollPercentage({ scrollTop: 1200, clientHeight: 800, scrollHeight: 2000 }),
    ).toBe(100);
  });

  test("returns 50 when halfway plus viewport", () => {
    expect(
      currentScrollPercentage({ scrollTop: 200, clientHeight: 800, scrollHeight: 2000 }),
    ).toBe(50);
  });

  test("clamps beyond 100", () => {
    expect(
      currentScrollPercentage({ scrollTop: 5000, clientHeight: 800, scrollHeight: 2000 }),
    ).toBe(100);
  });
});

describe("nextScrollBreakpoint", () => {
  test("returns the first unreported breakpoint ≤ current", () => {
    expect(nextScrollBreakpoint(30, new Set())).toBe(25);
    expect(nextScrollBreakpoint(60, new Set([25]))).toBe(50);
    expect(nextScrollBreakpoint(99, new Set([25, 50, 75]))).toBe(null);
    expect(nextScrollBreakpoint(100, new Set([25, 50, 75]))).toBe(100);
  });

  test("returns null when below 25%", () => {
    expect(nextScrollBreakpoint(24, new Set())).toBe(null);
  });
});

describe("isRageClick", () => {
  test("false for under-threshold click counts", () => {
    expect(isRageClick([])).toBe(false);
    expect(isRageClick([100])).toBe(false);
    expect(isRageClick([100, 200])).toBe(false);
  });

  test("true for 3 clicks inside the window", () => {
    expect(isRageClick([100, 300, 500])).toBe(true);
  });

  test("false for 3 clicks spanning beyond the window", () => {
    expect(isRageClick([0, 500, RAGE_CLICK_WINDOW_MS + 100])).toBe(false);
  });

  test("uses the latest N clicks, not the earliest", () => {
    // First three span too long, but the last three are tight.
    expect(isRageClick([0, 5_000, 5_200, 5_400, 5_500])).toBe(true);
  });
});

describe("isInteractiveElement", () => {
  function make(tag: string, attrs: Record<string, string> = {}): Element {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  }

  test("buttons and anchors are interactive", () => {
    expect(isInteractiveElement(make("button"))).toBe(true);
    expect(isInteractiveElement(make("a"))).toBe(true);
    expect(isInteractiveElement(make("input"))).toBe(true);
  });

  test("role=button is interactive", () => {
    expect(isInteractiveElement(make("div", { role: "button" }))).toBe(true);
  });

  test("positive tabindex makes an element interactive", () => {
    expect(isInteractiveElement(make("div", { tabindex: "0" }))).toBe(true);
    expect(isInteractiveElement(make("div", { tabindex: "-1" }))).toBe(false);
  });

  test("plain divs/spans are not interactive", () => {
    expect(isInteractiveElement(make("div"))).toBe(false);
    expect(isInteractiveElement(make("span"))).toBe(false);
    expect(isInteractiveElement(make("p"))).toBe(false);
  });
});

describe("scoreEngagement", () => {
  test("converted sessions score 100 regardless of other signals", () => {
    expect(
      scoreEngagement({
        durationSeconds: 0,
        totalPageViews: 0,
        eventCount: 0,
        maxScrollDepth: null,
        wizardHighestStep: null,
        converted: true,
      }),
    ).toBe(100);
  });

  test("bounced visitor scores low", () => {
    const s = scoreEngagement({
      durationSeconds: 5,
      totalPageViews: 1,
      eventCount: 0,
      maxScrollDepth: 0,
      wizardHighestStep: null,
      converted: false,
    });
    expect(s).toBeLessThan(10);
  });

  test("engaged wizard-abandoner scores mid-to-high", () => {
    const s = scoreEngagement({
      durationSeconds: 180,
      totalPageViews: 6,
      eventCount: 10,
      maxScrollDepth: 75,
      wizardHighestStep: 4,
      converted: false,
    });
    expect(s).toBeGreaterThan(55);
    expect(s).toBeLessThan(100);
  });

  test("result is clamped 0..100", () => {
    const s = scoreEngagement({
      durationSeconds: 10_000,
      totalPageViews: 100,
      eventCount: 1_000,
      maxScrollDepth: 100,
      wizardHighestStep: 6,
      converted: false,
    });
    expect(s).toBeLessThanOrEqual(100);
  });
});
