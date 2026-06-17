import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withAudit } from "@/lib/with-audit";
import { runRevenueNswImport } from "@/server/services/revenue-nsw-import";

// The Service NSW / eNominations "outstanding fines" export is CSV or Excel.
const ALLOWED_MIME = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
  "application/csv",
  "application/octet-stream",
]);
const ALLOWED_EXT = [".xlsx", ".xls", ".csv"];
const MAX_BYTES = 8 * 1024 * 1024;

export const POST = withAudit(
  { name: "api.staff.revenue-nsw.import", entity: "Infringement" },
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

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }
  const lowerName = file.name.toLowerCase();
  const extOk = ALLOWED_EXT.some((ext) => lowerName.endsWith(ext));
  if (!extOk && !ALLOWED_MIME.has(file.type)) {
    return NextResponse.json(
      { error: "Unsupported file. Upload the Revenue NSW export as .csv, .xlsx, or .xls." },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File too large (max 8MB)" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const summary = await runRevenueNswImport(prisma, buffer);
    return NextResponse.json(summary);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Import failed" },
      { status: 500 },
    );
  }
}
