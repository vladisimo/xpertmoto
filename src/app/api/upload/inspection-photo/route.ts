import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { uploadFile } from "@/lib/storage";
import { withAudit } from "@/lib/with-audit";

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 12 * 1024 * 1024;

export const POST = withAudit(
  { name: "api.upload.inspectionPhoto", entity: "InspectionPhoto" },
  handlePost,
);

async function handlePost(req: Request) {
  const session = await auth();
  if (!session?.user || !["STAFF", "MANAGER", "ADMIN", "SUPER_ADMIN"].includes(session.user.role)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const form = await req.formData();
  const file = form.get("file");
  const inspectionId = form.get("inspectionId");
  const caption = form.get("caption");
  const damageZone = form.get("damageZone");

  if (!(file instanceof File)) return NextResponse.json({ error: "No file" }, { status: 400 });
  if (typeof inspectionId !== "string") {
    return NextResponse.json({ error: "inspectionId required" }, { status: 400 });
  }
  if (!ALLOWED.has(file.type)) {
    return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File too large (max 12MB)" }, { status: 400 });
  }

  const inspection = await prisma.inspection.findUnique({ where: { id: inspectionId } });
  if (!inspection) return NextResponse.json({ error: "Inspection not found" }, { status: 404 });

  const body = Buffer.from(await file.arrayBuffer());
  const uploaded = await uploadFile({
    folder: `inspections/${inspection.id}/photos`,
    filename: file.name,
    contentType: file.type,
    body,
  });
  const photo = await prisma.inspectionPhoto.create({
    data: {
      inspectionId: inspection.id,
      url: uploaded.url,
      caption: typeof caption === "string" ? caption : undefined,
      damageZone: typeof damageZone === "string" ? damageZone : undefined,
    },
  });
  return NextResponse.json({ id: photo.id, url: uploaded.url, key: uploaded.key });
}
