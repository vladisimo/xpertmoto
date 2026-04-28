import { prisma } from "@/lib/prisma";
import { runEnrichment, type EnrichmentSummary } from "@/server/services/vehicle-enrichment";
import { getQueue, registerWorker } from "./queue";

const QUEUE = "enrich-vehicle-model" as const;

type JobData = { modelId: string };

/**
 * Enqueue a single-model enrichment run. Returns null when Redis isn't
 * configured (dev without docker) — callers can fall back to running
 * synchronously in that case.
 */
export async function enqueueEnrichVehicleModel(modelId: string): Promise<string | null> {
  const q = getQueue(QUEUE);
  if (!q) return null;
  const job = await q.add(
    "enrich",
    { modelId },
    { jobId: `enrich-${modelId}-${Date.now()}`, removeOnComplete: 100, removeOnFail: 100 },
  );
  return job.id ?? null;
}

export async function runEnrichVehicleModelJob(data: JobData): Promise<EnrichmentSummary> {
  return runEnrichment(prisma, data.modelId);
}

export function startEnrichVehicleModelWorker(): void {
  registerWorker<JobData>(
    QUEUE,
    async (job) => runEnrichVehicleModelJob(job.data),
    { concurrency: 2 },
  );
}
