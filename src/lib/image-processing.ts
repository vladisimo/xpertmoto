import sharp from "sharp";
import { uploadFile, type UploadResult } from "./storage";

export type ProcessImageOptions = {
  /** Maximum width in pixels; larger images are resized proportionally. Default: 2400. */
  maxWidth?: number;
  /** Maximum height in pixels; larger images are resized proportionally. Default: 2400. */
  maxHeight?: number;
  /** JPEG quality (1-100). Ignored for PNG output. Default: 85. */
  quality?: number;
  /**
   * Force output format. By default, PNGs are preserved (useful for
   * signatures with transparency) and everything else becomes JPEG.
   */
  format?: "jpeg" | "png";
};

export type ProcessedImage = {
  buffer: Buffer;
  contentType: "image/jpeg" | "image/png";
  width: number;
  height: number;
  /** True if EXIF orientation was applied to rotate the image upright. */
  rotated: boolean;
};

/**
 * Rotate, resize, and strip EXIF metadata from an image buffer.
 *
 * - Auto-rotates based on the EXIF `Orientation` tag so phone-captured
 *   sideways photos land upright. This is the behaviour `sharp.rotate()`
 *   enables when called with no arguments.
 * - Strips EXIF (PII: GPS, device info, timestamps) and reduces size.
 * - Resizes proportionally if the image exceeds `maxWidth`/`maxHeight`.
 *   Never upscales; small images pass through untouched dimensionally.
 * - Preserves PNG for transparency (signatures); everything else JPEG.
 */
export async function processImage(
  buffer: Buffer,
  opts: ProcessImageOptions = {},
): Promise<ProcessedImage> {
  const { maxWidth = 2400, maxHeight = 2400, quality = 85, format } = opts;

  const pipeline = sharp(buffer, { failOn: "error" });
  const metaBefore = await pipeline.metadata();

  // Detect whether EXIF orientation was non-default (2-8). sharp's rotate()
  // no-arg path applies the orientation and then clears the tag, so we
  // record it now for telemetry/debugging.
  const rotated = !!metaBefore.orientation && metaBefore.orientation > 1;

  // .rotate() with no args = apply EXIF orientation.
  pipeline.rotate();

  pipeline.resize({
    width: maxWidth,
    height: maxHeight,
    fit: "inside",
    withoutEnlargement: true,
  });

  // Strip EXIF entirely. Pass an empty object to `withMetadata` and sharp
  // writes only safe metadata (no GPS, camera model, timestamps).
  pipeline.withMetadata({ exif: {} });

  const chosenFormat = format ?? (metaBefore.format === "png" ? "png" : "jpeg");

  if (chosenFormat === "png") {
    pipeline.png({ compressionLevel: 9 });
  } else {
    pipeline.jpeg({ quality, mozjpeg: true });
  }

  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });

  return {
    buffer: data,
    contentType: chosenFormat === "png" ? "image/png" : "image/jpeg",
    width: info.width,
    height: info.height,
    rotated,
  };
}

/**
 * Process and upload an image in one call. Shorthand wrapper around
 * `processImage` + `uploadFile` used by the driver import, customer
 * portal licence uploads, inspection photos, and anywhere else we
 * accept user-supplied images.
 */
export async function uploadImage(
  buffer: Buffer,
  args: {
    folder: string;
    originalName?: string;
    processOpts?: ProcessImageOptions;
  },
): Promise<UploadResult & { width: number; height: number; rotated: boolean }> {
  const processed = await processImage(buffer, args.processOpts);
  const ext = processed.contentType === "image/png" ? "png" : "jpg";
  const filename = args.originalName
    ? replaceExt(args.originalName, ext)
    : `image.${ext}`;
  const uploaded = await uploadFile({
    folder: args.folder,
    filename,
    contentType: processed.contentType,
    body: processed.buffer,
  });
  return {
    ...uploaded,
    width: processed.width,
    height: processed.height,
    rotated: processed.rotated,
  };
}

function replaceExt(name: string, ext: string): string {
  const i = name.lastIndexOf(".");
  if (i < 0) return `${name}.${ext}`;
  return `${name.slice(0, i)}.${ext}`;
}

/**
 * Crop a region from an image and return a processed (EXIF-stripped,
 * size-capped) JPEG buffer. Coordinates are normalised (0-1) relative to
 * the source's oriented dimensions — i.e. we rotate via EXIF first and
 * then apply the bounding box, so the crop matches what a human sees.
 *
 * Used by the licence-detect flow to save a headshot crop from the
 * Claude-reported face bounding box.
 */
export async function cropImageRegion(
  buffer: Buffer,
  box: { x: number; y: number; width: number; height: number },
  opts: ProcessImageOptions = {},
): Promise<ProcessedImage> {
  const source = sharp(buffer, { failOn: "error" }).rotate();
  const meta = await source.metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  if (!W || !H) {
    throw new Error("cropImageRegion: source image has unknown dimensions");
  }

  const left = Math.max(0, Math.min(W - 1, Math.round(box.x * W)));
  const top = Math.max(0, Math.min(H - 1, Math.round(box.y * H)));
  const width = Math.max(1, Math.min(W - left, Math.round(box.width * W)));
  const height = Math.max(1, Math.min(H - top, Math.round(box.height * H)));

  const cropped = await source.extract({ left, top, width, height }).toBuffer();
  return processImage(cropped, { format: "jpeg", ...opts });
}

/**
 * Rotate an image by a fixed angle (clockwise) and return a processed
 * buffer suitable for re-upload. Used by the staff documents rotate
 * button so a sideways phone photo can be made upright in storage.
 *
 * sharp's `.rotate(deg)` rotates clockwise. We apply EXIF orientation
 * first (no-op on already-stripped images) so the rotation acts on the
 * upright pixels the user is actually looking at.
 */
export async function rotateImage(
  buffer: Buffer,
  degrees: 90 | 180 | 270,
): Promise<ProcessedImage> {
  const pipeline = sharp(buffer, { failOn: "error" });
  const meta = await pipeline.metadata();
  pipeline.rotate().rotate(degrees);
  pipeline.withMetadata({ exif: {} });

  const isPng = meta.format === "png";
  if (isPng) {
    pipeline.png({ compressionLevel: 9 });
  } else {
    pipeline.jpeg({ quality: 90, mozjpeg: true });
  }

  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
  return {
    buffer: data,
    contentType: isPng ? "image/png" : "image/jpeg",
    width: info.width,
    height: info.height,
    rotated: true,
  };
}
