import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withAudit } from "@/lib/with-audit";
import {
  classifyRows,
  commitImport,
  MAX_IMPORT_ROWS,
  parseCustomerImportFile,
} from "@/server/services/customer-import";

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
  { name: "api.staff.customers.import", entity: "CustomerImport" },
  handlePost,
);

async function handlePost(req: Request) {
  const session = await auth();
  if (
    !session?.user ||
    !["STAFF", "MANAGER", "ADMIN", "SUPER_ADMIN"].includes(session.user.role)
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
  const mode = String(form.get("mode") ?? "validate");
  if (mode !== "validate" && mode !== "commit") {
    return NextResponse.json(
      { error: "mode must be 'validate' or 'commit'" },
      { status: 400 },
    );
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }
  const lowerName = file.name.toLowerCase();
  const extOk = ALLOWED_EXT.some((ext) => lowerName.endsWith(ext));
  if (!extOk && !ALLOWED_MIME.has(file.type)) {
    return NextResponse.json(
      { error: "Unsupported file. Upload .xlsx, .xls, or .csv." },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "File too large (max 8MB)" },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  let rawRows;
  try {
    rawRows = parseCustomerImportFile(buffer);
  } catch (err) {
    return NextResponse.json(
      {
        error: `Could not read spreadsheet: ${err instanceof Error ? err.message : "parse error"}`,
      },
      { status: 400 },
    );
  }
  if (rawRows.length > MAX_IMPORT_ROWS) {
    return NextResponse.json(
      { error: `Too many rows (max ${MAX_IMPORT_ROWS}). Split the file and retry.` },
      { status: 400 },
    );
  }

  const summary = await classifyRows(rawRows, prisma);

  if (mode === "validate") {
    return NextResponse.json({ mode, summary });
  }

  const result = await prisma.$transaction(async (tx) => commitImport(summary, tx));

  return NextResponse.json({
    mode,
    summary,
    inserted: result.inserted,
    skipped: result.skipped,
  });
}
