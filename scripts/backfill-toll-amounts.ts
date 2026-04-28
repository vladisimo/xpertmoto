/**
 * One-shot backfill: strip the old admin-fee component from existing TOLL
 * Infringement rows and rewrite notes to the new format.
 *
 * Old amount:  tollAud + adminFeeAud
 * Old notes:   "Toll: <concession> (<gantry>). Toll $X.XX + admin fee $Y.YY. Source: <raw>"
 * New amount:  tollAud
 * New notes:   "Toll: <concession> (<gantry>). Source: <raw>"
 */
import { Prisma, PrismaClient } from "@prisma/client";

const p = new PrismaClient();

const OLD_NOTES_RE =
  /^Toll:\s*(.+?)\s*\(([^)]+)\)\.\s*Toll\s*\$([\d.]+)\s*\+\s*admin fee\s*\$[\d.]+\.\s*Source:\s*(.*)$/;

async function main() {
  const rows = await p.infringement.findMany({
    where: { type: "TOLL" },
    select: { id: true, amount: true, notes: true },
  });

  let updated = 0;
  let skipped = 0;

  for (const r of rows) {
    const m = r.notes?.match(OLD_NOTES_RE);
    if (!m) {
      skipped++;
      continue;
    }
    const [, concession, gantry, tollStr, source] = m;
    const toll = new Prisma.Decimal(tollStr!);
    const newNotes = `Toll: ${concession} (${gantry}). Source: ${source}`;

    if (r.amount.equals(toll) && r.notes === newNotes) {
      skipped++;
      continue;
    }

    await p.infringement.update({
      where: { id: r.id },
      data: { amount: toll, notes: newNotes },
    });
    updated++;
  }

  console.log(`Updated ${updated}, skipped ${skipped} (of ${rows.length} TOLL rows)`);
}

main().finally(() => p.$disconnect());
