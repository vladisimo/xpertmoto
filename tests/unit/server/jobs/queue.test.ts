import { describe, it, expect, vi } from "vitest";

// Capture BullMQ constructor options without touching Redis.
const queueCtor = vi.fn();
const workerCtor = vi.fn();
vi.mock("bullmq", () => ({
  Queue: class {
    constructor(...a: unknown[]) {
      queueCtor(...a);
    }
  },
  Worker: class {
    constructor(...a: unknown[]) {
      workerCtor(...a);
    }
    on() {}
  },
  QueueEvents: class {
    on() {}
  },
}));
vi.mock("@/lib/redis", () => ({ getRedis: () => ({}) }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/logger", () => ({
  logger: {
    child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));
vi.mock("@sentry/nextjs", () => ({ captureCheckIn: vi.fn(), captureException: vi.fn() }));
vi.mock("@/server/services/audit", () => ({ writeAudit: vi.fn() }));

import { getQueue } from "@/server/jobs/queue";

describe("getQueue defaults", () => {
  it("applies retry attempts + exponential backoff so transient failures are not one-shot", () => {
    expect(getQueue("overdue-check")).not.toBeNull();
    const [name, opts] = queueCtor.mock.calls[0]!;
    expect(name).toBe("overdue-check");
    expect(opts.defaultJobOptions).toMatchObject({
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
    });
    // Retention defaults must survive alongside the retry policy.
    expect(opts.defaultJobOptions.removeOnComplete).toEqual({ age: 7 * 24 * 3600, count: 1000 });
    expect(opts.defaultJobOptions.removeOnFail).toEqual({ age: 30 * 24 * 3600, count: 5000 });
  });
});
