import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { downloadFile } from "@/lib/storage";

/**
 * Same-origin proxy for `CustomerDocument` rows. Keeps consent PDFs (and
 * any other CustomerDocument file) on `'self'` so:
 *   1. Local MinIO at `localhost:9000` doesn't leak to the user's
 *      browser via `fileUrl` (the symptom that prompted this route —
 *      the customer was being sent to `http://localhost:9000/...`).
 *   2. CSP doesn't have to widen for direct S3/MinIO hosts in prod.
 *   3. Access is auth-gated server-side: a customer can only fetch
 *      their own documents; STAFF and above can fetch any.
 *
 * Usage: `/api/customer-document?id=<CustomerDocument.id>`. The S3 key
 * is resolved internally — preferring `metadata.fileKey`, falling back
 * to `fileUrl` when it looks like a key (no `http(s)://` scheme).
 */
const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

const STAFF_ROLES = new Set(["STAFF", "MANAGER", "ADMIN", "SUPER_ADMIN"]);

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  const doc = await prisma.customerDocument.findUnique({
    where: { id },
    select: { id: true, customerId: true, fileUrl: true, metadata: true, type: true },
  });
  if (!doc) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const isStaff = STAFF_ROLES.has(session.user.role);
  const owns = doc.customerId === session.user.id;
  if (!isStaff && !owns) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const md = (doc.metadata ?? {}) as { fileKey?: string };
  // Prefer metadata.fileKey; legacy rows may have stored the bucket URL
  // in fileUrl, but only the key is usable for downloadFile.
  const candidate = md.fileKey ?? doc.fileUrl;
  if (!candidate) {
    return NextResponse.json({ error: "No file" }, { status: 404 });
  }
  const looksLikeUrl = /^https?:\/\//i.test(candidate);
  const key = looksLikeUrl
    ? candidate.replace(/^https?:\/\/[^/]+\//, "").replace(/^[^/]+\//, "")
    : candidate;

  let bytes: Buffer;
  try {
    bytes = await downloadFile(key);
  } catch {
    return NextResponse.json({ error: "File missing" }, { status: 404 });
  }

  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  const contentType = CONTENT_TYPE_BY_EXT[ext] ?? "application/octet-stream";

  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(bytes.length),
      // Private + short-lived: signed legal docs are PII.
      "Cache-Control": "private, max-age=300, must-revalidate",
    },
  });
}
