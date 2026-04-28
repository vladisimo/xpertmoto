import { describe, it, expect, beforeEach } from "vitest";
import {
  metrics,
  paymentCreated,
  paymentStatusChanged,
  stripeWebhookOutcome,
  stripeApiLatency,
} from "@/server/services/metrics";

/**
 * G14 — metrics registry.
 *
 *   - Counters increment and persist in the Prometheus text output.
 *   - Label combinations are tracked as separate series.
 *   - Histograms observe into the right bucket.
 *   - format() produces parseable Prometheus text.
 */

beforeEach(() => {
  metrics.reset();
});

describe("metrics registry", () => {
  it("counters increment correctly per label combo", () => {
    paymentCreated("LATE_FEE", "PENDING");
    paymentCreated("LATE_FEE", "PENDING");
    paymentCreated("DAMAGE_CHARGE", "PENDING");
    const out = metrics.format();
    expect(out).toContain('payment_created_total{status="PENDING",type="LATE_FEE"} 2');
    expect(out).toContain('payment_created_total{status="PENDING",type="DAMAGE_CHARGE"} 1');
  });

  it("captures status transitions with from/to labels", () => {
    paymentStatusChanged("BOOKING_PAYMENT", "PENDING", "SUCCEEDED");
    paymentStatusChanged("BOOKING_PAYMENT", "PENDING", "FAILED");
    const out = metrics.format();
    expect(out).toContain(
      'payment_status_transition_total{from="PENDING",to="SUCCEEDED",type="BOOKING_PAYMENT"} 1',
    );
    expect(out).toContain(
      'payment_status_transition_total{from="PENDING",to="FAILED",type="BOOKING_PAYMENT"} 1',
    );
  });

  it("webhook outcomes count separately per event type", () => {
    stripeWebhookOutcome("payment_intent.succeeded", "processed");
    stripeWebhookOutcome("payment_intent.succeeded", "duplicate");
    stripeWebhookOutcome("charge.refunded", "processed");
    const out = metrics.format();
    expect(out).toContain('stripe_webhook_total{event="payment_intent.succeeded",outcome="processed"} 1');
    expect(out).toContain('stripe_webhook_total{event="payment_intent.succeeded",outcome="duplicate"} 1');
    expect(out).toContain('stripe_webhook_total{event="charge.refunded",outcome="processed"} 1');
  });

  it("histograms observe into buckets and report sum/count", () => {
    stripeApiLatency("create_payment_intent", 0.3);
    stripeApiLatency("create_payment_intent", 1.2);
    stripeApiLatency("create_payment_intent", 3.0);
    const out = metrics.format();
    expect(out).toContain("stripe_api_latency_seconds_bucket");
    expect(out).toContain('stripe_api_latency_seconds_count{operation="create_payment_intent"} 3');
  });

  it("output conforms to Prometheus text format with HELP and TYPE lines", () => {
    paymentCreated("BOOKING_PAYMENT", "SUCCEEDED");
    const out = metrics.format();
    expect(out).toMatch(/# HELP payment_created_total .+\n# TYPE payment_created_total counter\n/);
  });

  it("escapes label values properly", () => {
    metrics.counter("test_metric", "A test", { label: 'value with "quote"' });
    const out = metrics.format();
    expect(out).toContain('label="value with \\"quote\\""');
  });
});
