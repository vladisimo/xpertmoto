import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AnalyticsConsentBanner } from "@/components/shared/analytics-consent-banner";
import {
  ANALYTICS_CONSENT_KEY,
  clearAnalyticsConsent,
  getAnalyticsConsent,
  refreshAnalyticsConsent,
  setAnalyticsConsent,
} from "@/components/shared/analytics-consent";

beforeEach(() => {
  window.localStorage.clear();
  refreshAnalyticsConsent();
});

afterEach(cleanup);

const banner = () => screen.queryByRole("heading", { name: /analytics cookies/i });

describe("AnalyticsConsentBanner", () => {
  it("asks first-time visitors, linking the privacy policy", () => {
    render(<AnalyticsConsentBanner />);

    expect(banner()).not.toBeNull();
    expect(screen.getByRole("link", { name: /privacy policy/i }).getAttribute("href")).toBe(
      "/privacy",
    );
    expect(screen.getByRole("button", { name: /accept analytics/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /decline/i })).toBeTruthy();
  });

  it("records and persists an accept, then gets out of the way", async () => {
    const user = userEvent.setup();
    render(<AnalyticsConsentBanner />);

    await user.click(screen.getByRole("button", { name: /accept analytics/i }));

    expect(getAnalyticsConsent()).toBe("granted");
    expect(window.localStorage.getItem(ANALYTICS_CONSENT_KEY)).toBe("granted");
    expect(banner()).toBeNull();
  });

  it("records and persists a decline", async () => {
    const user = userEvent.setup();
    render(<AnalyticsConsentBanner />);

    await user.click(screen.getByRole("button", { name: /decline/i }));

    expect(getAnalyticsConsent()).toBe("denied");
    expect(window.localStorage.getItem(ANALYTICS_CONSENT_KEY)).toBe("denied");
    expect(banner()).toBeNull();
  });

  it("stays hidden on later visits once a choice is stored", () => {
    setAnalyticsConsent("denied");
    render(<AnalyticsConsentBanner />);
    expect(banner()).toBeNull();
  });

  it("comes back when the stored choice is cleared from the privacy page", () => {
    setAnalyticsConsent("granted");
    render(<AnalyticsConsentBanner />);
    expect(banner()).toBeNull();

    act(() => clearAnalyticsConsent());

    expect(banner()).not.toBeNull();
  });
});
