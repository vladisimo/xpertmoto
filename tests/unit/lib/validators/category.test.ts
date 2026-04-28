import { describe, expect, test } from "vitest";
import {
  categoryArchiveSchema,
  categoryFormSchema,
  SLUG_RE,
} from "@/lib/validators/category";

const BASE = {
  name: "150cc Scooter",
  slug: "150cc-scooter",
  description: "",
  engineCapacity: 150,
  licenceRequired: "RE" as const,
  minAge: 18,
  displayOrder: 0,
  baseDailyRate: 79,
  baseWeeklyRate: 459,
  baseMonthlyRate: 1349,
  bondAmount: 600,
  images: [],
};

describe("SLUG_RE", () => {
  test("accepts hyphenated lowercase slugs", () => {
    expect(SLUG_RE.test("125cc-scooter")).toBe(true);
    expect(SLUG_RE.test("motorbike")).toBe(true);
    expect(SLUG_RE.test("light-vehicle-hatch")).toBe(true);
  });
  test("rejects upper-case, leading/trailing hyphens, and spaces", () => {
    expect(SLUG_RE.test("125cc Scooter")).toBe(false);
    expect(SLUG_RE.test("-motorbike")).toBe(false);
    expect(SLUG_RE.test("motorbike-")).toBe(false);
    expect(SLUG_RE.test("Motorbike")).toBe(false);
  });
});

describe("categoryFormSchema", () => {
  test("happy path: a Motorbike category passes", () => {
    const result = categoryFormSchema.safeParse({
      ...BASE,
      name: "Motorbike 650cc",
      slug: "motorbike-650",
      engineCapacity: 650,
      licenceRequired: "R",
    });
    expect(result.success).toBe(true);
  });

  test("happy path: a Light Vehicle (Car) category passes", () => {
    const result = categoryFormSchema.safeParse({
      ...BASE,
      name: "Light Vehicle — Hatchback",
      slug: "light-vehicle-hatch",
      engineCapacity: 1500,
      licenceRequired: "CAR",
    });
    expect(result.success).toBe(true);
  });

  test("rejects malformed slug", () => {
    const result = categoryFormSchema.safeParse({ ...BASE, slug: "Not A Slug" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === "slug")).toBe(true);
    }
  });

  test("rejects licence class outside CAR/RE/R (heavy classes not supported yet)", () => {
    const result = categoryFormSchema.safeParse({
      ...BASE,
      licenceRequired: "LR" as unknown as "CAR",
    });
    expect(result.success).toBe(false);
  });

  test("rejects engine capacity < 1", () => {
    const result = categoryFormSchema.safeParse({ ...BASE, engineCapacity: 0 });
    expect(result.success).toBe(false);
  });

  test("rejects minAge below 16", () => {
    const result = categoryFormSchema.safeParse({ ...BASE, minAge: 15 });
    expect(result.success).toBe(false);
  });

  test("rejects negative rates and bond", () => {
    expect(categoryFormSchema.safeParse({ ...BASE, baseDailyRate: -1 }).success).toBe(false);
    expect(categoryFormSchema.safeParse({ ...BASE, bondAmount: -50 }).success).toBe(false);
  });

  test("description is optional", () => {
    const result = categoryFormSchema.safeParse({ ...BASE, description: undefined });
    expect(result.success).toBe(true);
  });
});

describe("categoryArchiveSchema", () => {
  test("accepts mixed reassign + dispose actions", () => {
    const result = categoryArchiveSchema.safeParse({
      id: "cat-1",
      vehicleActions: [
        { action: "REASSIGN", vehicleId: "v1", targetCategoryId: "cat-2" },
        {
          action: "DISPOSE",
          vehicleId: "v2",
          targetStatus: "SOLD",
          reason: "end of season clear-out",
          salePrice: 3500,
        },
        {
          action: "DISPOSE",
          vehicleId: "v3",
          targetStatus: "END_OF_LIFE",
          reason: "retired",
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  test("rejects DISPOSE without a reason", () => {
    const result = categoryArchiveSchema.safeParse({
      id: "cat-1",
      vehicleActions: [
        { action: "DISPOSE", vehicleId: "v1", targetStatus: "SOLD", reason: "" },
      ],
    });
    expect(result.success).toBe(false);
  });

  test("rejects DISPOSE with a non-disposition status like PENDING", () => {
    const result = categoryArchiveSchema.safeParse({
      id: "cat-1",
      vehicleActions: [
        {
          action: "DISPOSE",
          vehicleId: "v1",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          targetStatus: "PENDING" as any,
          reason: "huh",
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  test("accepts an empty vehicleActions list (category with no vehicles)", () => {
    const result = categoryArchiveSchema.safeParse({ id: "cat-1", vehicleActions: [] });
    expect(result.success).toBe(true);
  });
});
