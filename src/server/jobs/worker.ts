#!/usr/bin/env tsx
/**
 * XPERT Moto background worker entrypoint.
 *
 * Boots a single Node process that holds a BullMQ Worker for every queue
 * in the system, plus registers the repeatable schedules from CLAUDE.md:
 *
 *   - booking-reminder   · daily 07:00  (24h-before-pickup notifications)
 *   - overdue-check      · every 15min  (flip late bookings → OVERDUE)
 *   - bond-auto-release  · daily 02:00  (release holds >14 days post-return)
 *   - maintenance-alert  · daily 06:00  (rego/CTP/insurance/service expiry)
 *   - depreciation-calc  · monthly 01:00 1st (update currentBookValue)
 *   - ops-summary        · daily 07:00  (manager depot recap)
 *   - revenue-summary    · Monday 08:00 (admin weekly revenue)
 *
 * Run with `npm run worker`. No-ops when REDIS_URL is not set.
 */

import { createServer, type Server } from "node:http";

import * as Sentry from "@sentry/nextjs";
import { getRedis } from "@/lib/redis";
import { prisma } from "@/lib/prisma";
import { scrubSentryEvent } from "@/lib/observability/sentry-scrub";
import { logger } from "@/lib/logger";
import { registeredWorkerCount, shutdownQueues } from "./queue";

const log = logger.child({ component: "worker" });
import { startBookingReminderScheduler } from "./booking-reminder";
import { startOverdueCheckScheduler } from "./overdue-check";
import { startBondAutoReleaseScheduler } from "./bond-auto-release";
import { startSwapDraftCleanupScheduler } from "./swap-draft-cleanup";
import { startMaintenanceAlertScheduler } from "./maintenance-alert";
import { startDepreciationScheduler } from "./depreciation-calc";
import { startOpsSummaryScheduler } from "./ops-summary";
import { startEtollScheduler } from "./etoll-sync";
import { startRegoSyncScheduler } from "./rego-sync";
import { startXeroSyncScheduler } from "./xero-sync";
import { startLinktSyncScheduler } from "./linkt-sync";
import { startAuditRetentionScheduler } from "./audit-retention";
import { startPendingPaymentTtlScheduler } from "./pending-payment-ttl";
import { startSupportNotifyWorker } from "./support-notify";
import { startLicenceExpiryScheduler } from "./licence-expiry";
import { startCampaignDispatcherScheduler } from "./campaign-dispatcher";
import { startDebtReminderScheduler } from "./debt-reminder";
import { startVisitorSessionCleanupScheduler } from "./visitor-session-cleanup";
import { startAnalyticsAlertScheduler } from "@/server/services/analytics-alert";
import { startAnalyticsDigestScheduler } from "@/server/services/analytics-digest";
import { startRevenueReconcileScheduler } from "./revenue-reconcile";
import { startRewardsRecomputeScheduler } from "./rewards-recompute";
import { startStaffTaskAutoAbandonScheduler } from "./staff-task-auto-abandon";
import { startCartRecoveryScheduler } from "./cart-recovery";
import { startPrePickupUpsellScheduler } from "./pre-pickup-upsell";
import { startPostTripReviewScheduler } from "./post-trip-review";
import { startTelemetryProcessorScheduler } from "./telemetry-processor";
import { startPriceRecommenderScheduler } from "./price-recommender";
import { startSubscriptionBillingScheduler } from "./subscription-billing";
import { startCapturePendingPaymentsScheduler } from "./capture-pending-payments";
import { startCaptureRetryWorker } from "./capture-retry";
import { startStripeReconcileScheduler } from "./stripe-reconcile";
import { startDunningLadderScheduler } from "./dunning-ladder";
import { startInvoiceGenerateScheduler } from "./invoice-generate";
import { startNoShowDetectorScheduler } from "./no-show-detector";
import { startNoShowReminderScheduler } from "./no-show-reminder";
import { startEtollHealthScheduler } from "./etoll-health";
import { startBookingBillingScheduler } from "./booking-billing";
import { startInsightsRefreshScheduler } from "./insights-refresh";
import { startEnrichVehicleModelWorker } from "./enrich-vehicle-model";
import { startBondAuthExpiryCheckScheduler } from "./bond-auth-expiry-check";
import { startStuckWebhookRecoveryScheduler } from "./stuck-webhook-recovery";
import { startCardExpiryCheckScheduler } from "./card-expiry-check";
import { startDbBackupScheduler } from "./db-backup";
import { startPlatformSentryStatsScheduler } from "./platform-sentry-stats";

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV,
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
    enabled: process.env.NODE_ENV !== "test",
    serverName: "xpertmoto-worker",
    beforeSend: scrubSentryEvent,
  });
}

/**
 * Process-level heartbeat. The per-queue cron check-ins only fire while a
 * job is running — a worker that crashed *between* jobs (or booted with
 * zero queues) emits nothing and Sentry's job monitors stay green until
 * their next scheduled slot, hours away for the dailies. This check-in
 * fires every 30 minutes regardless, so "worker process is gone" alerts
 * within the check-in margin instead of at the next missed daily.
 */
const HEARTBEAT_INTERVAL_MS = 30 * 60 * 1000;
function emitWorkerHeartbeat() {
  if (!process.env.SENTRY_DSN) return;
  const checkInId = Sentry.captureCheckIn(
    { monitorSlug: "worker-heartbeat", status: "in_progress" },
    {
      schedule: { type: "crontab", value: "*/30 * * * *" },
      timezone: "Etc/UTC",
      checkinMargin: 10,
      maxRuntime: 5,
    },
  );
  Sentry.captureCheckIn({ checkInId, monitorSlug: "worker-heartbeat", status: "ok" });
}

/**
 * Liveness endpoint for the container HEALTHCHECK. 200 only when Redis
 * answers PING and at least one Worker is registered — a worker that lost
 * Redis or idles with zero queues is dead weight and should be restarted
 * by the orchestrator.
 */
function startHealthServer(): Server {
  const port = Number(process.env.WORKER_HEALTH_PORT ?? 8786);
  const server = createServer((req, res) => {
    if (req.url !== "/health") {
      res.writeHead(404).end();
      return;
    }
    void (async () => {
      let redisOk = false;
      try {
        const redis = getRedis();
        redisOk = !!redis && (await redis.ping()) === "PONG";
      } catch {
        redisOk = false;
      }
      const workers = registeredWorkerCount();
      const ok = redisOk && workers > 0;
      res.writeHead(ok ? 200 : 503, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok, workers, redis: redisOk ? "ok" : "down" }));
    })();
  });
  server.on("error", (err) => {
    // A second worker on the same host (or a port clash) shouldn't kill
    // job processing — health reporting degrades, the worker keeps going.
    log.warn({ err: err.message, port }, "worker health endpoint unavailable");
  });
  server.listen(port, () => log.info({ port }, "worker health endpoint listening"));
  return server;
}

async function main() {
  log.info("starting XPERT Moto background worker…");
  const redis = getRedis();
  if (!redis) {
    log.warn("REDIS_URL not set — nothing to run. Exiting.");
    process.exit(0);
  }

  startBookingReminderScheduler();
  startOverdueCheckScheduler();
  startBondAutoReleaseScheduler();
  startSwapDraftCleanupScheduler();
  startMaintenanceAlertScheduler();
  startDepreciationScheduler();
  startOpsSummaryScheduler();
  await startEtollScheduler();
  startRegoSyncScheduler();
  startXeroSyncScheduler();
  await startLinktSyncScheduler();
  startAuditRetentionScheduler();
  startPendingPaymentTtlScheduler();
  startSupportNotifyWorker();
  startLicenceExpiryScheduler();
  startCampaignDispatcherScheduler();
  startDebtReminderScheduler();
  startVisitorSessionCleanupScheduler();
  startAnalyticsAlertScheduler();
  startAnalyticsDigestScheduler();
  startRevenueReconcileScheduler();
  startRewardsRecomputeScheduler();
  startStaffTaskAutoAbandonScheduler();
  // Revenue-lever schedulers
  startCartRecoveryScheduler();
  startPrePickupUpsellScheduler();
  startPostTripReviewScheduler();
  startTelemetryProcessorScheduler();
  startPriceRecommenderScheduler();
  startSubscriptionBillingScheduler();
  // G5 — every 5 min, capture PENDING ancillary Payment rows off-session
  startCapturePendingPaymentsScheduler();
  // G8 — exponential-backoff retries for transient Stripe failures
  startCaptureRetryWorker();
  // G3 — nightly Stripe reconciliation
  startStripeReconcileScheduler();
  // G7 — dunning ladder (superset of the single-shot debt reminder)
  startDunningLadderScheduler();
  // G17 — weekly invoice generation for aggregated open charges
  startInvoiceGenerateScheduler();
  // G22 — hourly no-show detector (CONFIRMED + past pickup → NO_SHOW)
  startNoShowDetectorScheduler();
  // G22 — pre-cutoff warning, fires inside the last `reminderMin` of the
  // grace window so the customer gets a final EMAIL+SMS before forfeit.
  startNoShowReminderScheduler();
  // G21 — 2-hourly E-Toll scraper health monitor
  startEtollHealthScheduler();
  // Phase A2 — hourly sweep that fires recurring charges on long-term
  // hires (weekly/fortnightly/monthly); hands off to capture-pending-payments.
  startBookingBillingScheduler();
  // AI Insights — daily regeneration of the manager-facing insights panel.
  startInsightsRefreshScheduler();
  // Fleet spec + document enrichment. Admin-triggered only; no cron schedule.
  startEnrichVehicleModelWorker();
  // Daily sweep for bonds close to card-network auth expiry.
  startBondAuthExpiryCheckScheduler();
  // 5-minutely recovery for webhook events stuck in PROCESSING.
  startStuckWebhookRecoveryScheduler();
  // Daily card-expiry check for customers with active long-term rentals.
  startCardExpiryCheckScheduler();
  // Daily Postgres pg_dump backup (03:00 AEST by default).
  startDbBackupScheduler();
  // Platform cost tab — daily Sentry quota pull (03:45 AEST).
  startPlatformSentryStatsScheduler();

  // The start* calls above all no-op individually when their getQueue()/
  // registerWorker() returns null — a worker that "booted" with zero
  // queues would sit here looking healthy while processing nothing.
  // Refuse to idle: exit non-zero so the orchestrator restarts us into a
  // (hopefully) healthier environment.
  const registered = registeredWorkerCount();
  if (registered === 0) {
    log.fatal("no workers registered — Redis vanished during boot? exiting for restart");
    Sentry.captureMessage("worker booted with zero registered queues", { level: "fatal" });
    await Sentry.flush(2000);
    process.exit(1);
  }
  log.info({ registered }, "all schedulers registered, waiting for jobs…");

  const healthServer = startHealthServer();
  emitWorkerHeartbeat();
  setInterval(emitWorkerHeartbeat, HEARTBEAT_INTERVAL_MS).unref();

  // Bounded drain: if Redis is gone or a job hangs, shutdownQueues() can
  // block past the orchestrator's grace period and earn a SIGKILL with
  // transactions still open. Race it against a timeout, then release the
  // Prisma pool so the next instance doesn't inherit stale connections.
  // 60s (not 15s): a money-path job mid Stripe capture + ledger write needs
  // room to finish — killing it between the two is exactly the torn state
  // the capture transactions exist to avoid. The container stop grace
  // period must exceed this (stop_grace_period 75s in docker-compose).
  const SHUTDOWN_TIMEOUT_MS = 60_000;
  const shutdown = async (signal: string) => {
    log.info({ signal }, "shutting down…");
    await Promise.race([
      shutdownQueues(),
      new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_TIMEOUT_MS)),
    ]);
    healthServer.close();
    await prisma.$disconnect().catch((err: unknown) => {
      log.warn({ err }, "prisma disconnect failed during shutdown");
    });
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

// Job processors run through the queue wrapper's try/catch, but anything that
// escapes it (fire-and-forget promise inside a processor, listener bug) lands
// here. Capture to Sentry so payment-critical jobs never fail silently.
process.on("unhandledRejection", (reason) => {
  log.error({ err: reason }, "unhandled promise rejection in worker");
  Sentry.captureException(reason, { tags: { worker: "unhandledRejection" } });
});
process.on("uncaughtException", (err) => {
  log.fatal({ err }, "uncaught exception in worker");
  Sentry.captureException(err, { tags: { worker: "uncaughtException" } });
  Sentry.flush(2000).finally(() => process.exit(1));
});

main().catch((err) => {
  log.fatal({ err }, "fatal worker error");
  Sentry.captureException(err, { tags: { worker: "main" } });
  Sentry.flush(2000).finally(() => process.exit(1));
});
