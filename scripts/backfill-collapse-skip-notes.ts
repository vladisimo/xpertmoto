/**
 * One-shot backfill: collapse the runaway "capture-pending: skipped — no
 * stored PM" lines that the capture-pending-payments job appended to
 * `Payment.notes` on every 5-minute tick before refreshSkipNote() landed.
 *
 * Any PENDING charge with no usable stored PM kept matching the capture
 * scan, so its notes grew by one skip line every 5 minutes indefinitely
 * (hundreds of lines — the unreadable Charges blob). This rewrites each
 * affected row to keep exactly one skip line (the most recent timestamp),
 * preserving any non-skip lines (captured / requires_action / failed).
 *
 * Idempotent — a row with <= 1 skip line is left untouched.
 *
 * Usage:
 *   npx tsx scripts/backfill-collapse-skip-notes.ts          # dry-run
 *   npx tsx scripts/backfill-collapse-skip-notes.ts --apply  # actually write
 */
import { PrismaClient } from "@prisma/client";
import { NO_PM_SKIP_MARKER } from "@/server/jobs/capture-pending-payments";

const prisma = new PrismaClient();

/** Keep only the last skip line; leave all other lines in place. */
function collapse(notes: string): string {
  const lines = notes.split("\n");
  const skipIdxs = lines.flatMap((l, i) => (l.includes(NO_PM_SKIP_MARKER) ? [i] : []));
  if (skipIdxs.length <= 1) return notes;
  const lastSkip = skipIdxs[skipIdxs.length - 1];
  return lines.filter((l, i) => !l.includes(NO_PM_SKIP_MARKER) || i === lastSkip).join("\n");
}

async function main() {
  const apply = process.argv.slice(2).includes("--apply");

  const rows = await prisma.payment.findMany({
    where: { notes: { contains: NO_PM_SKIP_MARKER } },
    select: { id: true, reference: true, notes: true },
  });

  let changed = 0;
  let linesRemoved = 0;
  for (const row of rows) {
    if (!row.notes) continue;
    const next = collapse(row.notes);
    if (next === row.notes) continue;
    changed += 1;
    linesRemoved += row.notes.split("\n").length - next.split("\n").length;
    console.log(
      `${row.reference} (${row.id}): ${row.notes.split("\n").length} → ${next.split("\n").length} lines`,
    );
    if (apply) {
      await prisma.payment.update({ where: { id: row.id }, data: { notes: next } });
    }
  }

  console.log(
    `\n${apply ? "Updated" : "Would update"} ${changed} of ${rows.length} matching rows ` +
      `(${linesRemoved} skip lines removed).${apply ? "" : " Re-run with --apply to write."}`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
