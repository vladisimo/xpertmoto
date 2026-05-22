import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  flushBookingWizard,
  isCustomerComplete,
  maxReachableStep,
  POST_BOOKING_RESET_FLAG,
  useBookingWizard,
} from "@/stores/booking-wizard";

/**
 * Populate the wizard with the prerequisites for a target step so
 * setStep won't get clamped down by maxReachableStep. Mirrors what the
 * user would have entered by clicking Continue through the wizard.
 */
function seedReachable(step: 1 | 2 | 3 | 4 | 5 | 6) {
  const s = useBookingWizard.getState();
  if (step >= 2) {
    s.set("categoryId", "cat_1");
    s.set("pickupDepotId", "dep_1");
    s.set("pickupDateTime", "2026-05-01T10:00:00.000Z");
    s.set("returnDateTime", "2026-05-03T10:00:00.000Z");
  }
  if (step >= 3) s.set("preferredVehicleId", "veh_1");
  if (step >= 5) {
    s.setCustomer({
      firstName: "Jo",
      lastName: "Bloggs",
      email: "jo@example.com",
      dateOfBirth: "1990-01-01",
      licenceNumber: "12345678",
      licenceState: "QLD",
      licenceExpiry: "2030-01-01",
    });
    s.set("identityPath", "AU_LICENCE");
  }
  if (step >= 6) {
    s.set("agreedToTerms", true);
    s.set("signatureDataUrl", "data:image/png;base64,abc");
  }
}

describe("booking wizard store", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    window.history.replaceState({}, "", "/booking");
    useBookingWizard.getState().reset();
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    window.history.replaceState({}, "", "/booking");
    vi.restoreAllMocks();
  });

  describe("reset()", () => {
    it("clears transient wizard state back to defaults", () => {
      seedReachable(4);
      const s = useBookingWizard.getState();
      s.setCustomer({ firstName: "Jo", email: "jo@example.com" });
      s.setStep(4);

      expect(useBookingWizard.getState().step).toBe(4);
      expect(useBookingWizard.getState().categoryId).toBe("cat_1");

      useBookingWizard.getState().reset();

      const after = useBookingWizard.getState();
      expect(after.step).toBe(1);
      expect(after.categoryId).toBeNull();
      expect(after.pickupDepotId).toBeNull();
      expect(after.preferredVehicleId).toBeNull();
      expect(after.customer.firstName).toBe("");
      expect(after.customer.email).toBe("");
    });
  });

  describe("identityPath", () => {
    it("defaults to null and is cleared on reset", () => {
      expect(useBookingWizard.getState().identityPath).toBeNull();
      useBookingWizard.getState().set("identityPath", "AU_LICENCE");
      expect(useBookingWizard.getState().identityPath).toBe("AU_LICENCE");
      useBookingWizard.getState().reset();
      expect(useBookingWizard.getState().identityPath).toBeNull();
    });

    it("allows switching between AU_LICENCE and INTERNATIONAL", () => {
      const s = useBookingWizard.getState();
      s.set("identityPath", "AU_LICENCE");
      expect(useBookingWizard.getState().identityPath).toBe("AU_LICENCE");
      useBookingWizard.getState().set("identityPath", "INTERNATIONAL");
      expect(useBookingWizard.getState().identityPath).toBe("INTERNATIONAL");
    });

    it("persists licenceCountry on the customer slice", () => {
      useBookingWizard.getState().setCustomer({ licenceCountry: "US" });
      expect(useBookingWizard.getState().customer.licenceCountry).toBe("US");
      useBookingWizard.getState().reset();
      expect(useBookingWizard.getState().customer.licenceCountry).toBe("");
    });
  });

  describe("stepContinueAction", () => {
    it("defaults to null", () => {
      expect(useBookingWizard.getState().stepContinueAction).toBeNull();
    });

    it("can be set and cleared via setStepContinueAction", () => {
      const onClick = () => {};
      useBookingWizard.getState().setStepContinueAction({
        label: "Continue",
        disabled: false,
        onClick,
      });
      const stored = useBookingWizard.getState().stepContinueAction;
      expect(stored?.label).toBe("Continue");
      expect(stored?.disabled).toBe(false);
      expect(stored?.onClick).toBe(onClick);

      useBookingWizard.getState().setStepContinueAction(null);
      expect(useBookingWizard.getState().stepContinueAction).toBeNull();
    });

    it("is excluded from persisted localStorage (function can't serialise)", () => {
      useBookingWizard.getState().setStepContinueAction({
        label: "Continue",
        disabled: false,
        onClick: () => {},
      });
      const raw = localStorage.getItem("xpertmoto-booking-wizard");
      expect(raw).not.toBeNull();
      const parsed = JSON.parse(raw!);
      expect(parsed.state).not.toHaveProperty("stepContinueAction");
    });
  });

  describe("flushBookingWizard()", () => {
    it("resets state, wipes the persisted localStorage row, and sets the post-booking flag", () => {
      seedReachable(5);
      useBookingWizard.getState().setStep(5);

      // Sanity: Zustand persist writes to localStorage synchronously.
      expect(localStorage.getItem("xpertmoto-booking-wizard")).not.toBeNull();

      flushBookingWizard();

      const after = useBookingWizard.getState();
      expect(after.step).toBe(1);
      expect(after.categoryId).toBeNull();
      expect(after.preferredVehicleId).toBeNull();

      // persist.clearStorage removes the row entirely — not just overwrites
      // with defaults. This is the belt-and-braces against a partial-write
      // that the plain reset() path wouldn't catch.
      expect(localStorage.getItem("xpertmoto-booking-wizard")).toBeNull();

      // Flag is set so /booking's useEffect skips URL-param seeding once
      // on the post-payment bounce.
      expect(sessionStorage.getItem(POST_BOOKING_RESET_FLAG)).toBe("1");
    });

    it("is idempotent when called with an already-empty store", () => {
      expect(() => flushBookingWizard()).not.toThrow();
      expect(useBookingWizard.getState().step).toBe(1);
      expect(sessionStorage.getItem(POST_BOOKING_RESET_FLAG)).toBe("1");
    });

    it("strips ?step= from the URL so a subsequent Back doesn't restore the just-completed step", () => {
      window.history.replaceState({ wizardStep: 6 }, "", "/booking?step=6");
      flushBookingWizard();
      expect(window.location.search).toBe("");
    });
  });

  describe("isCustomerComplete()", () => {
    it("returns false without an identityPath", () => {
      expect(
        isCustomerComplete(
          {
            firstName: "Jo",
            lastName: "B",
            email: "j@x",
            phone: "",
            dateOfBirth: "1990-01-01",
            licenceNumber: "1",
            licenceState: "QLD",
            licenceCountry: "",
            licenceExpiry: "2030-01-01",
            licenceClass: "",
            passportNumber: "",
            passportCountry: "",
            passportExpiry: "",
            emergencyContactName: "",
            emergencyContactPhone: "",
          },
          null,
        ),
      ).toBe(false);
    });

    it("AU_LICENCE path requires licenceNumber + state + expiry", () => {
      const base = useBookingWizard.getState().customer;
      expect(isCustomerComplete(base, "AU_LICENCE")).toBe(false);
      seedReachable(5);
      expect(
        isCustomerComplete(
          useBookingWizard.getState().customer,
          "AU_LICENCE",
        ),
      ).toBe(true);
    });

    it("INTERNATIONAL path requires IDP fields AND passport fields", () => {
      seedReachable(5); // sets AU_LICENCE-shaped fields
      const customerWithoutPassport = useBookingWizard.getState().customer;
      expect(isCustomerComplete(customerWithoutPassport, "INTERNATIONAL")).toBe(false);

      useBookingWizard.getState().setCustomer({
        licenceCountry: "US",
        passportNumber: "P123",
        passportExpiry: "2030-01-01",
      });
      const full = useBookingWizard.getState().customer;
      expect(isCustomerComplete(full, "INTERNATIONAL")).toBe(true);
    });
  });

  describe("maxReachableStep()", () => {
    it("returns 1 with an empty store", () => {
      expect(maxReachableStep(useBookingWizard.getState())).toBe(1);
    });

    it("returns 2 once category + depot + dates are set", () => {
      seedReachable(2);
      expect(maxReachableStep(useBookingWizard.getState())).toBe(2);
    });

    it("unlocks step 4 once a vehicle is chosen (or noPreference) — step 4 has no extras-side gate", () => {
      seedReachable(3);
      expect(maxReachableStep(useBookingWizard.getState())).toBe(4);

      // noPreference also unlocks the path to step 4
      useBookingWizard.getState().reset();
      seedReachable(2);
      useBookingWizard.getState().set("noPreference", true);
      expect(maxReachableStep(useBookingWizard.getState())).toBe(4);
    });

    it("does not lift past step 4 when customer details are incomplete", () => {
      seedReachable(3);
      // identityPath alone without licence fields stays at 4
      useBookingWizard.getState().set("identityPath", "AU_LICENCE");
      expect(maxReachableStep(useBookingWizard.getState())).toBe(4);
    });

    it("returns 5 with full customer details but no terms/signature", () => {
      seedReachable(5);
      expect(maxReachableStep(useBookingWizard.getState())).toBe(5);
    });

    it("returns 6 once terms agreed and signature captured", () => {
      seedReachable(6);
      expect(maxReachableStep(useBookingWizard.getState())).toBe(6);
    });
  });

  describe("setStep / next / back URL sync", () => {
    it("clamps setStep to maxReachableStep", () => {
      // Empty store → max reachable is 1, so setStep(5) clamps to 1.
      useBookingWizard.getState().setStep(5);
      expect(useBookingWizard.getState().step).toBe(1);
    });

    it("setStep pushes ?step=N to history", () => {
      const pushSpy = vi.spyOn(window.history, "pushState");
      seedReachable(3);
      useBookingWizard.getState().setStep(3);
      expect(useBookingWizard.getState().step).toBe(3);
      expect(pushSpy).toHaveBeenCalledTimes(1);
      const lastCall = pushSpy.mock.calls.at(-1)!;
      expect(lastCall[0]).toEqual({ wizardStep: 3 });
      expect(String(lastCall[2])).toContain("step=3");
    });

    it("setStep is idempotent when the URL already reflects the step", () => {
      seedReachable(2);
      window.history.replaceState({ wizardStep: 2 }, "", "/booking?step=2");
      const pushSpy = vi.spyOn(window.history, "pushState");
      useBookingWizard.getState().setStep(2);
      expect(pushSpy).not.toHaveBeenCalled();
    });

    it("_setStepSilent does not write to history", () => {
      const pushSpy = vi.spyOn(window.history, "pushState");
      const replaceSpy = vi.spyOn(window.history, "replaceState");
      useBookingWizard.getState()._setStepSilent(3);
      expect(useBookingWizard.getState().step).toBe(3);
      expect(pushSpy).not.toHaveBeenCalled();
      expect(replaceSpy).not.toHaveBeenCalled();
    });

    it("next() and back() route through setStep (URL gets pushed)", () => {
      seedReachable(3);
      const pushSpy = vi.spyOn(window.history, "pushState");
      useBookingWizard.getState().setStep(2);
      useBookingWizard.getState().next();
      useBookingWizard.getState().back();
      expect(useBookingWizard.getState().step).toBe(2);
      // 3 transitions: setStep(2), next→3, back→2
      expect(pushSpy).toHaveBeenCalledTimes(3);
    });
  });
});
