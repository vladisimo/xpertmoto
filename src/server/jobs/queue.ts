import { Queue, QueueEvents, Worker, type Processor } from "bullmq";
import type { Redis } from "ioredis";
import * as Sentry from "@sentry/nextjs";
import { getRedis } from "@/lib/redis";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/server/services/audit";

/**
 * Centralised BullMQ registry. A single Redis connection backs every queue
 * so the worker process keeps its connection footprint small. All queues
 * are opt-in — if REDIS_URL isn't set the helpers return null and callers
 * no-op, which keeps tests and local dev frictionless.
 */

const queues = new Map<string, Queue>();
const workers = new Map<string, Worker>();
const queueEvents = new Map<string, QueueEvents>();

export type QueueName =
  | "booking-reminder"
  | "overdue-check"
  | "bond-auto-release"
  | "maintenance-alert"
  | "depreciation-calc"
  | "ops-summary"
  | "revenue-summary"
  | "rego-sync"
  | "xero-sync"
  | "linkt-sync"
  | "audit-retention"
  | "pending-payment-ttl"
  | "support-notify"
  | "licence-expiry"
  | "campaign-dispatcher"
  | "debt-reminder"
  | "visitor-session-cleanup"
  | "revenue-reconcile"
  | "rewards-recompute"
  | "staff-task-auto-abandon"
  | "cart-recovery"
  | "pre-pickup-upsell"
  | "post-trip-review"
  | "telemetry-processor"
  | "price-recommender"
  | "subscription-billing"
  | "capture-pending-payments"
  | "capture-retry"
  | "stripe-reconcile"
  | "dunning-ladder"
  | "invoice-generate"
  | "no-show-detector"
  | "no-show-reminder"
  | "etoll-health"
  | "integration-secret-audit"
  | "booking-billing"
  | "insights-refresh"
  | "enrich-vehicle-model"
  | "bond-auth-expiry-check"
  | "stuck-webhook-recovery"
  | "card-expiry-check"
  | "db-backup"
  | "db-backup-retention"
  | "analytics-alert"
  | "analytics-weekly-digest"
  | "swap-draft-cleanup"
  | "platform-sentry-stats";

export function getConnection(): Redis | null {
  return getRedis();
}

export function getQueue(name: QueueName): Queue | null {
  if (queues.has(name)) return queues.get(name)!;
  const redis = getRedis();
  if (!redis) return null;
  const q = new Queue(name, { connection: redis });
  queues.set(name, q);
  return q;
}

export function registerWorker<T = unknown>(
  name: QueueName,
  processor: Processor<T>,
  opts?: { concurrency?: number },
): Worker | null {
  if (workers.has(name)) return workers.get(name)!;
  const redis = getRedis();
  if (!redis) return null;

  const wrapped: Processor<T> = async (job, token) => {
    const start = Date.now();
    await writeAudit(prisma, {
      category: "JOB",
      action: `${name}.start`,
      entity: "Job",
      entityId: String(job.id ?? job.name),
      method: "JOB",
      path: name,
      status: "SUCCESS",
      newData: { jobName: job.name, data: job.data },
    });
    try {
      const result = await processor(job, token);
      await writeAudit(prisma, {
        category: "JOB",
        action: `${name}.complete`,
        entity: "Job",
        entityId: String(job.id ?? job.name),
        method: "JOB",
        path: name,
        status: "SUCCESS",
        durationMs: Date.now() - start,
      });
      return result;
    } catch (err) {
      const e = err as Error;
      await writeAudit(prisma, {
        category: "JOB",
        action: `${name}.failed`,
        entity: "Job",
        entityId: String(job.id ?? job.name),
        method: "JOB",
        path: name,
        status: "FAILURE",
        durationMs: Date.now() - start,
        errorCode: e.name,
        newData: { message: e.message },
      });
      throw err;
    }
  };

  const worker = new Worker<T>(name, wrapped, {
    connection: redis,
    concurrency: opts?.concurrency ?? 1,
  });
  const qLog = logger.child({ queue: name });
  worker.on("completed", (job) => {
    qLog.info({ jobId: job.id }, "job completed");
  });
  worker.on("failed", (job, err) => {
    qLog.error({ jobId: job?.id, err: err.message }, "job failed");
    Sentry.captureException(err, {
      tags: { queue: name, jobId: job?.id },
      extra: { jobData: job?.data },
    });
  });
  workers.set(name, worker);

  if (!queueEvents.has(name)) {
    queueEvents.set(name, new QueueEvents(name, { connection: redis }));
  }
  return worker;
}

export async function shutdownQueues(): Promise<void> {
  await Promise.all([...workers.values()].map((w) => w.close()));
  await Promise.all([...queues.values()].map((q) => q.close()));
  await Promise.all([...queueEvents.values()].map((e) => e.close()));
  workers.clear();
  queues.clear();
  queueEvents.clear();
}
