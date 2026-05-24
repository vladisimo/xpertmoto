import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { URL } from "node:url";
import "dotenv/config";

const SNAPSHOT = resolve(__dirname, "seed-snapshot.sql");

function parseDbUrl(raw: string) {
  const u = new URL(raw);
  return {
    host: u.hostname,
    port: u.port || "5432",
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ""),
  };
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  if (!existsSync(SNAPSHOT)) {
    throw new Error(
      `Snapshot file not found at ${SNAPSHOT}. Run 'npm run db:snapshot' first.`,
    );
  }

  const { host, port, user, password, database } = parseDbUrl(url);
  console.log(`📦 Restoring snapshot into ${database}@${host}:${port}...`);

  const result = spawnSync(
    "psql",
    [
      "-h", host,
      "-p", port,
      "-U", user,
      "-d", database,
      "-v", "ON_ERROR_STOP=1",
      "--single-transaction",
      "-f", SNAPSHOT,
    ],
    {
      env: { ...process.env, PGPASSWORD: password },
      stdio: ["ignore", "inherit", "inherit"],
    },
  );

  if (result.status !== 0) {
    throw new Error(`psql exited with status ${result.status}`);
  }
  console.log("✅ Snapshot restored");

  // The snapshot predates VehicleModel.isRentable, so restored van rows fall
  // back to the column default (true). Re-flag the known internal/service
  // vehicles so they stay hidden from consumers — mirrors the backfill in the
  // add_vehicle_model_is_rentable migration. Idempotent.
  const flag = spawnSync(
    "psql",
    [
      "-h", host,
      "-p", port,
      "-U", user,
      "-d", database,
      "-v", "ON_ERROR_STOP=1",
      "-c",
      `UPDATE "VehicleModel" SET "isRentable" = false
       WHERE (lower("make"), lower("model")) IN
         (('ford', 'transit connect'), ('renault', 'master'));`,
    ],
    { env: { ...process.env, PGPASSWORD: password }, stdio: ["ignore", "inherit", "inherit"] },
  );
  if (flag.status !== 0) {
    throw new Error(`psql (non-rental flag) exited with status ${flag.status}`);
  }
  console.log("✅ Re-flagged non-rental service vehicles");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
