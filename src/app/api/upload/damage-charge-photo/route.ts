import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { uploadFile } from "@/lib/storage";
import { withAudit } from "@/lib/with-audit";

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 12 * 1024 * 1024;

export const POST = withAudit(
  { name: "api.upload.damageChargePhoto", entity: "DamageCharge" },
  handlePost,
);

async function handlePost(req: Request) {
  const session = await auth();
  if (!session?.user || !["STAFF", "MANAGER", "ADMIN", "SUPER_ADMIN"].includes(session.user.role)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const form = await req.formData();
  const file = form.get("file");
  const assessmentId = form.get("assessmentId");

  if (!(file instanceof File)) return NextResponse.json({ error: "No file" }, { status: 400 });
  if (typeof assessmentId !== "string") {
    return NextResponse.json({ error: "assessmentId required" }, { status: 400 });
  }
  if (!ALLOWED.has(file.type)) {
    return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File too large (max 12MB)" }, { status: 400 });
  }

  const body = Buffer.from(await file.arrayBuffer());
  const uploaded = await uploadFile({
    folder: `damage-charges/${assessmentId}`,
    filename: file.name,
    contentType: file.type,
    body,
  });
  return NextResponse.json({ id: uploaded.key, url: uploaded.url, key: uploaded.key });
}
