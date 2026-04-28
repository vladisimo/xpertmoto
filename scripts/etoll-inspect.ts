import * as XLSX from "xlsx";
import * as fs from "fs";
import * as path from "path";

const file = process.argv[2];
if (!file) {
  console.error("usage: tsx scripts/etoll-inspect.ts <file.xlsx>");
  process.exit(1);
}
const wb = XLSX.readFile(file);
console.log("Sheets:", wb.SheetNames);
for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name];
  if (!ws) continue;
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false });
  console.log(`\n=== ${name} (${rows.length} rows) ===`);
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    console.log(i, JSON.stringify(rows[i]));
  }
  // Also dump as CSV for parser planning
  const csv = XLSX.utils.sheet_to_csv(ws);
  const out = path.join(path.dirname(file), `${path.basename(file, ".xlsx")}-${name}.csv`);
  fs.writeFileSync(out, csv);
  console.log(`\n  csv → ${out}`);
}
