import { tmpdir } from "node:os";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../../../setup";

const h = vi.hoisted(() => ({ getBranding: vi.fn() }));
vi.mock("@/lib/branding", () => ({ getBranding: h.getBranding }));

// The bundled-asset cases read the real file off disk, which doubles as an
// assertion that public/brand/ still ships the square logo.
import { GET } from "@/app/favicon.ico/route";

const FAVICON_URL = "https://cdn.example.com/tenant/favicon.png";

beforeEach(() => {
  h.getBranding.mockReset();
  h.getBranding.mockResolvedValue({ faviconUrl: null });
});

describe("GET /favicon.ico", () => {
  it("serves the bundled square brand mark when no favicon is configured", async () => {
    const res = await GET();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("public, max-age=86400");

    const body = new Uint8Array(await res.arrayBuffer());
    expect(body.byteLength).toBeGreaterThan(0);
    // PNG magic number — proves a real image, not an error page.
    expect(Array.from(body.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it("proxies the operator-configured favicon with its own content type", async () => {
    h.getBranding.mockResolvedValue({ faviconUrl: FAVICON_URL });
    server.use(
      http.get(FAVICON_URL, () =>
        HttpResponse.arrayBuffer(new Uint8Array([1, 2, 3]).buffer, {
          headers: { "Content-Type": "image/x-icon" },
        }),
      ),
    );

    const res = await GET();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/x-icon");
    expect(res.headers.get("cache-control")).toBe("public, max-age=86400");
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual([1, 2, 3]);
  });

  it("falls back to the bundled asset when the configured favicon 404s", async () => {
    h.getBranding.mockResolvedValue({ faviconUrl: FAVICON_URL });
    server.use(http.get(FAVICON_URL, () => new HttpResponse(null, { status: 404 })));

    const res = await GET();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });

  it("falls back to the bundled asset when the configured URL isn't an image", async () => {
    h.getBranding.mockResolvedValue({ faviconUrl: FAVICON_URL });
    server.use(
      http.get(FAVICON_URL, () => HttpResponse.text("<!doctype html>not an icon")),
    );

    const res = await GET();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
  });

  it("falls back to the bundled asset when branding is unavailable", async () => {
    h.getBranding.mockRejectedValue(new Error("database is down"));

    const res = await GET();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
  });

  it("404s rather than throwing when the bundled asset is missing", async () => {
    // The fallback is resolved against the working directory; a directory
    // without public/brand/ stands in for a deploy that didn't ship it.
    const cwd = process.cwd();
    process.chdir(tmpdir());
    try {
      expect((await GET()).status).toBe(404);
    } finally {
      process.chdir(cwd);
    }
  });
});
