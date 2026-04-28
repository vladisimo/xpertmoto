import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { uploadFile } from "@/lib/storage";
import { withAudit } from "@/lib/with-audit";

const ALLOWED = new Set(["application/pdf"]);
const MAX_BYTES = 32 * 1024 * 1024; // Owner's manuals are large — 32MB cap

export const POST = withAudit(
  { name: "api.upload.vehicleModelDocument", entity: "VehicleModelDocument" },
  handlePost,
);

async function handlePost(req: Request) {
  const session = await auth();
  if (!session?.user || !["ADMIN", "SUPER_ADMIN"].includes(session.user.role)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file" }, { status: 400 });
  }
  if (!ALLOWED.has(file.type)) {
    return NextResponse.json(
      { error: "Unsupported file type. Only PDF is accepted." },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `File too large (max ${MAX_BYTES / (1024 * 1024)}MB)` },
      { status: 400 },
    );
  }

  const body = Buffer.from(await file.arrayBuffer());
  const result = await uploadFile({
    folder: "vehicle-model-documents",
    filename: file.name,
    contentType: file.type,
    body,
  });

  return NextResponse.json({
    url: result.url,
    key: result.key,
    sizeBytes: body.byteLength,
  });
}
