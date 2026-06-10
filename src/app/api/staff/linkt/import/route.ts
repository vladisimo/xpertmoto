import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withAudit } from "@/lib/with-audit";
import { runLinktSync } from "@/server/services/linkt";

// Linkt's official commercial "Export trips" download is CSV or Excel. The
// portal caps an export at 1,000 trips, so files are small; 8 MB is generous.
const ALLOWED_MIME = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
  "application/csv",
  "application/octet-stream", // some browsers
]);
const ALLOWED_EXT = [".xlsx", ".xls", ".csv"];
const MAX_BYTES = 8 * 1024 * 1024;

export const POST = withAudit(
  { name: "api.staff.linkt.import", entity: "LinktSync" },
  handlePost,
);

async function handlePost(req: Request) {
  const session = await auth();
  if (
    !session?.user ||
    !["MANAGER", "ADMIN", "SUPER_ADMIN"].includes(session.user.role)
  ) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid multipart body" }, { status: 400 });
  }

  const accountId = String(form.get("accountId") ?? "");
  if (!accountId) {
    return NextResponse.json({ error: "Missing accountId" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }
  const lowerName = file.name.toLowerCase();
  const extOk = ALLOWED_EXT.some((ext) => lowerName.endsWith(ext));
  if (!extOk && !ALLOWED_MIME.has(file.type)) {
    return NextResponse.json(
      { error: "Unsupported file. Upload the Linkt export as .csv, .xlsx, or .xls." },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File too large (max 8MB)" }, { status: 400 });
  }

  const account = await prisma.linktAccount.findUnique({
    where: { id: accountId },
    select: { id: true },
  });
  if (!account) {
    return NextResponse.json({ error: "Linkt account not found" }, { status: 404 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // runLinktSync records its own LinktSync row and converts a parse failure into
  // a FAILED status rather than throwing; a throw here is an unexpected error.
  let result: { syncId: string; status: string };
  try {
    result = await runLinktSync(prisma, accountId, { buffer });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sync failed" },
      { status: 500 },
    );
  }

  const sync = await prisma.linktSync.findUnique({
    where: { id: result.syncId },
    select: {
      rowsFetched: true,
      rowsCreated: true,
      rowsDuplicate: true,
      rowsUnmatched: true,
      error: true,
    },
  });

  return NextResponse.json({ ...result, ...sync });
}
