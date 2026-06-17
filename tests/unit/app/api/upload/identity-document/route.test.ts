// @vitest-environment node
// Server route: needs Node's undici File/FormData/Request to agree so the
// multipart body parses (jsdom's File would fail the `instanceof` check).
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/with-audit", () => ({
  withAudit: (_opts: unknown, handler: unknown) => handler,
}));

const authMock = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: () => authMock() }));

// Both storage writers are mocked so we can assert which branch ran without
// invoking sharp or S3. Images go through uploadImage (resized, EXIF-stripped);
// PDFs — which sharp can't process — pass through uploadFile untouched.
const uploadFileMock = vi.fn();
vi.mock("@/lib/storage", () => ({
  uploadFile: (args: unknown) => uploadFileMock(args),
}));

const uploadImageMock = vi.fn();
vi.mock("@/lib/image-processing", () => ({
  uploadImage: (body: unknown, args: unknown) => uploadImageMock(body, args),
}));

import { POST } from "@/app/api/upload/identity-document/route";

function formRequest(file: File): Request {
  const fd = new FormData();
  fd.set("file", file);
  return new Request("https://x/api/upload/identity-document", { method: "POST", body: fd });
}

describe("POST /api/upload/identity-document", () => {
  beforeEach(() => {
    authMock.mockReset();
    uploadFileMock.mockReset();
    uploadImageMock.mockReset();
    authMock.mockResolvedValue({ user: { id: "u1" } });
    uploadFileMock.mockResolvedValue({ key: "drivers/u1/2026-06/x.pdf", url: "u", checksum: "c" });
    uploadImageMock.mockResolvedValue({
      key: "drivers/u1/2026-06/x.jpg",
      url: "u",
      checksum: "c",
      width: 100,
      height: 100,
      rotated: false,
    });
  });

  it("passes a PDF through unprocessed (sharp can't read PDFs)", async () => {
    const pdf = new File([Uint8Array.from([0x25, 0x50, 0x44, 0x46])], "licence.pdf", {
      type: "application/pdf",
    });

    const res = await POST(formRequest(pdf));

    expect(res.status).toBe(200);
    expect(uploadFileMock).toHaveBeenCalledTimes(1);
    expect(uploadImageMock).not.toHaveBeenCalled();
    expect((await res.json()) as unknown).toEqual({ key: "drivers/u1/2026-06/x.pdf" });
  });

  it("routes an image through the resize/EXIF-strip pipeline", async () => {
    const png = new File([Uint8Array.from([0x89, 0x50, 0x4e, 0x47])], "licence.png", {
      type: "image/png",
    });

    const res = await POST(formRequest(png));

    expect(res.status).toBe(200);
    expect(uploadImageMock).toHaveBeenCalledTimes(1);
    expect(uploadFileMock).not.toHaveBeenCalled();
    // Conservative cap to protect downstream OCR / licence verification.
    const opts = uploadImageMock.mock.calls[0]?.[1] as { processOpts: { maxWidth: number } };
    expect(opts.processOpts.maxWidth).toBe(2400);
    expect((await res.json()) as unknown).toEqual({ key: "drivers/u1/2026-06/x.jpg" });
  });
});
