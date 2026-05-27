import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { STALE_RESET_FLAG, useBookingWizard } from "@/stores/booking-wizard";

// Mock the tRPC client so the hook's `trpc.useUtils().booking.availability.fetch`
// resolves to whatever each test queues up. `fetchMock` is hoisted by vitest.
const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    useUtils: () => ({
      booking: { availability: { fetch: fetchMock } },
    }),
  },
}));

import { useResumeStalenessGuard } from "@/hooks/use-resume-staleness-guard";

/** Seed a resumable wizard sitting on step 3 with a comfortably-future pickup. */
function seedResumeAtStep3() {
  const s = useBookingWizard.getState();
  s.set("categoryId", "cat_1");
  s.set("pickupDepotId", "dep_1");
  // Far future so isPickupTooLate is false regardless of the real clock.
  s.set("pickupDateTime", "2999-01-01T10:00:00.000Z");
  s.set("returnDateTime", "2999-01-03T10:00:00.000Z");
  s.set("preferredVehicleId", "veh_1");
  s._setStepSilent(3);
}

describe("useResumeStalenessGuard", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    window.history.replaceState({}, "", "/booking");
    useBookingWizard.getState().reset();
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resets the wizard when the depot/category is sold out (available <= 0)", async () => {
    seedResumeAtStep3();
    fetchMock.mockResolvedValue({ total: 4, available: 0 });

    renderHook(() => useResumeStalenessGuard());

    await waitFor(() => {
      expect(useBookingWizard.getState().step).toBe(1);
    });
    expect(sessionStorage.getItem(STALE_RESET_FLAG)).toBe("UNAVAILABLE");
    expect(useBookingWizard.getState().categoryId).toBeNull();
  });

  it("does not reset when vehicles are still available", async () => {
    seedResumeAtStep3();
    fetchMock.mockResolvedValue({ total: 4, available: 2 });

    renderHook(() => useResumeStalenessGuard());

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(useBookingWizard.getState().step).toBe(3);
    expect(sessionStorage.getItem(STALE_RESET_FLAG)).toBeNull();
  });

  it("never fetches when still on step 1", async () => {
    // Empty store → step 1.
    renderHook(() => useResumeStalenessGuard());
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never fetches when a search input is missing", async () => {
    const s = useBookingWizard.getState();
    s.set("categoryId", "cat_1");
    s.set("pickupDepotId", "dep_1");
    s.set("pickupDateTime", "2999-01-01T10:00:00.000Z");
    // returnDateTime intentionally left null.
    s._setStepSilent(3);

    renderHook(() => useResumeStalenessGuard());
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips the fetch when the pickup time is already too late", async () => {
    const s = useBookingWizard.getState();
    s.set("categoryId", "cat_1");
    s.set("pickupDepotId", "dep_1");
    s.set("pickupDateTime", "2000-01-01T10:00:00.000Z"); // long past
    s.set("returnDateTime", "2000-01-03T10:00:00.000Z");
    s._setStepSilent(3);

    renderHook(() => useResumeStalenessGuard());
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails open: a rejected fetch does not reset the wizard", async () => {
    seedResumeAtStep3();
    fetchMock.mockRejectedValue(new Error("network"));

    renderHook(() => useResumeStalenessGuard());

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(useBookingWizard.getState().step).toBe(3);
    expect(sessionStorage.getItem(STALE_RESET_FLAG)).toBeNull();
  });

  it("does not reset if the user changed inputs while the fetch was in flight", async () => {
    seedResumeAtStep3();
    let resolve!: (v: { total: number; available: number }) => void;
    fetchMock.mockReturnValue(
      new Promise<{ total: number; available: number }>((r) => {
        resolve = r;
      }),
    );

    renderHook(() => useResumeStalenessGuard());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // User picks a different category mid-flight.
    useBookingWizard.getState().set("categoryId", "cat_2");
    resolve({ total: 0, available: 0 });

    await Promise.resolve();
    await Promise.resolve();
    expect(useBookingWizard.getState().step).toBe(3);
    expect(sessionStorage.getItem(STALE_RESET_FLAG)).toBeNull();
  });

  it("fires at most once per mount (ran-once ref)", async () => {
    seedResumeAtStep3();
    fetchMock.mockResolvedValue({ total: 4, available: 2 });

    const { rerender } = renderHook(() => useResumeStalenessGuard());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    rerender();
    rerender();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
