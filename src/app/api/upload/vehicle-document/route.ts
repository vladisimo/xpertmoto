import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { uploadFile } from "@/lib/storage";
import { withAudit } from "@/lib/with-audit";

const ALLOWED = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const MAX_BYTES = 16 * 1024 * 1024;

export const POST = withAudit({ name: "api.upload.vehicleDocument", entity: "VehicleDocument" }, handlePost);

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
    return NextResponse.json({ error: "Unsupported file type. Allowed: PDF, JPEG, PNG, WebP" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File too large (max 16MB)" }, { status: 400 });
  }

  const body = Buffer.from(await file.arrayBuffer());

  const result = await uploadFile({
    folder: "vehicle-documents",
    filename: file.name,
    contentType: file.type,
    body,
  });

  // Thumbnails: images are their own thumbnail; PDFs get page-1 rendered
  // server-side. PDF render failures fall back to `null` so the UI can
  // show a file-type icon — a broken thumbnail must not block the upload.
  let thumbnailUrl: string | null = null;
  if (file.type.startsWith("image/")) {
    thumbnailUrl = result.url;
  } else if (file.type === "application/pdf") {
    thumbnailUrl = await renderPdfThumbnail(body, file.name);
  }

  return NextResponse.json({ url: result.url, key: result.key, thumbnailUrl });
}

async function renderPdfThumbnail(pdf: Buffer, originalName: string): Promise<string | null> {
  try {
    const { pdfToPng } = await import("pdf-to-png-converter");
    const pages = await pdfToPng(pdf, {
      disableFontFace: true,
      useSystemFonts: false,
      pagesToProcess: [1],
      viewportScale: 1.2,
    });
    const png = pages[0]?.content;
    if (!png) return null;
    const res = await uploadFile({
      folder: "vehicle-documents",
      filename: `${stripExt(originalName)}-thumb.png`,
      contentType: "image/png",
      body: png,
    });
    return res.url;
  } catch {
    // Swallow — upload still succeeds without a thumbnail.
    return null;
  }
}

function stripExt(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(0, i) : name;
}
