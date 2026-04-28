import { readFileSync } from "fs";
import { join } from "path";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../../setup";

vi.mock("../../../src/lib/prisma", () => ({
  prisma: {
    vehicleModel: { findUnique: vi.fn(), update: vi.fn() },
    vehicleModelDocument: { findUnique: vi.fn(), create: vi.fn() },
  },
}));

vi.mock("../../../src/lib/storage", () => ({
  uploadFile: vi.fn(),
  downloadFile: vi.fn(),
  deleteFile: vi.fn(),
  getSignedUrl: vi.fn(),
}));

import { runEnrichment } from "../../../src/server/services/vehicle-enrichment";
import { prisma } from "../../../src/lib/prisma";
import { uploadFile } from "../../../src/lib/storage";

type MockFn = ReturnType<typeof vi.fn>;
const modelFindUnique = prisma.vehicleModel.findUnique as unknown as MockFn;
const modelUpdate = prisma.vehicleModel.update as unknown as MockFn;
const docFindUnique = prisma.vehicleModelDocument.findUnique as unknown as MockFn;
const docCreate = prisma.vehicleModelDocument.create as unknown as MockFn;
const mockedUpload = uploadFile as unknown as MockFn;

const NMAX_SPECS = readFileSync(join(__dirname, "../../fixtures/yamaha/nmax-specs.html"), "utf-8");
const EMPTY_INDEX = `<html><body></body></html>`;

const nmaxModel = {
  id: "model_nmax",
  make: "Yamaha",
  model: "NMAX",
  year: 2024,
  slug: "yamaha-nmax-125-2024",
};

describe("runEnrichment — Yamaha NMAX 125", () => {
  beforeEach(() => {
    modelFindUnique.mockReset();
    modelUpdate.mockReset();
    docFindUnique.mockReset();
    docCreate.mockReset();
    mockedUpload.mockReset();

    modelFindUnique.mockResolvedValue(nmaxModel);
    modelUpdate.mockResolvedValue({});
    docFindUnique.mockResolvedValue(null);
    docCreate.mockResolvedValue({});
    mockedUpload.mockResolvedValue({ key: "k", url: "https://cdn.test/k" });
  });

  it("parses NMAX specs off a <dl> page and tags with Yamaha provenance", async () => {
    server.use(
      http.get(
        "https://www.yamaha-motor.com.au/products/scooters/urban-mobility/nmax-125",
        () => HttpResponse.html(NMAX_SPECS),
      ),
      http.get(
        "https://www.yamaha-motor.eu/en/owners/owner-s-manuals",
        () => HttpResponse.html(EMPTY_INDEX),
      ),
    );

    const summary = await runEnrichment(prisma as never, nmaxModel.id);

    expect(summary.specsUpdated).toBe(true);
    const specsCall = modelUpdate.mock.calls.find((c) => "engineCapacityCc" in c[0].data);
    expect(specsCall).toBeDefined();
    const data = specsCall![0].data;
    expect(data.engineCapacityCc).toBe(125);
    expect(Number(data.enginePowerKw)).toBeCloseTo(9.0);
    expect(Number(data.engineTorqueNm)).toBeCloseTo(11.2);
    expect(Number(data.dryWeightKg)).toBeCloseTo(131);
    expect(Number(data.fuelTankLitres)).toBeCloseTo(7.1);
    expect(data.specsSourceName).toBe("Yamaha Motor Australia");
    expect(data.specsConfidence).toBe("OFFICIAL_MANUFACTURER");
  });
});
