import { describe, expect, it } from "vitest";
import {
  RENTABLE_MODEL_WHERE,
  CATEGORY_HAS_RENTABLE_VEHICLE,
} from "@/lib/fleet/consumer-visibility";

describe("consumer fleet visibility filters", () => {
  it("only surfaces rentable models that have an active unit", () => {
    expect(RENTABLE_MODEL_WHERE).toEqual({
      isRentable: true,
      vehicles: { some: { isActive: true } },
    });
  });

  it("only surfaces categories with an active unit of a rentable model", () => {
    expect(CATEGORY_HAS_RENTABLE_VEHICLE).toEqual({
      vehicles: { some: { isActive: true, catalogueModel: { isRentable: true } } },
    });
  });
});
