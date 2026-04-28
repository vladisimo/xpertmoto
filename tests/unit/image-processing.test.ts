import { test, expect, describe } from "vitest";
import sharp from "sharp";
import { processImage } from "../../src/lib/image-processing";

/**
 * Build a small RGB JPEG with a specified EXIF Orientation tag.
 *
 * Orientation values:
 *   1 = upright (default)
 *   6 = 90° CW (phone held portrait, camera sensor landscape)
 *   8 = 90° CCW
 */
async function makeJpegWithOrientation(
  width: number,
  height: number,
  orientation: number,
): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 100, g: 150, b: 200 },
    },
  })
    .withMetadata({ orientation })
    .jpeg()
    .toBuffer();
}

describe("processImage", () => {
  test("auto-rotates a sideways (orientation=6) JPEG upright", async () => {
    // 800 wide × 600 tall with orientation 6 means the "upright" view is 600×800.
    const sideways = await makeJpegWithOrientation(800, 600, 6);
    const result = await processImage(sideways);

    expect(result.rotated).toBe(true);
    // After rotation the intrinsic dimensions swap.
    expect(result.width).toBe(600);
    expect(result.height).toBe(800);
    expect(result.contentType).toBe("image/jpeg");
  });

  test("leaves upright (orientation=1) JPEG unrotated", async () => {
    const upright = await makeJpegWithOrientation(400, 300, 1);
    const result = await processImage(upright);

    expect(result.rotated).toBe(false);
    expect(result.width).toBe(400);
    expect(result.height).toBe(300);
  });

  test("resizes down when image exceeds maxWidth, respects aspect ratio", async () => {
    const huge = await sharp({
      create: { width: 4000, height: 3000, channels: 3, background: "#000" },
    })
      .jpeg()
      .toBuffer();

    const result = await processImage(huge, { maxWidth: 2400 });
    expect(result.width).toBe(2400);
    expect(result.height).toBe(1800); // 4000:3000 ratio preserved
  });

  test("does not upscale images smaller than maxWidth", async () => {
    const tiny = await sharp({
      create: { width: 200, height: 150, channels: 3, background: "#fff" },
    })
      .jpeg()
      .toBuffer();

    const result = await processImage(tiny, { maxWidth: 2400 });
    expect(result.width).toBe(200);
    expect(result.height).toBe(150);
  });

  test("preserves PNG output for PNG input (signature use case)", async () => {
    const png = await sharp({
      create: {
        width: 300,
        height: 100,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .png()
      .toBuffer();

    const result = await processImage(png);
    expect(result.contentType).toBe("image/png");
  });

  test("explicit format option overrides default", async () => {
    const png = await sharp({
      create: { width: 300, height: 300, channels: 3, background: "#123456" },
    })
      .png()
      .toBuffer();

    const result = await processImage(png, { format: "jpeg" });
    expect(result.contentType).toBe("image/jpeg");
  });

  test("strips EXIF metadata (no GPS, no orientation tag left)", async () => {
    const withExif = await makeJpegWithOrientation(500, 400, 6);
    const result = await processImage(withExif);
    // Reading metadata back, orientation should be gone (or 1) since sharp
    // applied the rotation and the output no longer needs the tag.
    const out = await sharp(result.buffer).metadata();
    expect(out.orientation === undefined || out.orientation === 1).toBe(true);
  });

  test("applies quality option to JPEG output (smaller buffer at lower q)", async () => {
    const src = await sharp({
      create: { width: 1000, height: 1000, channels: 3, background: "#abcdef" },
    })
      .jpeg()
      .toBuffer();

    const hq = await processImage(src, { quality: 95 });
    const lq = await processImage(src, { quality: 40 });
    expect(lq.buffer.byteLength).toBeLessThan(hq.buffer.byteLength);
  });
});
