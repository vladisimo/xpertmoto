import { readFileSync } from "fs";
import { join } from "path";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../../setup";

vi.mock("../../../src/lib/prisma", () => ({
  prisma: {
    vehicleModel: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    vehicleModelDocument: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
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

const HONDA_SPECS = readFileSync(join(__dirname, "../../fixtures/honda/pcx-specs.html"), "utf-8");
const HONDA_MANUALS = readFileSync(join(__dirname, "../../fixtures/honda/manuals-index.html"), "utf-8");
const FAKE_PDF = Buffer.from("%PDF-1.4\nfake pcx manual\n%%EOF");

const pcxModel = {
  id: "model_pcx",
  make: "Honda",
  model: "PCX",
  year: 2024,
  slug: "honda-pcx-125-2024",
};

describe("runEnrichment — Honda PCX 125", () => {
  beforeEach(() => {
    modelFindUnique.mockReset();
    modelUpdate.mockReset();
    docFindUnique.mockReset();
    docCreate.mockReset();
    mockedUpload.mockReset();

    modelFindUnique.mockResolvedValue(pcxModel);
    modelUpdate.mockResolvedValue({});
    docFindUnique.mockResolvedValue(null);
    docCreate.mockResolvedValue({});
    mockedUpload.mockResolvedValue({
      key: "vehicle-model-documents/abc.pdf",
      url: "https://cdn.test/vehicle-model-documents/abc.pdf",
    });
  });

  it("writes specs + an OWNERS_MANUAL doc on the happy path", async () => {
    server.use(
      http.get(
        "https://motorcycles.honda.com.au/models/onroad/scooter/pcx/specifications",
        () => HttpResponse.html(HONDA_SPECS),
      ),
      http.get(
        "https://motorcycles.honda.com.au/en/owners/owners-manuals",
        () => HttpResponse.html(HONDA_MANUALS),
      ),
      http.get(
        "https://motorcycles.honda.com.au/owners/manuals/pcx-2024.pdf",
        () => HttpResponse.arrayBuffer(FAKE_PDF.buffer.slice(FAKE_PDF.byteOffset, FAKE_PDF.byteOffset + FAKE_PDF.byteLength)),
      ),
      http.get(
        "https://motorcycles.honda.com.au/owners/manuals/pcx-2023.pdf",
        () => HttpResponse.arrayBuffer(FAKE_PDF.buffer.slice(FAKE_PDF.byteOffset, FAKE_PDF.byteOffset + FAKE_PDF.byteLength)),
      ),
    );

    const summary = await runEnrichment(prisma as never, pcxModel.id);

    expect(summary.specsUpdated).toBe(true);
    expect(summary.documentsAdded).toBe(1);

    const specsCall = modelUpdate.mock.calls.find((c) => "engineCapacityCc" in c[0].data);
    expect(specsCall).toBeDefined();
    const specData = specsCall![0].data;
    expect(specData.engineCapacityCc).toBe(125);
    expect(Number(specData.enginePowerKw)).toBeCloseTo(9.2);
    expect(Number(specData.engineTorqueNm)).toBeCloseTo(11.7);
    expect(Number(specData.dryWeightKg)).toBeCloseTo(134);
    expect(Number(specData.fuelTankLitres)).toBeCloseTo(8.1);
    expect(specData.specsConfidence).toBe("OFFICIAL_MANUFACTURER");
    expect(specData.specsSourceUrl).toBe(
      "https://motorcycles.honda.com.au/models/onroad/scooter/pcx/specifications",
    );

    expect(mockedUpload).toHaveBeenCalledTimes(1);
    expect(docCreate).toHaveBeenCalledTimes(1);
    const docData = docCreate.mock.calls[0]![0].data;
    expect(docData.type).toBe("OWNERS_MANUAL");
    expect(docData.sourceDomain).toBe("motorcycles.honda.com.au");
    expect(docData.sha256).toHaveLength(64);
  });

  it("leaves the model unchanged when the manual 404s", async () => {
    server.use(
      http.get(
        "https://motorcycles.honda.com.au/models/onroad/scooter/pcx/specifications",
        () => HttpResponse.html(HONDA_SPECS),
      ),
      http.get(
        "https://motorcycles.honda.com.au/en/owners/owners-manuals",
        () => HttpResponse.html(HONDA_MANUALS),
      ),
      http.get(
        "https://motorcycles.honda.com.au/owners/manuals/pcx-2024.pdf",
        () => new HttpResponse(null, { status: 404 }),
      ),
      http.get(
        "https://motorcycles.honda.com.au/owners/manuals/pcx-2023.pdf",
        () => new HttpResponse(null, { status: 404 }),
      ),
    );

    const summary = await runEnrichment(prisma as never, pcxModel.id);

    expect(summary.specsUpdated).toBe(true); // specs succeeded independently
    expect(summary.documentsAdded).toBe(0);
    expect(summary.documentsSkipped).toBeGreaterThan(0);
    expect(mockedUpload).not.toHaveBeenCalled();
    expect(docCreate).not.toHaveBeenCalled();
  });

  it("rejects a document whose source domain is not in the allowlist", async () => {
    const disallowedIndex = `
      <html><body>
        <a href="https://manualslib.com/manuals/pcx-2024.pdf">PCX 2024 Owner's Manual</a>
      </body></html>
    `;

    server.use(
      http.get(
        "https://motorcycles.honda.com.au/models/onroad/scooter/pcx/specifications",
        () => HttpResponse.html(HONDA_SPECS),
      ),
      http.get(
        "https://motorcycles.honda.com.au/en/owners/owners-manuals",
        () => HttpResponse.html(disallowedIndex),
      ),
    );

    const summary = await runEnrichment(prisma as never, pcxModel.id);

    expect(summary.documentsAdded).toBe(0);
    expect(summary.documentsSkipped).toBe(1);
    expect(mockedUpload).not.toHaveBeenCalled();
    expect(docCreate).not.toHaveBeenCalled();
  });
});
