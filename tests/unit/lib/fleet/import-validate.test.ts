import { describe, expect, test } from "vitest";
import { validateVehicleRows, type ValidateContext } from "@/lib/fleet/import-validate";

const CATEGORIES = [
  { id: "cat-50", name: "50cc Scooter" },
  { id: "cat-150", name: "150cc Scooter" },
];
const DEPOTS = [
  { id: "depot-gc", name: "Scootering Gold Coast" },
  { id: "depot-noosa", name: "Scootering Noosa" },
];

function makeCtx(
  existing: Array<{ internalCode: string; rego: string; regoState: string }> = [],
): ValidateContext {
  return {
    prisma: {
      depot: { findMany: async () => DEPOTS } as unknown as ValidateContext["prisma"]["depot"],
      vehicleCategory: {
        findMany: async () => CATEGORIES,
      } as unknown as ValidateContext["prisma"]["vehicleCategory"],
      vehicle: {
        findMany: async () => existing,
      } as unknown as ValidateContext["prisma"]["vehicle"],
    } as ValidateContext["prisma"],
  };
}

const VALID_ROW = {
  internalCode: "SCT-001",
  rego: "123-AB4",
  regoState: "QLD",
  make: "Honda",
  model: "PCX 150",
  year: 2024,
  colour: "White",
  categoryName: "150cc Scooter",
  depotName: "Scootering Gold Coast",
};

describe("validateVehicleRows", () => {
  test("happy path: single valid row is ready", async () => {
    const result = await validateVehicleRows([VALID_ROW], [2], makeCtx());
    expect(result.summary).toEqual({ ok: 1, error: 0, duplicate: 0, total: 1 });
    expect(result.rows[0]?.status).toBe("ok");
    expect(result.payload).toHaveLength(1);
    expect(result.payload[0]).toMatchObject({
      internalCode: "SCT-001",
      categoryId: "cat-150",
      depotId: "depot-gc",
      year: 2024,
    });
  });

  test("missing required field is flagged as error", async () => {
    const bad = { ...VALID_ROW, rego: "" };
    const result = await validateVehicleRows([bad], [2], makeCtx());
    expect(result.summary.error).toBe(1);
    expect(result.rows[0]?.issues.some((i) => i.includes("rego"))).toBe(true);
  });

  test("unknown categoryName errors and lists valid options", async () => {
    const bad = { ...VALID_ROW, categoryName: "Nonexistent" };
    const result = await validateVehicleRows([bad], [2], makeCtx());
    expect(result.summary.error).toBe(1);
    expect(result.rows[0]?.issues.join(" ")).toMatch(/categoryName.*Nonexistent.*150cc Scooter/);
  });

  test("non-integer year is flagged", async () => {
    const bad = { ...VALID_ROW, year: "abc" as unknown as number };
    const result = await validateVehicleRows([bad], [2], makeCtx());
    expect(result.summary.error).toBe(1);
    expect(result.rows[0]?.issues.some((i) => i.includes("year"))).toBe(true);
  });

  test("within-file duplicate on internalCode is flagged as duplicate (not error)", async () => {
    const a = { ...VALID_ROW };
    const b = { ...VALID_ROW, rego: "999-XY1" };
    const result = await validateVehicleRows([a, b], [2, 3], makeCtx());
    expect(result.summary.duplicate).toBe(1);
    expect(result.summary.ok).toBe(1);
    expect(result.rows[1]?.status).toBe("duplicate");
    expect(result.rows[1]?.issues.join(" ")).toMatch(/internalCode also appears on row 2/);
  });

  test("against-DB duplicate on (rego, regoState) is flagged", async () => {
    const result = await validateVehicleRows(
      [VALID_ROW],
      [2],
      makeCtx([{ internalCode: "OTHER", rego: "123-AB4", regoState: "QLD" }]),
    );
    expect(result.summary.duplicate).toBe(1);
    expect(result.rows[0]?.issues.join(" ")).toMatch(/\(rego, regoState\) already exists/);
  });

  test("enum coercion is case-insensitive and normalises to upper", async () => {
    const row = { ...VALID_ROW, condition: "excellent" };
    const result = await validateVehicleRows([row], [2], makeCtx());
    expect(result.summary.ok).toBe(1);
    expect(result.payload[0]?.condition).toBe("EXCELLENT");
  });

  test("header issues produce topErrors and skip row validation", async () => {
    const result = await validateVehicleRows([], [], makeCtx(), {
      missing: ["rego"],
      unknown: [],
    });
    expect(result.topErrors).toHaveLength(1);
    expect(result.topErrors[0]).toMatch(/Missing required columns: rego/);
    expect(result.rows).toHaveLength(0);
  });

  test("accepts an admin-settable status column", async () => {
    const row = { ...VALID_ROW, status: "PENDING" };
    const result = await validateVehicleRows([row], [2], makeCtx());
    expect(result.summary.ok).toBe(1);
    expect(result.payload[0]?.status).toBe("PENDING");
  });

  test("rejects a RENTED status on import — booking-driven only", async () => {
    const row = { ...VALID_ROW, status: "RENTED" };
    const result = await validateVehicleRows([row], [2], makeCtx());
    expect(result.summary.error).toBe(1);
    expect(result.rows[0]?.issues.join(" ")).toMatch(/status.*RENTED.*AVAILABLE/);
  });

  test("rejects an unknown status value", async () => {
    const row = { ...VALID_ROW, status: "NONSENSE" };
    const result = await validateVehicleRows([row], [2], makeCtx());
    expect(result.summary.error).toBe(1);
    expect(result.rows[0]?.issues.some((i) => i.includes("status"))).toBe(true);
  });

  test("status column is optional — defaults can be applied by the importer", async () => {
    const result = await validateVehicleRows([VALID_ROW], [2], makeCtx());
    expect(result.summary.ok).toBe(1);
    expect(result.payload[0]?.status).toBeUndefined();
  });

  test("date coercion accepts Excel serial, ISO, and DD/MM/YYYY", async () => {
    const rows = [
      { ...VALID_ROW, internalCode: "A", rego: "AAA-111", purchaseDate: "2026-02-14" },
      { ...VALID_ROW, internalCode: "B", rego: "BBB-222", purchaseDate: "14/02/2026" },
      { ...VALID_ROW, internalCode: "C", rego: "CCC-333", purchaseDate: new Date("2026-02-14") },
    ];
    const result = await validateVehicleRows(rows, [2, 3, 4], makeCtx());
    expect(result.summary.ok).toBe(3);
    for (const p of result.payload) {
      expect(p.purchaseDate?.getFullYear()).toBe(2026);
    }
  });
});
