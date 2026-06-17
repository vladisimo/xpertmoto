import { describe, it, expect, vi, beforeEach } from "vitest";

// The job pulls prisma + the two run-services at import time; stub them so we
// can drive the scrape-vs-rematch gating in isolation.
const h = vi.hoisted(() => ({
  findMany: vi.fn(),
  runLinktSync: vi.fn(),
  runLinktScrape: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: { linktAccount: { findMany: h.findMany } } }));
vi.mock("@/server/services/linkt", () => ({ runLinktSync: h.runLinktSync }));
vi.mock("@/server/services/linkt-scrape", () => ({ runLinktScrape: h.runLinktScrape }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/server/jobs/queue", () => ({ getQueue: vi.fn(), registerWorker: vi.fn() }));

import { runAllLinktSyncs } from "@/server/jobs/linkt-sync";

beforeEach(() => {
  h.findMany.mockReset();
  h.runLinktSync.mockReset().mockResolvedValue({ syncId: "rematch", status: "SUCCESS" });
  h.runLinktScrape.mockReset().mockResolvedValue({ syncId: "scrape", status: "SUCCESS" });
});

describe("runAllLinktSyncs gating", () => {
  it("scrapes accounts opted in with no pending re-auth", async () => {
    h.findMany.mockResolvedValue([{ id: "a1", scrapeEnabled: true, reauthNeededAt: null }]);
    await runAllLinktSyncs();
    expect(h.runLinktScrape).toHaveBeenCalledWith(expect.anything(), "a1");
    expect(h.runLinktSync).not.toHaveBeenCalled();
  });

  it("runs the rematch pass (no scrape) for manual-upload accounts", async () => {
    h.findMany.mockResolvedValue([{ id: "a2", scrapeEnabled: false, reauthNeededAt: null }]);
    await runAllLinktSyncs();
    expect(h.runLinktSync).toHaveBeenCalledWith(expect.anything(), "a2");
    expect(h.runLinktScrape).not.toHaveBeenCalled();
  });

  it("skips scraping an account flagged for re-auth and falls back to rematch", async () => {
    h.findMany.mockResolvedValue([{ id: "a3", scrapeEnabled: true, reauthNeededAt: new Date() }]);
    await runAllLinktSyncs();
    expect(h.runLinktScrape).not.toHaveBeenCalled();
    expect(h.runLinktSync).toHaveBeenCalledWith(expect.anything(), "a3");
  });

  it("isolates a failing account so the rest still sync", async () => {
    h.findMany.mockResolvedValue([
      { id: "bad", scrapeEnabled: true, reauthNeededAt: null },
      { id: "good", scrapeEnabled: false, reauthNeededAt: null },
    ]);
    h.runLinktScrape.mockRejectedValueOnce(new Error("Incapsula block"));
    const res = await runAllLinktSyncs();
    expect(h.runLinktSync).toHaveBeenCalledWith(expect.anything(), "good");
    expect(res).toContainEqual({ syncId: "", status: "FAILED" });
    expect(res).toContainEqual({ syncId: "rematch", status: "SUCCESS" });
  });
});
