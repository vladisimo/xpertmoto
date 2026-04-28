import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withAudit } from "@/lib/with-audit";
import { parseVehicleSheet, ParseError } from "@/lib/fleet/import-parse";
import { validateVehicleRows } from "@/lib/fleet/import-validate";

const MAX_BYTES = 4 * 1024 * 1024;
const MAX_ROWS = 500;

export const POST = withAudit(
  { name: "api.fleet.importValidate", entity: "Vehicle" },
  handlePost,
);

async function handlePost(req: Request) {
  const session = await auth();
  if (!session?.user || !["MANAGER", "ADMIN", "SUPER_ADMIN"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File too large (max 4 MB)" }, { status: 413 });
  }
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    return NextResponse.json({ error: "File must be .xlsx" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  let parsed;
  try {
    parsed = parseVehicleSheet(buffer);
  } catch (err) {
    const message = err instanceof ParseError ? err.message : "Failed to parse file";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  if (parsed.rows.length > MAX_ROWS) {
    return NextResponse.json(
      { error: `Too many rows (${parsed.rows.length}). Max per import is ${MAX_ROWS}.` },
      { status: 413 },
    );
  }

  const result = await validateVehicleRows(
    parsed.rows,
    parsed.rowNumbers,
    { prisma },
    parsed.sanity,
  );

  return NextResponse.json(result);
}
