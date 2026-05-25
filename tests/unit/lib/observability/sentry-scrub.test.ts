import { describe, expect, it } from "vitest";
import type { ErrorEvent } from "@sentry/nextjs";
import { scrubSentryEvent } from "@/lib/observability/sentry-scrub";

describe("scrubSentryEvent", () => {
  it("redacts sensitive keys nested in extra/contexts", () => {
    const event = {
      extra: {
        licenceNumber: "12345678",
        dateOfBirth: "1990-01-01",
        booking: { reference: "ABC123", address: "1 Main St" },
      },
      contexts: { custom: { stripeChargeId: "ch_123", note: "ok" } },
    } as unknown as ErrorEvent;

    const out = scrubSentryEvent(event);

    expect(out.extra?.licenceNumber).toBe("[REDACTED]");
    expect(out.extra?.dateOfBirth).toBe("[REDACTED]");
    expect((out.extra?.booking as Record<string, unknown>).address).toBe("[REDACTED]");
    // Non-sensitive siblings are preserved.
    expect((out.extra?.booking as Record<string, unknown>).reference).toBe("ABC123");
    expect((out.contexts?.custom as Record<string, unknown>).stripeChargeId).toBe("[REDACTED]");
    expect((out.contexts?.custom as Record<string, unknown>).note).toBe("ok");
  });

  it("is case-insensitive on key names and scrubs inside arrays", () => {
    const event = {
      extra: {
        items: [{ CardNumber: "4242424242424242" }, { phone: "0400000000" }],
      },
    } as unknown as ErrorEvent;

    const out = scrubSentryEvent(event);
    const items = out.extra?.items as Array<Record<string, unknown>>;
    expect(items[0]?.CardNumber).toBe("[REDACTED]");
    expect(items[1]?.phone).toBe("[REDACTED]");
  });

  it("preserves event.user identity (controlled PII surface)", () => {
    const event = {
      user: { id: "user_1", email: "person@example.com" },
      extra: { email: "leaked@example.com" },
    } as unknown as ErrorEvent;

    const out = scrubSentryEvent(event);
    // event.user is deliberately left intact for triage...
    expect(out.user?.email).toBe("person@example.com");
    expect(out.user?.id).toBe("user_1");
    // ...but the same field elsewhere is still scrubbed.
    expect(out.extra?.email).toBe("[REDACTED]");
  });

  it("tolerates circular references without throwing", () => {
    const event = { extra: {} } as unknown as ErrorEvent;
    const cyclic: Record<string, unknown> = { token: "secret" };
    cyclic.self = cyclic;
    (event.extra as Record<string, unknown>).cyclic = cyclic;

    expect(() => scrubSentryEvent(event)).not.toThrow();
    expect((event.extra?.cyclic as Record<string, unknown>).token).toBe("[REDACTED]");
  });
});
