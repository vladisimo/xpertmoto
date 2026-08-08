import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Both children fetch over tRPC as soon as the card mounts; the at-a-glance
// spec row under test doesn't need either.
vi.mock("@/components/booking/vehicle-spec-sheet", () => ({
  VehicleSpecSheet: () => null,
}));
vi.mock("@/components/booking/vehicle-image-lightbox", () => ({
  VehicleImageLightbox: () => null,
}));

import { VehicleCard, type VehicleCardVehicle } from "@/components/booking/vehicle-card";

afterEach(cleanup);

// A 50cc Dio in a category whose coarse figure is 660cc — the exact shape of
// frontend-test-findings #8. The category number must never reach the card.
const VEHICLE: VehicleCardVehicle = {
  id: "veh-1",
  make: "Honda",
  model: "Dio",
  year: 2023,
  colour: "Red",
  condition: "GOOD",
  currentOdometerKm: 4200,
  internalCode: "DIO-01",
  category: { name: "Motorcycle", engineCapacity: 660 },
  engineCapacityCc: 50,
  depot: { name: "Brisbane City" },
  images: [],
};

function renderCard(overrides: Partial<VehicleCardVehicle> = {}) {
  return render(
    <VehicleCard
      vehicle={{ ...VEHICLE, ...overrides }}
      selected={false}
      onSelect={() => {}}
    />,
  );
}

describe("VehicleCard engine spec", () => {
  it("shows the catalogue model's capacity when the model has one", () => {
    renderCard();
    expect(screen.getByText("Engine")).toBeDefined();
    expect(screen.getByText("50cc")).toBeDefined();
  });

  it("hides the engine spec when the model capacity is unknown", () => {
    renderCard({ engineCapacityCc: null });
    expect(screen.queryByText("Engine")).toBeNull();
    // Never substitutes the category's 660cc.
    expect(screen.queryByText(/cc$/)).toBeNull();
  });

  it("keeps the odometer row when only the engine is unknown", () => {
    renderCard({ engineCapacityCc: null });
    expect(screen.getByText("Km")).toBeDefined();
    expect(screen.getByText("4,200")).toBeDefined();
  });

  it("drops the spec list entirely when neither engine nor odometer is known", () => {
    const { container } = renderCard({ engineCapacityCc: null, currentOdometerKm: 0 });
    expect(container.querySelector("dl")).toBeNull();
  });
});
