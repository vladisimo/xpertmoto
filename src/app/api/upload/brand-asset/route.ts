import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { auth } from "@/lib/auth";
import { uploadFile } from "@/lib/storage";
import { withAudit } from "@/lib/with-audit";
import { scanForMalware } from "@/lib/file-scan";
import { setSetting, type SettingKey } from "@/lib/settings";

const ALLOWED = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
  "image/x-icon",
  "image/vnd.microsoft.icon",
]);
const MAX_BYTES = 4 * 1024 * 1024;

const SLOT_TO_KEY: Record<string, SettingKey> = {
  logoWide: "org.logoWideUrl",
  logoBlack: "org.logoBlackUrl",
  logoSquare: "org.logoSquareUrl",
  favicon: "org.faviconUrl",
};

export const POST = withAudit(
  { name: "api.upload.brandAsset", entity: "Organisation" },
  handlePost,
);

async function handlePost(req: Request) {
  const session = await auth();
  if (!session?.user || !["ADMIN", "SUPER_ADMIN"].includes(session.user.role)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const form = await req.formData();
  const file = form.get("file");
  const slot = String(form.get("slot") ?? "");
  const settingKey = SLOT_TO_KEY[slot];
  if (!settingKey) {
    return NextResponse.json({ error: "Invalid slot" }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file" }, { status: 400 });
  }
  if (!ALLOWED.has(file.type)) {
    return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
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
    folder: "branding",
    filename: file.name,
    contentType: file.type,
    body,
  });

  await setSetting(settingKey, result.url);
  revalidateTag("branding", "max");

  return NextResponse.json({ slot, url: result.url, key: result.key });
}
