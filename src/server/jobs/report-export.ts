/**
 * Report PDF export queue.
 *
 * react-pdf rendering is CPU-bound; running it inside the Next.js request
 * handler stalls the event loop for every concurrent user. The export
 * route enqueues the render here and waits for the result via QueueEvents
 * — the CPU burn happens in the worker process, the web process only does
 * I/O waits, and the browser's direct-download UX is unchanged.
 *
 * Fallback: when Redis is absent, or the worker doesn't answer inside the
 * wait budget (down, backlogged), the caller renders inline — slower for
 * the box but the admin still gets their PDF.
 */

import { logger } from "@/lib/logger";
import {
  renderReportPdfBuffer,
  type ReportRenderArgs,
} from "@/server/services/report-export";
import { getQueue, getQueueEvents, registerWorker } from "./queue";

const QUEUE = "report-export" as const;

/** An admin is sitting on the download — don't wait longer than this for
 *  the worker before the route falls back to an inline render. */
const RENDER_WAIT_MS = 30_000;

/**
 * Render a report PDF on the worker. Returns null when the queue isn't
 * available or the job fails/times out — callers fall back to
 * `renderReportPdfBuffer` inline.
 */
export async function renderReportPdfQueued(
  args: ReportRenderArgs,
): Promise<Buffer | null> {
  const q = getQueue(QUEUE);
  const events = getQueueEvents(QUEUE);
  if (!q || !events) return null;
  try {
    const job = await q.add("render", args, {
      // The request is waiting: a deterministic render error should surface
      // via the inline fallback now, not retry 3× inside the wait budget.
      // Short retention — the base64 result has no value once delivered.
      attempts: 1,
      removeOnComplete: { age: 300, count: 100 },
      removeOnFail: { age: 3600, count: 200 },
    });
    const res = (await job.waitUntilFinished(events, RENDER_WAIT_MS)) as {
      pdfBase64: string;
    };
    return Buffer.from(res.pdfBase64, "base64");
  } catch (err) {
    logger.warn(
      { err, reportId: args.reportId },
      "queued report render failed or timed out; falling back to inline render",
    );
    return null;
  }
}

export function startReportExportWorker(): void {
  registerWorker<ReportRenderArgs>(QUEUE, async (job) => {
    const buf = await renderReportPdfBuffer(job.data);
    // Base64 through the job return value — small (10–500 KB typical),
    // self-cleaning via removeOnComplete, no storage bucket round trip.
    return { pdfBase64: buf.toString("base64") };
  });
}
