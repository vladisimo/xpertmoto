import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ANALYTICS_CONSENT_KEY,
  clearAnalyticsConsent,
  getAnalyticsConsent,
  isAnalyticsGranted,
  refreshAnalyticsConsent,
  setAnalyticsConsent,
  subscribeAnalyticsConsent,
} from "@/components/shared/analytics-consent";

/**
 * The store memoises the parsed value at module scope, so every test resets
 * both localStorage and that cache before running.
 */
beforeEach(() => {
  window.localStorage.clear();
  refreshAnalyticsConsent();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("analytics consent store", () => {
  it("starts unset — analytics is off until the visitor answers", () => {
    expect(getAnalyticsConsent()).toBe("unset");
    expect(isAnalyticsGranted()).toBe(false);
  });

  it("persists an accept and reports it as granted", () => {
    setAnalyticsConsent("granted");
    expect(getAnalyticsConsent()).toBe("granted");
    expect(isAnalyticsGranted()).toBe(true);
    expect(window.localStorage.getItem(ANALYTICS_CONSENT_KEY)).toBe("granted");
  });

  it("persists a decline and keeps analytics off", () => {
    setAnalyticsConsent("denied");
    expect(getAnalyticsConsent()).toBe("denied");
    expect(isAnalyticsGranted()).toBe(false);
    expect(window.localStorage.getItem(ANALYTICS_CONSENT_KEY)).toBe("denied");
  });

  it("reads a previously stored choice back on a fresh page-load", () => {
    window.localStorage.setItem(ANALYTICS_CONSENT_KEY, "granted");
    refreshAnalyticsConsent(); // stands in for a new page-load's first read
    expect(isAnalyticsGranted()).toBe(true);
  });

  it("treats an unrecognised stored value as unset rather than granted", () => {
    window.localStorage.setItem(ANALYTICS_CONSENT_KEY, "yes-please");
    refreshAnalyticsConsent();
    expect(getAnalyticsConsent()).toBe("unset");
  });

  it("clearing the choice re-opens the question", () => {
    setAnalyticsConsent("denied");
    clearAnalyticsConsent();
    expect(getAnalyticsConsent()).toBe("unset");
    expect(window.localStorage.getItem(ANALYTICS_CONSENT_KEY)).toBeNull();
  });

  it("notifies subscribers on change and stops after unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAnalyticsConsent(listener);

    setAnalyticsConsent("granted");
    expect(listener).toHaveBeenCalledTimes(1);

    clearAnalyticsConsent();
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    setAnalyticsConsent("denied");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("picks up a choice made in another tab, ignoring unrelated keys", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAnalyticsConsent(listener);

    window.dispatchEvent(new StorageEvent("storage", { key: "some-other-key" }));
    expect(listener).not.toHaveBeenCalled();

    window.localStorage.setItem(ANALYTICS_CONSENT_KEY, "granted");
    window.dispatchEvent(
      new StorageEvent("storage", { key: ANALYTICS_CONSENT_KEY, newValue: "granted" }),
    );

    expect(isAnalyticsGranted()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("survives storage being unavailable, defaulting to analytics off", () => {
    setAnalyticsConsent("granted");

    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError: storage disabled");
    });
    refreshAnalyticsConsent();
    expect(getAnalyticsConsent()).toBe("unset");

    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => setAnalyticsConsent("granted")).not.toThrow();
    // The answer still applies for this page-load even when it can't persist.
    expect(isAnalyticsGranted()).toBe(true);
  });
});
