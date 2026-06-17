// @vitest-environment node
// Server route: needs Node's undici File/FormData/Request to agree so the
// multipart body parses (jsdom's File would fail the `instanceof` check).
import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

// withAudit only wraps the handler with an audit row; bypass it so the test
// exercises the handler directly.
vi.mock("@/lib/with-audit", () => ({
  withAudit: (_opts: unknown, handler: unknown) => handler,
}));

const authMock = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: () => authMock() }));

vi.mock("@/lib/file-scan", () => ({
  scanForMalware: vi.fn().mockResolvedValue({ clean: true }),
}));

// Mock only the storage write. `uploadImage` (real) still runs the sharp
// pipeline, then hands the processed bytes here — which is exactly what we
// assert on. The route imports uploadImage from @/lib/image-processing, which
// imports uploadFile from this same module, so the mock applies to both.
const uploadFileMock = vi.fn();
vi.mock("@/lib/storage", () => ({
  uploadFile: (args: unknown) => uploadFileMock(args),
}));

import { POST } from "@/app/api/upload/vehicle-image/route";

function formRequest(file: File): Request {
  const fd = new FormData();
  fd.set("file", file);
  return new Request("https://x/api/upload/vehicle-image", { method: "POST", body: fd });
}

describe("POST /api/upload/vehicle-image", () => {
  beforeEach(() => {
    authMock.mockReset();
    uploadFileMock.mockReset();
    uploadFileMock.mockResolvedValue({
      key: "vehicles/new.jpg",
      url: "https://cdn/vehicles/new.jpg",
      checksum: "deadbeef",
    });
  });

  it("rejects an unauthenticated request without touching storage", async () => {
    authMock.mockResolvedValue(null);
    const png = await sharp({
      create: { width: 10, height: 10, channels: 3, background: "#000" },
    }).png().toBuffer();

    const res = await POST(
      formRequest(new File([Uint8Array.from(png)], "x.png", { type: "image/png" })),
    );

    expect(res.status).toBe(401);
    expect(uploadFileMock).not.toHaveBeenCalled();
  });

  it("resizes to <=1920px and transcodes to JPEG before storing", async () => {
    authMock.mockResolvedValue({ user: { id: "s1", role: "STAFF" } });
    // A 4000x3000 PNG — the kind of full-res upload that bloats the gallery.
    const bigPng = await sharp({
      create: { width: 4000, height: 3000, channels: 3, background: "#3366aa" },
    }).png().toBuffer();

    const res = await POST(
      formRequest(new File([Uint8Array.from(bigPng)], "vehicle.png", { type: "image/png" })),
    );

    expect(res.status).toBe(200);
    expect(uploadFileMock).toHaveBeenCalledTimes(1);

    const arg = uploadFileMock.mock.calls[0]?.[0] as { contentType: string; body: Buffer };
    expect(arg.contentType).toBe("image/jpeg"); // PNG input was transcoded
    const meta = await sharp(arg.body).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBe(1920); // capped down from 4000, aspect preserved
    expect(meta.height).toBe(1440);

    const json = (await res.json()) as { url: string; key: string; checksum: string };
    expect(json).toEqual({
      url: "https://cdn/vehicles/new.jpg",
      key: "vehicles/new.jpg",
      checksum: "deadbeef",
    });
  });
});
