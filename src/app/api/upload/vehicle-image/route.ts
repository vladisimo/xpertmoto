import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { uploadFile } from "@/lib/storage";
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

  // Scan before upload. ClamAV (or bypass in dev) — see lib/file-scan.ts.
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

  const result = await uploadFile({
    folder,
    filename: file.name,
    contentType: file.type,
    body,
  });

  return NextResponse.json({ url: result.url, key: result.key });
}
