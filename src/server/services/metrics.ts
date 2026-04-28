/**
 * G14 — Lightweight in-process metrics registry.
 *
 * Tiny Prometheus text-format exporter that doesn't require a new
 * dependency. Supports counters (monotonic) and histograms (bucketed) with
 * string labels. If/when prom-client is added to the stack (needs user
 * approval per CLAUDE.md §2), this module's public surface can be swapped
 * to delegate to it without touching callers.
 *
 * Caveats:
 *   - Process-local only. In a multi-worker deployment each instance
 *     exposes its own counters; the scraper must handle that (or we move
 *     to prom-client + a Pushgateway / exemplar of a shared registry).
 *   - No label cardinality bounds. Callers must keep label values low-
 *     cardinality (enum-ish) or memory will grow unbounded.
 */

type LabelValues = Record<string, string | number | boolean>;

type CounterEntry = { name: string; help: string; labels: LabelValues; value: number };
type HistogramEntry = {
  name: string;
  help: string;
  labels: LabelValues;
  buckets: number[];
  counts: number[]; // length = buckets.length + 1 (last is +Inf)
  sum: number;
  count: number;
};

const DEFAULT_HISTO_BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30];

class MetricsRegistry {
  private counters = new Map<string, CounterEntry>();
  private histograms = new Map<string, HistogramEntry>();

  counter(name: string, help: string, labels: LabelValues = {}, delta = 1): void {
    const key = buildKey(name, labels);
    const existing = this.counters.get(key);
    if (existing) {
      existing.value += delta;
      return;
    }
    this.counters.set(key, { name, help, labels, value: delta });
  }

  observeHistogram(
    name: string,
    help: string,
    labels: LabelValues,
    valueSeconds: number,
    buckets: number[] = DEFAULT_HISTO_BUCKETS,
  ): void {
    const key = buildKey(name, labels);
    let entry = this.histograms.get(key);
    if (!entry) {
      entry = {
        name,
        help,
        labels,
        buckets,
        counts: new Array(buckets.length + 1).fill(0),
        sum: 0,
        count: 0,
      };
      this.histograms.set(key, entry);
    }
    const idx = entry.buckets.findIndex((b) => valueSeconds <= b);
    const bucketIdx = idx === -1 ? entry.counts.length - 1 : idx;
    entry.counts[bucketIdx] = (entry.counts[bucketIdx] ?? 0) + 1;
    entry.sum += valueSeconds;
    entry.count += 1;
  }

  reset(): void {
    this.counters.clear();
    this.histograms.clear();
  }

  /** Export all metrics in Prometheus text format 0.0.4. */
  format(): string {
    const lines: string[] = [];

    // Counters — group by name for HELP/TYPE headers
    const countersByName = new Map<string, CounterEntry[]>();
    for (const c of this.counters.values()) {
      const arr = countersByName.get(c.name) ?? [];
      arr.push(c);
      countersByName.set(c.name, arr);
    }
    for (const [name, arr] of countersByName) {
      if (arr.length === 0) continue;
      lines.push(`# HELP ${name} ${arr[0]!.help}`);
      lines.push(`# TYPE ${name} counter`);
      for (const c of arr) {
        lines.push(`${name}${formatLabels(c.labels)} ${c.value}`);
      }
    }

    // Histograms
    const historyByName = new Map<string, HistogramEntry[]>();
    for (const h of this.histograms.values()) {
      const arr = historyByName.get(h.name) ?? [];
      arr.push(h);
      historyByName.set(h.name, arr);
    }
    for (const [name, arr] of historyByName) {
      if (arr.length === 0) continue;
      lines.push(`# HELP ${name} ${arr[0]!.help}`);
      lines.push(`# TYPE ${name} histogram`);
      for (const h of arr) {
        let cumulative = 0;
        for (let i = 0; i < h.buckets.length; i++) {
          cumulative += h.counts[i] ?? 0;
          lines.push(
            `${name}_bucket${formatLabels({ ...h.labels, le: String(h.buckets[i]) })} ${cumulative}`,
          );
        }
        cumulative += h.counts[h.counts.length - 1] ?? 0;
        lines.push(`${name}_bucket${formatLabels({ ...h.labels, le: "+Inf" })} ${cumulative}`);
        lines.push(`${name}_sum${formatLabels(h.labels)} ${h.sum}`);
        lines.push(`${name}_count${formatLabels(h.labels)} ${h.count}`);
      }
    }

    return lines.join("\n") + "\n";
  }
}

function buildKey(name: string, labels: LabelValues): string {
  const keys = Object.keys(labels).sort();
  const kvs = keys.map((k) => `${k}=${String(labels[k])}`).join(",");
  return `${name}|${kvs}`;
}

function formatLabels(labels: LabelValues): string {
  const keys = Object.keys(labels).sort();
  if (keys.length === 0) return "";
  const pairs = keys
    .map((k) => `${k}="${String(labels[k]).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)
    .join(",");
  return `{${pairs}}`;
}

// Global singleton — Node keeps this in-memory for the life of the process.
export const metrics = new MetricsRegistry();

// Typed helpers for the payment metrics we care about.
export function paymentCreated(type: string, status: string): void {
  metrics.counter(
    "payment_created_total",
    "Number of Payment rows created, by type and status at creation.",
    { type, status },
  );
}

export function paymentStatusChanged(type: string, from: string, to: string): void {
  metrics.counter(
    "payment_status_transition_total",
    "Number of Payment.status transitions, by payment type.",
    { type, from, to },
  );
}

export function stripeWebhookOutcome(eventType: string, outcome: "processed" | "duplicate" | "failed"): void {
  metrics.counter(
    "stripe_webhook_total",
    "Stripe webhook deliveries, by event type and final outcome.",
    { event: eventType, outcome },
  );
}

export function bondCapture(outcome: "partial" | "full" | "released"): void {
  metrics.counter(
    "bond_capture_total",
    "Bond capture outcomes.",
    { outcome },
  );
}

export function unmatchedTransactionOpened(source: string): void {
  metrics.counter(
    "unmatched_transactions_total",
    "Unmatched reconciliation transactions opened, by source.",
    { source },
  );
}

export function stripeApiLatency(operation: string, seconds: number): void {
  metrics.observeHistogram(
    "stripe_api_latency_seconds",
    "Latency of calls into the Stripe SDK, by logical operation.",
    { operation },
    seconds,
  );
}
