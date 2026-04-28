import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { uploadFile } from "@/lib/storage";
import { withAudit } from "@/lib/with-audit";
import { scanForMalware } from "@/lib/file-scan";

const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_BYTES = 4 * 1024 * 1024;

export const POST = withAudit(
  { name: "api.upload.avatar", entity: "User" },
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
      { error: "Unsupported file type. Use PNG, JPEG, or WEBP." },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File too large (max 4MB)" }, { status: 400 });
  }

  const body = Buffer.from(await file.arrayBuffer());
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
    folder: `avatars/${session.user.id}`,
    filename: file.name,
    contentType: file.type,
    body,
  });

  return NextResponse.json({ url: result.url, key: result.key });
}
