/**
 * One-shot: normalise customer name capitalisation.
 *
 * Rules:
 *  - Per field, split on whitespace & hyphens, title-case each token.
 *  - Preserve Mc/Mac prefix (McDonald, MacAndrew stay correctly cased).
 *  - Particles (de, van, der, von, la, le, du, da) stay lowercase unless
 *    they are the first token of the field.
 *  - Single-letter initials uppercase.
 *  - Apostrophes are not rewritten (OGrady stays OGrady — data-entry issue,
 *    not casing).
 *  - If firstName is / starts with an honorific (MR MRS MS MISS DR PROF
 *    MX SIR, optional trailing dot), strip it; first remaining word
 *    becomes firstName, the rest joins into lastName.
 *
 * Dry-run by default; pass --apply to commit inside a transaction.
 * Writes a before/after CSV to tmp/name-normalisation-<timestamp>.csv.
 */
import { PrismaClient } from "@prisma/client";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const p = new PrismaClient();

const HONORIFICS = new Set([
  "MR",
  "MRS",
  "MS",
  "MISS",
  "DR",
  "PROF",
  "MX",
  "SIR",
]);
const PARTICLES = new Set([
  "de",
  "van",
  "der",
  "von",
  "la",
  "le",
  "du",
  "da",
]);

function titleCaseToken(raw: string, isFirst: boolean): string {
  if (raw.length === 0) return raw;
  const lower = raw.toLowerCase();

  // Particle mid-name stays lowercase.
  if (!isFirst && PARTICLES.has(lower)) return lower;

  // Single-letter initial (with optional trailing dot) → uppercase.
  if (/^[a-z]\.?$/.test(lower)) return lower.toUpperCase();

  // Mc prefix: Mc + capital + rest.
  if (/^mc[a-z]+$/.test(lower)) {
    return "Mc" + lower.charAt(2).toUpperCase() + lower.slice(3);
  }
  // Mac prefix: require 3+ letters after "Mac" so we don't mangle "Mack".
  if (/^mac[a-z]{3,}$/.test(lower)) {
    return "Mac" + lower.charAt(3).toUpperCase() + lower.slice(4);
  }

  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function titleCaseField(field: string): string {
  // Split on whitespace but preserve hyphens inside tokens so we can
  // title-case each hyphen-separated sub-part.
  const tokens = field.trim().split(/\s+/).filter(Boolean);
  const titled = tokens.map((tok, idx) => {
    if (!tok.includes("-")) return titleCaseToken(tok, idx === 0);
    // Each sub-part of a hyphenated token is treated as a leading token
    // (Smith-Jones → Smith-Jones, not Smith-jones).
    return tok
      .split("-")
      .map((sub) => titleCaseToken(sub, true))
      .join("-");
  });
  return titled.join(" ");
}

type Normalised = { firstName: string; lastName: string };

function normalise(firstName: string, lastName: string): Normalised {
  const combinedTokens = `${firstName.trim()} ${lastName.trim()}`
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  // Honorific detection on the combined leading tokens.
  const leading = combinedTokens[0]?.replace(/\.$/, "").toUpperCase() ?? "";
  if (HONORIFICS.has(leading)) {
    const rest = combinedTokens.slice(1);
    const newFirst = rest[0] ?? "";
    const newLast = rest.slice(1).join(" ");
    return {
      firstName: titleCaseField(newFirst),
      lastName: titleCaseField(newLast),
    };
  }

  return {
    firstName: titleCaseField(firstName),
    lastName: titleCaseField(lastName),
  };
}

function csvEscape(v: string): string {
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

async function main() {
  const apply = process.argv.includes("--apply");

  const customers = await p.user.findMany({
    where: { role: "CUSTOMER" },
    select: { id: true, firstName: true, lastName: true },
    orderBy: { id: "asc" },
  });

  const changes: Array<{
    id: string;
    oldFirst: string;
    oldLast: string;
    newFirst: string;
    newLast: string;
  }> = [];

  for (const c of customers) {
    const n = normalise(c.firstName, c.lastName);
    if (n.firstName !== c.firstName || n.lastName !== c.lastName) {
      changes.push({
        id: c.id,
        oldFirst: c.firstName,
        oldLast: c.lastName,
        newFirst: n.firstName,
        newLast: n.lastName,
      });
    }
  }

  const tmpDir = join(process.cwd(), "tmp");
  mkdirSync(tmpDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const csvPath = join(tmpDir, `name-normalisation-${stamp}.csv`);
  const rows = [
    "id,oldFirstName,oldLastName,newFirstName,newLastName",
    ...changes.map((c) =>
      [c.id, c.oldFirst, c.oldLast, c.newFirst, c.newLast]
        .map(csvEscape)
        .join(","),
    ),
  ];
  writeFileSync(csvPath, rows.join("\n") + "\n", "utf8");

  console.log(`Scanned ${customers.length} customers.`);
  console.log(`Would update ${changes.length} rows.`);
  console.log(`Diff written to ${csvPath}`);

  const sample = changes.slice(0, 20);
  if (sample.length) {
    console.log("\nSample (first 20):");
    for (const c of sample) {
      console.log(
        `  ${c.id}  "${c.oldFirst}" / "${c.oldLast}"  →  "${c.newFirst}" / "${c.newLast}"`,
      );
    }
  }

  if (!apply) {
    console.log("\nDry-run only. Re-run with --apply to commit.");
    return;
  }

  if (changes.length === 0) {
    console.log("\nNothing to apply.");
    return;
  }

  console.log("\nApplying...");
  await p.$transaction(
    async (tx) => {
      for (const c of changes) {
        await tx.user.update({
          where: { id: c.id },
          data: { firstName: c.newFirst, lastName: c.newLast },
        });
      }
    },
    { timeout: 60_000 },
  );
  console.log(`Updated ${changes.length} rows.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => p.$disconnect());
