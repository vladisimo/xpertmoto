import { describe, it, expect, vi } from "vitest";

// The job module pulls in prisma / stripe / queue at import time; stub the
// side-effecting deps so we can unit-test the pure note helpers in isolation.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/server/services/stripe-customer", () => ({ chargeOffSessionForUser: vi.fn() }));
vi.mock("@/server/services/audit-payment", () => ({ writePaymentAudit: vi.fn() }));
vi.mock("@/server/services/payment-events", () => ({ writePaymentEvent: vi.fn() }));
vi.mock("@/server/services/notification-sender", () => ({ sendNotification: vi.fn() }));
vi.mock("@/lib/branding", () => ({ getBranding: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/server/jobs/queue", () => ({ getQueue: vi.fn(), registerWorker: vi.fn() }));

import { refreshSkipNote, NO_PM_SKIP_MARKER } from "@/server/jobs/capture-pending-payments";

const skipLines = (notes: string) =>
  notes.split("\n").filter((l) => l.includes(NO_PM_SKIP_MARKER)).length;

describe("refreshSkipNote", () => {
  it("seeds a single stamped skip line on empty notes", () => {
    const out = refreshSkipNote(null);
    expect(skipLines(out)).toBe(1);
    expect(out).toMatch(/^\[.+Z\] capture-pending: skipped/);
  });

  it("never stacks more than one skip line across repeated ticks", () => {
    let notes = refreshSkipNote(null);
    for (let i = 0; i < 50; i++) notes = refreshSkipNote(notes);
    expect(skipLines(notes)).toBe(1);
    expect(notes.split("\n")).toHaveLength(1);
  });

  it("preserves non-skip lines and drops only stale skip lines", () => {
    const existing =
      "[2026-05-11T02:05:00.000Z] capture-pending: skipped — no stored PM\n" +
      "[2026-05-11T02:10:00.000Z] capture-pending: requires_action — 3DS needed\n" +
      "[2026-05-11T02:15:00.000Z] capture-pending: skipped — no stored PM";
    const out = refreshSkipNote(existing);
    expect(skipLines(out)).toBe(1);
    expect(out).toContain("requires_action — 3DS needed");
    // the fresh skip line is appended last
    expect(out.split("\n").pop()).toContain(NO_PM_SKIP_MARKER);
  });
});
