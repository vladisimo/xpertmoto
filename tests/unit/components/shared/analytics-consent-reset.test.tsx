import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AnalyticsConsentReset } from "@/components/shared/analytics-consent-reset";
import {
  ANALYTICS_CONSENT_KEY,
  getAnalyticsConsent,
  refreshAnalyticsConsent,
  setAnalyticsConsent,
} from "@/components/shared/analytics-consent";

beforeEach(() => {
  window.localStorage.clear();
  refreshAnalyticsConsent();
});

afterEach(cleanup);

describe("AnalyticsConsentReset", () => {
  it("reports the current choice", () => {
    setAnalyticsConsent("denied");
    render(<AnalyticsConsentReset />);
    expect(screen.getByText(/declined analytics cookies/i)).toBeTruthy();
  });

  it("clears the stored choice so the banner can ask again", async () => {
    const user = userEvent.setup();
    setAnalyticsConsent("granted");
    render(<AnalyticsConsentReset />);

    await user.click(screen.getByRole("button", { name: /change my choice/i }));

    expect(getAnalyticsConsent()).toBe("unset");
    expect(window.localStorage.getItem(ANALYTICS_CONSENT_KEY)).toBeNull();
    expect(screen.queryByRole("button", { name: /change my choice/i })).toBeNull();
    expect(screen.getByText(/haven.t answered the analytics banner/i)).toBeTruthy();
  });
});
