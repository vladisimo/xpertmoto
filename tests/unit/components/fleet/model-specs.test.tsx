import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  ModelSpecs,
  buildSpecRows,
  type ModelSpecsInput,
} from "@/components/fleet/model-specs";

afterEach(cleanup);

const EMPTY: ModelSpecsInput = {
  engineCapacityCc: null,
  enginePowerKw: null,
  engineTorqueNm: null,
  dryWeightKg: null,
  fuelTankLitres: null,
  fuelType: null,
  topSpeedKmh: null,
  seatHeightMm: null,
  tyreFront: null,
  tyreRear: null,
  serviceIntervalKm: null,
  serviceIntervalMonths: null,
};

function labels(input: ModelSpecsInput): string[] {
  return buildSpecRows(input).map((r) => r.label);
}

describe("buildSpecRows — engine capacity", () => {
  it("renders the Engine row from the model's own capacity", () => {
    const rows = buildSpecRows({ ...EMPTY, engineCapacityCc: 50 });
    expect(rows.find((r) => r.label === "Engine")?.value).toBe("50 cc");
  });

  it("omits the Engine row when the model has no capacity", () => {
    // frontend-test-findings #8: prefer no spec over the category's coarse
    // figure. The other specs still render, so the row simply drops out.
    expect(labels({ ...EMPTY, engineCapacityCc: null, seatHeightMm: 770 })).toEqual([
      "Seat height",
    ]);
  });
});

describe("ModelSpecs", () => {
  it("falls back to the verification copy when nothing is on file", () => {
    render(<ModelSpecs input={EMPTY} />);
    expect(screen.getByText(/technical specs for this model are being verified/i)).toBeDefined();
  });

  it("renders the remaining specs when only the engine is unknown", () => {
    render(<ModelSpecs input={{ ...EMPTY, seatHeightMm: 770 }} />);
    expect(screen.getByText("Seat height")).toBeDefined();
    expect(screen.queryByText("Engine")).toBeNull();
  });
});
