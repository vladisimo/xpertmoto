#!/usr/bin/env tsx
/**
 * Download a remote PDF and attach it to a VehicleModel row.
 *
 * Usage:
 *   npx tsx scripts/attach-external-pdf.ts \
 *     --make "Honda" --model "PCX" --year 2024 \
 *     --type OWNERS_MANUAL \
 *     --title "PCX 2024 Owner's Manual" \
 *     --url "https://..../pcx-2024.pdf"
 *
 * Or process a JSON manifest (array of the same fields) via --manifest <path>.
 *
 * Writes with sourceDomain = parsed hostname, sha256 integrity hash, and
 * stores the file in MinIO under vehicle-model-documents/. Idempotent —
 * re-running with the same URL against the same model is a no-op.
 */

import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.resolve(__dirname, "../.env") });

import { PrismaClient } from "@prisma/client";
import { createHash } from "crypto";
import { uploadFile } from "../src/lib/storage";

const prisma = new PrismaClient();

type DocType =
  | "OWNERS_MANUAL"
  | "SERVICE_SCHEDULE"
  | "PARTS_CATALOGUE"
  | "WIRING_DIAGRAM"
  | "BROCHURE";

type Entry = {
  make: string;
  model: string;
  year: number;
  type: DocType;
  title: string;
  url: string;
  /** override — if omitted, uses parsed hostname */
  sourceDomain?: string;
};

async function download(url: string): Promise<Buffer> {
  const origin = new URL(url).origin;
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,application/pdf,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "gzip, deflate, br",
      Referer: origin + "/",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "same-origin",
      "Upgrade-Insecure-Requests": "1",
    },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!looksLikePdf(buf)) throw new Error("Response is not a PDF (wrong magic bytes)");
  return buf;
}

function looksLikePdf(buf: Buffer): boolean {
  // `%PDF-` at the start, allowing a small BOM/whitespace prefix.
  const head = buf.subarray(0, 8).toString("latin1");
  return head.includes("%PDF-");
}

async function attachOne(e: Entry): Promise<{ ok: boolean; reason: string }> {
  const modelRow = await prisma.vehicleModel.findUnique({
    where: { make_model_year: { make: e.make, model: e.model, year: e.year } },
    select: { id: true },
  });
  if (!modelRow) return { ok: false, reason: `no catalogue row for ${e.make} ${e.model} ${e.year}` };

  let buf: Buffer;
  try {
    buf = await download(e.url);
  } catch (err) {
    return { ok: false, reason: `download: ${err instanceof Error ? err.message : String(err)}` };
  }

  const sha256 = createHash("sha256").update(buf).digest("hex");

  const existing = await prisma.vehicleModelDocument.findUnique({
    where: { modelId_type_sha256: { modelId: modelRow.id, type: e.type, sha256 } },
  });
  if (existing) return { ok: true, reason: "already attached (sha256 match)" };

  const filename = `${slug(e.make)}-${slug(e.model)}-${e.year}-${e.type.toLowerCase()}.pdf`;
  const uploaded = await uploadFile({
    folder: "vehicle-model-documents",
    filename,
    contentType: "application/pdf",
    body: buf,
  });

  const host = e.sourceDomain ?? new URL(e.url).hostname.toLowerCase();

  await prisma.vehicleModelDocument.create({
    data: {
      modelId: modelRow.id,
      type: e.type,
      title: e.title,
      fileUrl: uploaded.url,
      storageKey: uploaded.key,
      sourceUrl: e.url,
      sourceDomain: host,
      sizeBytes: buf.byteLength,
      language: "en",
      sha256,
    },
  });

  return { ok: true, reason: `uploaded ${(buf.byteLength / 1024).toFixed(0)} KB from ${host}` };
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function parseArgs(argv: string[]): { manifest?: string; inline?: Entry } {
  const out: { manifest?: string; inline?: Partial<Entry> } = { inline: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a) continue;
    if (a === "--manifest") out.manifest = argv[++i];
    else if (a === "--make") out.inline!.make = argv[++i];
    else if (a === "--model") out.inline!.model = argv[++i];
    else if (a === "--year") out.inline!.year = Number(argv[++i]);
    else if (a === "--type") out.inline!.type = argv[++i] as DocType;
    else if (a === "--title") out.inline!.title = argv[++i];
    else if (a === "--url") out.inline!.url = argv[++i];
    else if (a === "--source-domain") out.inline!.sourceDomain = argv[++i];
  }
  if (out.inline && out.inline.url && out.inline.make) {
    return { inline: out.inline as Entry, manifest: out.manifest };
  }
  return { manifest: out.manifest };
}

async function main() {
  const { manifest, inline } = parseArgs(process.argv.slice(2));

  let entries: Entry[] = [];
  if (manifest) {
    const { readFileSync } = await import("fs");
    entries = JSON.parse(readFileSync(manifest, "utf-8")) as Entry[];
  } else if (inline) {
    entries = [inline];
  } else {
    console.error("Provide either --manifest <file> or --make/--model/--year/--type/--title/--url");
    process.exit(1);
  }

  console.log(`Processing ${entries.length} PDF attachment(s)…\n`);
  let ok = 0;
  let fail = 0;
  for (const e of entries) {
    const tag = `${e.make} ${e.model} ${e.year} [${e.type}]`;
    try {
      const r = await attachOne(e);
      if (r.ok) {
        ok++;
        console.log(`✓ ${tag} — ${r.reason}`);
      } else {
        fail++;
        console.log(`! ${tag} — ${r.reason}`);
      }
    } catch (err) {
      fail++;
      console.log(`! ${tag} — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`\nDone. ok=${ok} failed=${fail}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
