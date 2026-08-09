import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useBookingWizard } from "@/stores/booking-wizard";

// The step only reads the availability count off tRPC; the picker below it
// is a heavy tRPC + session tree and isn't what's under test here.
vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    booking: { availability: { useQuery: () => ({ data: { available: 3 } }) } },
  },
}));
vi.mock("@/components/booking/vehicle-picker", () => ({ VehiclePicker: () => null }));

import { StepVehicle } from "@/components/booking/step-vehicle";

const NEEDS_CHOICE_COPY = /choose a vehicle to continue/i;

/** Step-1 answers, so step 2 is the wizard's current + max reachable step. */
function seedStep2() {
  const s = useBookingWizard.getState();
  s.set("categoryId", "cat_1");
  s.set("pickupDepotId", "dep_1");
  s.set("pickupDateTime", "2026-05-01T10:00:00.000Z");
  s.set("returnDateTime", "2026-05-03T10:00:00.000Z");
  s.markHydrated();
  s.setStep(2);
}

describe("StepVehicle — Continue can't fail silently (#20)", () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState({}, "", "/booking");
    useBookingWizard.getState().reset();
    useBookingWizard.setState({ isHydrated: false });
    // jsdom has no layout engine, so scrollIntoView is undefined there.
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("explains what's needed when Continue is clicked with nothing chosen", () => {
    seedStep2();
    render(<StepVehicle />);
    expect(screen.queryByText(NEEDS_CHOICE_COPY)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.queryByText(NEEDS_CHOICE_COPY)).not.toBeNull();
    expect(useBookingWizard.getState().step).toBe(2);
  });

  it("advances with no message once a vehicle is chosen", () => {
    seedStep2();
    useBookingWizard.getState().set("preferredVehicleId", "veh_1");
    render(<StepVehicle />);

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.queryByText(NEEDS_CHOICE_COPY)).toBeNull();
    expect(useBookingWizard.getState().step).toBe(3);
  });

  it("clears the message as soon as the customer answers with 'No preference'", () => {
    seedStep2();
    render(<StepVehicle />);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.queryByText(NEEDS_CHOICE_COPY)).not.toBeNull();

    act(() => {
      useBookingWizard.getState().set("noPreference", true);
    });

    expect(screen.queryByText(NEEDS_CHOICE_COPY)).toBeNull();
  });
});
