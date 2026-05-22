import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { uploadFile } from "@/lib/storage";
import { withAudit } from "@/lib/with-audit";

const ALLOWED = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
]);
const MAX_BYTES = 15 * 1024 * 1024;
const VISITOR_COOKIE = "xpertmoto_vid";

export const POST = withAudit(
  { name: "api.upload.liveChat", entity: "SupportMessage" },
  handlePost,
);

async function handlePost(req: Request): Promise<Response> {
  const form = await req.formData();
  const file = form.get("file");
  const conversationId = form.get("conversationId");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file" }, { status: 400 });
  }
  if (typeof conversationId !== "string" || !conversationId) {
    return NextResponse.json({ error: "conversationId required" }, { status: 400 });
  }
  if (!ALLOWED.has(file.type)) {
    return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File too large (max 15MB)" }, { status: 400 });
  }

  const authorised = await authoriseUploader(req, conversationId);
  if (!authorised) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const body = Buffer.from(await file.arrayBuffer());
  const uploaded = await uploadFile({
    folder: `live-chat/${conversationId}`,
    filename: file.name,
    contentType: file.type,
    body,
  });

  return NextResponse.json({
    url: uploaded.url,
    key: uploaded.key,
    mimeType: file.type,
    sizeBytes: file.size,
    name: file.name,
  });
}

async function authoriseUploader(
  req: Request,
  conversationId: string,
): Promise<boolean> {
  const session = await auth();
  if (
    session?.user &&
    ["STAFF", "MANAGER", "ADMIN", "SUPER_ADMIN"].includes(session.user.role)
  ) {
    return true;
  }
  const vid = readVisitorCookie(req);
  if (!vid) return false;
  const visitor = await prisma.visitorSession.findUnique({
    where: { id: vid },
    select: { conversationId: true },
  });
  return visitor?.conversationId === conversationId;
}

function readVisitorCookie(req: Request): string | null {
  const raw = req.headers.get("cookie");
  if (!raw) return null;
  for (const pair of raw.split(";")) {
    const [k, ...rest] = pair.trim().split("=");
    if (k === VISITOR_COOKIE) return rest.join("=") || null;
  }
  return null;
}
