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

export const POST = withAudit(
  { name: "api.upload.customerDocument", entity: "CustomerDocument" },
  handlePost,
);

async function handlePost(req: Request) {
  const session = await auth();
  if (
    !session?.user ||
    !["STAFF", "MANAGER", "ADMIN", "SUPER_ADMIN"].includes(session.user.role)
  ) {
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
  try {
    const result = await uploadFile({
      folder: "customer-documents",
      filename: file.name,
      contentType: file.type,
      body,
    });
    return NextResponse.json({ url: result.url, key: result.key });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
