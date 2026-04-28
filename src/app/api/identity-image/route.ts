import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { downloadFile } from "@/lib/storage";

// Same-origin proxy for identity-document images (driver's licence, passport).
// Avoids three separate dev/prod headaches with direct S3/MinIO URLs:
//   1. Local MinIO at localhost:9000 is unreachable from remote clients (phone
//      over a tunnel) and from Next's image optimiser (Next 16 blocks private
//      IPs) — both are fine when the bytes come from our own origin.
//   2. CSP img-src only allows `'self'` and the prod S3 region host; serving
//      from this route keeps us on `'self'` and removes the need to widen
//      img-src for dev.
//   3. Auth stays server-side: a customer can only fetch keys under their own
//      `drivers/<userId>/…` prefix; staff-and-above can fetch any identity key.
const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  pdf: "application/pdf",
};

const STAFF_ROLES = new Set(["STAFF", "MANAGER", "ADMIN", "SUPER_ADMIN"]);

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const key = req.nextUrl.searchParams.get("key");
  if (!key) {
    return NextResponse.json({ error: "Missing key" }, { status: 400 });
  }

  const role = session.user.role;
  const isStaff = STAFF_ROLES.has(role);
  const ownsKey = key.startsWith(`drivers/${session.user.id}/`);
  if (!isStaff && !ownsKey) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let bytes: Buffer;
  try {
    bytes = await downloadFile(key);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  const contentType = CONTENT_TYPE_BY_EXT[ext] ?? "application/octet-stream";

  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(bytes.length),
      // Private + short-lived: identity docs are PII, and the signed-URL
      // analogue expires in 15 min. no-store keeps shared proxies out.
      "Cache-Control": "private, max-age=300, must-revalidate",
    },
  });
}
