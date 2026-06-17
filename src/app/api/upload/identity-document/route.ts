import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { uploadFile } from "@/lib/storage";
import { uploadImage } from "@/lib/image-processing";
import { withAudit } from "@/lib/with-audit";

/**
 * Customer self-service upload for identity documents (driver's licence
 * front/back, passport bio-page). Parallel to the staff-only
 * `/api/upload/customer-document` route, but gated to the caller only and
 * always folder-scoped to `drivers/<ctx.user.id>/<yyyy-mm>/…` so one
 * customer can't attach a key from another customer's folder.
 *
 * The tRPC `customer.uploadIdentityDocument` mutation then takes the
 * returned key and creates the CustomerDocument row + profile-cache
 * projection in one transaction.
 */

const ALLOWED = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 16 * 1024 * 1024;

export const POST = withAudit(
  { name: "api.upload.identityDocument", entity: "CustomerDocument" },
  handlePost,
);

async function handlePost(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file" }, { status: 400 });
  }
  if (!ALLOWED.has(file.type)) {
    return NextResponse.json(
      { error: "Unsupported file type. Allowed: PDF, JPEG, PNG, WebP" },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File too large (max 16MB)" }, { status: 400 });
  }

  const body = Buffer.from(await file.arrayBuffer());
  const now = new Date();
  const yyyyMm = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  // Folder pattern is parsed by the tRPC mutation to prevent cross-user
  // attachment of keys. Don't change the shape without updating the
  // `imageKey.startsWith(...)` check in customer.uploadIdentityDocument.
  const folder = `drivers/${session.user.id}/${yyyyMm}`;

  try {
    // Images are resized + recompressed before storage (caps a multi-MB
    // phone photo and, per APP 11, strips EXIF/GPS from the licence shot)
    // while staying high enough resolution for downstream OCR/licence
    // verification. PDFs are passed through untouched — sharp can't process
    // them. The mutation only checks the folder prefix, so the extension
    // change a JPEG/WebP re-encode produces is harmless.
    const result = file.type === "application/pdf"
      ? await uploadFile({
          folder,
          filename: file.name,
          contentType: file.type,
          body,
        })
      : await uploadImage(body, {
          folder,
          originalName: file.name,
          processOpts: { maxWidth: 2400, maxHeight: 2400, quality: 88 },
        });
    // Intentionally return only the key — not the direct public URL.
    // Identity documents are PII (APP 11 §I); viewers must go through a
    // server-side authorised endpoint that mints a short-TTL signed URL
    // via `getSignedUrl`, never resolve the S3 public URL client-side.
    return NextResponse.json({ key: result.key });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
