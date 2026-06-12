import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

const getReportMock = vi.fn();
vi.mock("@/lib/export/registry", () => ({
  getReport: (...a: unknown[]) => getReportMock(...a),
}));
const toPdfBufferMock = vi.fn();
vi.mock("@/lib/export/pdf", () => ({
  toPdfBuffer: (...a: unknown[]) => toPdfBufferMock(...a),
}));
vi.mock("@/lib/branding", () => ({
  getBranding: vi.fn().mockResolvedValue({
    siteName: "X",
    abn: "11 111 111 111",
    supportEmail: "help@x.test",
  }),
}));

import { renderReportPdfBuffer } from "@/server/services/report-export";

const ctx = { userId: "u1", userRole: "ADMIN", depotId: null };

beforeEach(() => {
  vi.clearAllMocks();
  toPdfBufferMock.mockResolvedValue(Buffer.from("pdf"));
});

describe("renderReportPdfBuffer", () => {
  it("re-validates raw params through the report's schema and renders the fetched rows", async () => {
    const fetch = vi.fn().mockResolvedValue({
      rows: [{ a: 1 }],
      meta: { subtitle: "1 row" },
    });
    getReportMock.mockReturnValue({
      id: "r1",
      title: "Report One",
      columns: [{ key: "a", header: "A" }],
      inputSchema: z.object({ from: z.string().transform((s) => new Date(s)) }),
      fetch,
    });

    const buf = await renderReportPdfBuffer({
      reportId: "r1",
      params: { from: "2026-06-01" },
      ctx,
    });

    expect(buf.toString()).toBe("pdf");
    // The schema ran: fetch received a parsed Date, not the raw string.
    expect(fetch).toHaveBeenCalledWith(ctx, { from: new Date("2026-06-01") });
    expect(toPdfBufferMock).toHaveBeenCalledWith(
      expect.objectContaining({
        rows: [{ a: 1 }],
        meta: expect.objectContaining({
          title: "Report One",
          subtitle: "1 row",
          brand: expect.objectContaining({ name: "X", abn: "11 111 111 111" }),
        }),
      }),
    );
  });

  it("throws on an unknown report id", async () => {
    getReportMock.mockReturnValue(undefined);

    await expect(
      renderReportPdfBuffer({ reportId: "nope", params: {}, ctx }),
    ).rejects.toThrow("Unknown report: nope");
  });
});
