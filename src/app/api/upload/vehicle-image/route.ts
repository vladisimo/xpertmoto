import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { uploadImage } from "@/lib/image-processing";
import { withAudit } from "@/lib/with-audit";
import { scanForMalware } from "@/lib/file-scan";

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_BYTES = 8 * 1024 * 1024;

export const POST = withAudit({ name: "api.upload.vehicleImage", entity: "VehicleImage" }, handlePost);

async function handlePost(req: Request) {
  const session = await auth();
  if (!session?.user || !["STAFF", "MANAGER", "ADMIN", "SUPER_ADMIN"].includes(session.user.role)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file" }, { status: 400 });
  }
  if (!ALLOWED.has(file.type)) {
    return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File too large (max 8MB)" }, { status: 400 });
  }

  const folder = (form.get("folder") as string | null) ?? "vehicles";
  const body = Buffer.from(await file.arrayBuffer());

  // Scan the raw bytes the client sent before we touch them. ClamAV (or
  // bypass in dev) — see lib/file-scan.ts.
  const scan = await scanForMalware(body, {
    filename: file.name,
    contentType: file.type,
  });
  if (!scan.clean) {
    return NextResponse.json(
      { error: `File rejected: ${scan.reason}` },
      { status: 400 },
    );
  }

  // The 8MB gate above is the rejection ceiling for what we accept. What we
  // *store* is resized + recompressed: a full-res phone photo becomes a few
  // hundred KB, so the public model page and booking wizard aren't shipping
  // multi-MB originals for next/image to downscale on every cold request.
  // Re-encoding through sharp also strips EXIF and neutralises any payload
  // smuggled past the scanner. Force JPEG: vehicle photos are photographic
  // and never need an alpha channel, so we don't want a PNG screenshot
  // stored lossless at full size (PNG would otherwise be preserved). Animated
  // GIFs collapse to their first frame — fine for stock photos, which
  // next/image re-serves as WebP/AVIF to the browser regardless.
  const result = await uploadImage(body, {
    folder,
    originalName: file.name,
    processOpts: { maxWidth: 1920, maxHeight: 1920, quality: 80, format: "jpeg" },
  });

  return NextResponse.json({ url: result.url, key: result.key, checksum: result.checksum });
}
