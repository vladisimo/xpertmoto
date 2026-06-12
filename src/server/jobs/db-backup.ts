import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { uploadFile } from "@/lib/storage";
import { getSetting, SETTING_DEFAULTS } from "@/lib/settings";
import { getQueue, monitorCron, registerWorker } from "./queue";

const QUEUE = "db-backup" as const;
const RETENTION_QUEUE = "db-backup-retention" as const;

type TriggerKind = "SCHEDULED" | "MANUAL_ADMIN";

/**
 * Run a single pg_dump against the live database, upload the resulting
 * custom-format dump to S3 (or MinIO locally) via our storage helper, and
 * record a DatabaseBackup row with metadata.
 *
 * The dump streams through Node so we never materialise the full file on
 * local disk — relevant for large DBs where /tmp could fill up.
 *
 * Returns the created backup row's id so the admin "Trigger manual
 * backup" action can poll.
 */
export async function runDbBackup(args?: {
  triggeredBy?: TriggerKind;
  triggeredById?: string;
}): Promise<{ id: string; status: "SUCCESS" | "FAILED" }> {
  const trigger: TriggerKind = args?.triggeredBy ?? "SCHEDULED";
  const retentionDays = await getSetting(
    "backup.retentionDays",
    SETTING_DEFAULTS["backup.retentionDays"] ?? 30,
  );

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    logger.warn("db-backup: DATABASE_URL not set, skipping");
    return { id: "", status: "FAILED" };
  }

  const started = await prisma.databaseBackup.create({
    data: {
      status: "RUNNING",
      triggeredBy: trigger,
      triggeredById: args?.triggeredById ?? null,
      retentionUntil: new Date(Date.now() + retentionDays * 86_400_000),
    },
    select: { id: true },
  });

  try {
    const filename = `backup-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}.pgdump`;
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    await new Promise<void>((resolve, reject) => {
      // --format=custom → binary, compressible-by-default; --compress=9
      // for maximum compression; --no-owner --no-privileges so a restore
      // into a fresh DB doesn't hit missing-role errors.
      const proc = spawn(
        "pg_dump",
        [
          "--format=custom",
          "--compress=9",
          "--no-owner",
          "--no-privileges",
          dbUrl,
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      proc.stdout.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
        totalBytes += chunk.byteLength;
      });
      let stderr = "";
      proc.stderr.on("data", (chunk) => {
        stderr += chunk.toString("utf8");
      });
      proc.on("error", (err) => reject(err));
      proc.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`pg_dump exited ${code}: ${stderr.slice(0, 500)}`));
      });
    });

    const dump = Buffer.concat(chunks);
    const upload = await uploadFile({
      folder: "backups",
      filename,
      contentType: "application/octet-stream",
      body: dump,
    });

    // Fetch the latest applied migration name so operators can see
    // which schema version this dump reflects.
    const lastMigration = await prisma.$queryRaw<Array<{ migration_name: string }>>`
      SELECT migration_name FROM "_prisma_migrations"
       ORDER BY finished_at DESC NULLS LAST LIMIT 1`;

    await prisma.databaseBackup.update({
      where: { id: started.id },
      data: {
        status: "SUCCESS",
        completedAt: new Date(),
        sizeBytes: BigInt(totalBytes),
        storageUrl: upload.url,
        schemaVersion: lastMigration[0]?.migration_name ?? null,
      },
    });
    logger.info({ id: started.id, sizeBytes: totalBytes }, "db-backup: success");
    return { id: started.id, status: "SUCCESS" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.databaseBackup.update({
      where: { id: started.id },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        errorMessage: message.slice(0, 1000),
      },
    });
    logger.error({ err: message, id: started.id }, "db-backup: failed");
    return { id: started.id, status: "FAILED" };
  }
}

/**
 * Delete DatabaseBackup rows whose retentionUntil has passed. Storage
 * objects are left to S3 lifecycle policy (we don't delete them from
 * here — that would require knowing the bucket + tracking the key).
 */
export async function runDbBackupRetention(): Promise<number> {
  const { count } = await prisma.databaseBackup.deleteMany({
    where: { retentionUntil: { lt: new Date() } },
  });
  logger.info({ deleted: count }, "db-backup-retention: swept");
  return count;
}

export function startDbBackupScheduler() {
  registerWorker(QUEUE, async (job) => {
    const data = (job.data as { triggeredBy?: TriggerKind; triggeredById?: string } | null) ?? {};
    return runDbBackup(data);
  });
  registerWorker(RETENTION_QUEUE, async () => runDbBackupRetention());

  const q = getQueue(QUEUE);
  if (q) {
    // Scheduling note: the retention sweep below is pinned to 03:15 Brisbane
    // on the assumption the backup ran at the 03:00 default. If you override
    // BACKUP_CRON to a later slot, retention prunes BEFORE that night's dump
    // lands — never data-loss (it keeps the newest N days by mtime), but the
    // oldest retained backup is one night shorter than configured until the
    // next sweep. Move both together if the window matters. Shares the 03:00
    // hour with platform-sentry-stats (03:45) — pg_dump I/O is the heavy one,
    // keep other disk-heavy jobs out of this slot.
    const schedule = process.env.BACKUP_CRON ?? "0 3 * * *";
    monitorCron(QUEUE, schedule);
    q.add(
      "nightly",
      { triggeredBy: "SCHEDULED" },
      { repeat: { pattern: schedule, tz: "Australia/Brisbane" }, jobId: "repeat-nightly" },
    );
  }
  const rq = getQueue(RETENTION_QUEUE);
  if (rq) {
    monitorCron(RETENTION_QUEUE, "15 3 * * *");
    rq.add(
      "retention-daily",
      {},
      { repeat: { pattern: "15 3 * * *", tz: "Australia/Brisbane" }, jobId: "repeat-retention" },
    );
  }
}
