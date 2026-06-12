import { describe, it, expect, afterEach, vi } from "vitest";

import { sentryTracesSampleRate } from "@/lib/observability/sentry-sample-rate";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("sentryTracesSampleRate", () => {
  it("honours a valid env override", () => {
    vi.stubEnv("SENTRY_TRACES_SAMPLE_RATE", "0.25");
    expect(sentryTracesSampleRate()).toBe(0.25);
  });

  it("falls back to the default on junk or out-of-range values", () => {
    vi.stubEnv("NODE_ENV", "production");
    for (const junk of ["abc", "-1", "2", ""]) {
      vi.stubEnv("SENTRY_TRACES_SAMPLE_RATE", junk);
      expect(sentryTracesSampleRate()).toBe(0.05);
    }
  });

  it("defaults to 0.05 in production and 1.0 elsewhere", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(sentryTracesSampleRate()).toBe(0.05);
    vi.stubEnv("NODE_ENV", "development");
    expect(sentryTracesSampleRate()).toBe(1.0);
  });
});
