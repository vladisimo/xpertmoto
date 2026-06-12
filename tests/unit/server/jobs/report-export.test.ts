import { describe, it, expect, vi, beforeEach } from "vitest";

const getQueueMock = vi.fn();
const getQueueEventsMock = vi.fn();
const registerWorkerMock = vi.fn();
vi.mock("@/server/jobs/queue", () => ({
  getQueue: (...a: unknown[]) => getQueueMock(...a),
  getQueueEvents: (...a: unknown[]) => getQueueEventsMock(...a),
  registerWorker: (...a: unknown[]) => registerWorkerMock(...a),
}));
const renderMock = vi.fn();
vi.mock("@/server/services/report-export", () => ({
  renderReportPdfBuffer: (...a: unknown[]) => renderMock(...a),
}));
vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import {
  renderReportPdfQueued,
  startReportExportWorker,
} from "@/server/jobs/report-export";

const args = {
  reportId: "finance.overview",
  params: { from: "2026-06-01", to: "2026-06-30" },
  ctx: { userId: "u1", userRole: "ADMIN", depotId: null },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("renderReportPdfQueued", () => {
  it("waits for the worker's render and decodes the base64 result", async () => {
    const pdf = Buffer.from("rendered-pdf");
    const waitUntilFinished = vi
      .fn()
      .mockResolvedValue({ pdfBase64: pdf.toString("base64") });
    getQueueMock.mockReturnValue({ add: vi.fn().mockResolvedValue({ waitUntilFinished }) });
    getQueueEventsMock.mockReturnValue({});

    const buf = await renderReportPdfQueued(args);

    expect(buf?.equals(pdf)).toBe(true);
    expect(waitUntilFinished).toHaveBeenCalledWith({}, 30_000);
  });

  it("returns null without Redis so the route renders inline", async () => {
    getQueueMock.mockReturnValue(null);
    getQueueEventsMock.mockReturnValue(null);

    await expect(renderReportPdfQueued(args)).resolves.toBeNull();
  });

  it("returns null when the worker fails or times out (inline fallback)", async () => {
    const waitUntilFinished = vi.fn().mockRejectedValue(new Error("timed out"));
    getQueueMock.mockReturnValue({ add: vi.fn().mockResolvedValue({ waitUntilFinished }) });
    getQueueEventsMock.mockReturnValue({});

    await expect(renderReportPdfQueued(args)).resolves.toBeNull();
  });

  it("enqueues single-attempt — the waiting request needs the failure now, not retries", async () => {
    const add = vi.fn().mockResolvedValue({
      waitUntilFinished: vi.fn().mockResolvedValue({ pdfBase64: "" }),
    });
    getQueueMock.mockReturnValue({ add });
    getQueueEventsMock.mockReturnValue({});

    await renderReportPdfQueued(args);

    expect(add).toHaveBeenCalledWith("render", args, expect.objectContaining({ attempts: 1 }));
  });
});

describe("startReportExportWorker", () => {
  it("registers a processor that renders and returns base64", async () => {
    renderMock.mockResolvedValue(Buffer.from("pdf-bytes"));

    startReportExportWorker();

    expect(registerWorkerMock).toHaveBeenCalledWith("report-export", expect.any(Function));
    const processor = registerWorkerMock.mock.calls[0]![1] as (job: {
      data: typeof args;
    }) => Promise<{ pdfBase64: string }>;
    const res = await processor({ data: args });
    expect(Buffer.from(res.pdfBase64, "base64").toString()).toBe("pdf-bytes");
    expect(renderMock).toHaveBeenCalledWith(args);
  });
});
