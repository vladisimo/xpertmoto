import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/rate-limit", () => ({
  rateLimit: vi.fn(async () => ({ ok: true, remaining: 199, resetAt: Date.now() + 60_000 })),
}));

const warnMock = vi.fn();
vi.mock("@/lib/logger", () => ({ logger: { warn: warnMock, error: vi.fn() } }));

import { rateLimit } from "@/lib/rate-limit";

async function post(body: string) {
  const { POST } = await import("@/app/api/csp-report/route");
  const { NextRequest } = await import("next/server");
  return POST(
    new NextRequest("http://localhost/api/csp-report", {
      method: "POST",
      headers: { "content-type": "application/csp-report" },
      body,
    }),
  );
}

beforeEach(() => {
  warnMock.mockClear();
  vi.mocked(rateLimit).mockResolvedValue({ ok: true, remaining: 199, resetAt: Date.now() + 60_000 });
});

describe("/api/csp-report", () => {
  it("logs a legacy csp-report body and returns 204", async () => {
    const res = await post(
      JSON.stringify({
        "csp-report": {
          "document-uri": "https://scootering.com.au/",
          "violated-directive": "script-src",
          "blocked-uri": "https://evil.example/js",
        },
      }),
    );
    expect(res.status).toBe(204);
    expect(warnMock).toHaveBeenCalledTimes(1);
    expect(warnMock.mock.calls[0]![0]).toMatchObject({
      csp: { "violated-directive": "script-src" },
    });
  });

  it("handles reports API array body", async () => {
    const res = await post(
      JSON.stringify([
        { type: "csp-violation", body: { blockedURL: "https://evil.example/js" } },
        { type: "csp-violation", body: { blockedURL: "https://also-evil/js" } },
      ]),
    );
    expect(res.status).toBe(204);
    expect(warnMock).toHaveBeenCalledTimes(2);
  });

  it("returns 400 on malformed JSON", async () => {
    const res = await post("not json");
    expect(res.status).toBe(400);
    expect(warnMock).not.toHaveBeenCalled();
  });

  it("returns 429 when rate-limit trips", async () => {
    vi.mocked(rateLimit).mockResolvedValueOnce({ ok: false, remaining: 0, resetAt: Date.now() + 60_000 });
    const res = await post(JSON.stringify({ "csp-report": {} }));
    expect(res.status).toBe(429);
    expect(warnMock).not.toHaveBeenCalled();
  });
});
