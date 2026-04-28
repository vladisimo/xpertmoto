import { PrismaClient } from "@prisma/client";

// Queries pg_stat_statements for the N slowest statements by mean execution
// time. Requires `shared_preload_libraries=pg_stat_statements` (set in
// docker-compose) and the extension installed (init script 001_extensions.sql).
//
// Usage: npm run db:slow [limit]

const prisma = new PrismaClient();

async function main() {
  const limit = Number(process.argv[2] ?? 20);

  const available = await prisma.$queryRaw<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements'
    ) AS exists
  `;
  if (!available[0]?.exists) {
    console.error(
      "pg_stat_statements is not installed. Run init script 001_extensions.sql or",
      "`CREATE EXTENSION pg_stat_statements;` as a superuser.",
    );
    process.exit(1);
  }

  const rows = await prisma.$queryRaw<
    {
      query: string;
      calls: bigint;
      total_ms: number;
      mean_ms: number;
      rows: bigint;
    }[]
  >`
    SELECT
      regexp_replace(left(query, 200), '\\s+', ' ', 'g') AS query,
      calls,
      round(total_exec_time::numeric, 2)::float AS total_ms,
      round(mean_exec_time::numeric, 2)::float  AS mean_ms,
      rows
    FROM pg_stat_statements
    WHERE query NOT ILIKE '%pg_stat_statements%'
    ORDER BY mean_exec_time DESC
    LIMIT ${limit}
  `;

  console.log(
    `#  calls   mean(ms)   total(ms)   rows   query`.replace(/ /g, "\u00a0"),
  );
  for (const [i, r] of rows.entries()) {
    console.log(
      `${String(i + 1).padStart(2)}  ${String(r.calls).padStart(5)}  ${r.mean_ms
        .toString()
        .padStart(8)}  ${r.total_ms.toString().padStart(9)}  ${String(r.rows).padStart(5)}  ${r.query}`,
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
