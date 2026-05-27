import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { STALE_RESET_FLAG, useBookingWizard } from "@/stores/booking-wizard";

// StepSearch pulls depot + category lists over tRPC; stub both queries. The
// banner behaviour under test doesn't depend on their contents, so empty
// arrays keep the form rendering without network.
vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    depot: { list: { useQuery: () => ({ data: [] }) } },
    vehicle: { listCategories: { useQuery: () => ({ data: [] }) } },
  },
}));

// Heavy child + analytics aren't relevant to the notice; stub them out.
vi.mock("@/components/booking/date-range-picker", () => ({
  BookingDateRangePicker: () => null,
}));
vi.mock("@/lib/analytics/track", () => ({ trackEvent: vi.fn() }));

import { StepSearch } from "@/components/booking/step-search";

const PICKUP_PASSED_COPY = /your earlier pickup time has passed/i;
const UNAVAILABLE_COPY = /no longer available for those dates/i;

describe("StepSearch — stale-reset notice", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    window.history.replaceState({}, "", "/booking");
    useBookingWizard.getState().reset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows the pickup-passed banner and clears the flag", () => {
    sessionStorage.setItem(STALE_RESET_FLAG, "PICKUP_PASSED");
    render(<StepSearch />);
    expect(screen.queryByText(PICKUP_PASSED_COPY)).not.toBeNull();
    expect(sessionStorage.getItem(STALE_RESET_FLAG)).toBeNull();
  });

  it("shows the unavailable banner and clears the flag", () => {
    sessionStorage.setItem(STALE_RESET_FLAG, "UNAVAILABLE");
    render(<StepSearch />);
    expect(screen.queryByText(UNAVAILABLE_COPY)).not.toBeNull();
    expect(sessionStorage.getItem(STALE_RESET_FLAG)).toBeNull();
  });

  it("renders no banner when the flag is absent", () => {
    render(<StepSearch />);
    expect(screen.queryByText(PICKUP_PASSED_COPY)).toBeNull();
    expect(screen.queryByText(UNAVAILABLE_COPY)).toBeNull();
  });

  it("ignores an unrecognised flag value", () => {
    sessionStorage.setItem(STALE_RESET_FLAG, "bogus");
    render(<StepSearch />);
    expect(screen.queryByText(PICKUP_PASSED_COPY)).toBeNull();
    expect(screen.queryByText(UNAVAILABLE_COPY)).toBeNull();
  });
});
