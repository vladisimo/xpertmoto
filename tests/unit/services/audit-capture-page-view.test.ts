/**
 * `capturePageView` must tag page-view rows with entity='User', entityId=userId
 * so they surface on the staff Activity tab for the customer who visited.
 * Anonymous traffic (no session) must not be logged.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { capturePageView } from "@/server/services/audit";

function makePrisma() {
  return {
    auditLog: {
      create: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as PrismaClient;
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => queueMicrotask(resolve));
}

describe("capturePageView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips writing when no session is present", async () => {
    const prisma = makePrisma();
    capturePageView(prisma, new Headers(), null, "/dashboard");
    await flushMicrotasks();
    const create = (
      prisma.auditLog as unknown as { create: ReturnType<typeof vi.fn> }
    ).create;
    expect(create).not.toHaveBeenCalled();
  });

  it("tags the page view with entity='User' and entityId=userId", async () => {
    const prisma = makePrisma();
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.9",
      "user-agent": "Mozilla/5.0 (vitest)",
      "x-request-id": "req-abc",
    });
    capturePageView(
      prisma,
      headers,
      {
        user: { id: "user_42", depotId: null },
        expires: "2099-01-01T00:00:00Z",
      } as never,
      "/dashboard/documents",
    );
    await flushMicrotasks();

    const create = (
      prisma.auditLog as unknown as { create: ReturnType<typeof vi.fn> }
    ).create;
    expect(create).toHaveBeenCalledTimes(1);
    const payload = create.mock.calls[0]?.[0]?.data;
    expect(payload).toMatchObject({
      userId: "user_42",
      category: "PAGE_VIEW",
      action: "page.view",
      entity: "User",
      entityId: "user_42",
      method: "GET",
      path: "/dashboard/documents",
      status: "SUCCESS",
      ipAddress: "203.0.113.9",
      userAgent: "Mozilla/5.0 (vitest)",
      reqId: "req-abc",
    });
  });
});
