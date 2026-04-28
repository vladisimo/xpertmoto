import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import type { AuditCategory } from "@prisma/client";
import { getQueue, registerWorker } from "./queue";

const QUEUE = "audit-retention" as const;

type RetentionConfig = {
  enabled: boolean;
  retention: Partial<Record<AuditCategory, number>>;
};

const DEFAULT_CONFIG: RetentionConfig = {
  enabled: false,
  retention: {
    PAGE_VIEW: 30,
    QUERY: 30,
    MUTATION: 730,
    AUTH: 365,
    JOB: 90,
    API: 365,
    WEBHOOK: 365,
  },
};

async function loadConfig(): Promise<RetentionConfig> {
  const row = await prisma.systemSetting.findUnique({ where: { key: "audit.retention" } });
  if (!row) return DEFAULT_CONFIG;
  const v = row.value as unknown;
  if (typeof v !== "object" || v === null) return DEFAULT_CONFIG;
  const cfg = v as Partial<RetentionConfig>;
  return {
    enabled: Boolean(cfg.enabled),
    retention: { ...DEFAULT_CONFIG.retention, ...(cfg.retention ?? {}) },
  };
}

/**
 * Daily: delete AuditLog rows older than the per-category retention window.
 * Reads config from the `audit.retention` SystemSetting; no-ops when
 * `enabled: false` so retention can be rolled out cautiously post-launch.
 */
export async function runAuditRetention(): Promise<{ deleted: Record<string, number> }> {
  const cfg = await loadConfig();
  if (!cfg.enabled) {
    logger.info("audit-retention: disabled via SystemSetting, skipping");
    return { deleted: {} };
  }
  const deleted: Record<string, number> = {};
  for (const [category, days] of Object.entries(cfg.retention) as [AuditCategory, number][]) {
    if (!days || days <= 0) continue;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const result = await prisma.auditLog.deleteMany({
      where: { category, timestamp: { lt: cutoff } },
    });
    deleted[category] = result.count;
  }
  logger.info({ deleted }, "audit-retention: completed");
  return { deleted };
}

export function startAuditRetentionScheduler() {
  registerWorker(QUEUE, async () => runAuditRetention());
  const q = getQueue(QUEUE);
  if (!q) return;
  q.add(
    "daily",
    {},
    {
      repeat: { pattern: "0 3 * * *", tz: "Australia/Brisbane" },
      jobId: "audit-retention-daily",
    },
  );
}
