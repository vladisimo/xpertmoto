import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { nominationRouter } from "@/server/trpc/router/nomination";

// Build a minimal tRPC context. protectedProcedure copies session.user → ctx.user,
// and requireRole gates on ctx.user.role.
function makeCtx(opts: {
  role?: string;
  prisma?: Record<string, unknown>;
}) {
  const prisma = {
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    ...(opts.prisma ?? {}),
  };
  return {
    prisma,
    session: opts.role ? { user: { id: "u1", role: opts.role } } : null,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    reqId: "r1",
  } as never;
}

beforeEach(() => vi.clearAllMocks());

describe("nomination router auth", () => {
  it("rejects a STAFF user from a manager-only procedure", async () => {
    const caller = nominationRouter.createCaller(makeCtx({ role: "STAFF" }));
    await expect(caller.allocate({ infringementId: "inf1" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("rejects an anonymous caller", async () => {
    const caller = nominationRouter.createCaller(makeCtx({}));
    await expect(caller.listPendingReview()).rejects.toBeInstanceOf(TRPCError);
  });
});

describe("nomination.listPendingReview", () => {
  it("returns PENDING_REVIEW infringements for a manager", async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: "inf1", status: "PENDING_REVIEW" }]);
    const caller = nominationRouter.createCaller(
      makeCtx({ role: "MANAGER", prisma: { infringement: { findMany } } }),
    );
    const out = await caller.listPendingReview();
    expect(out).toEqual([{ id: "inf1", status: "PENDING_REVIEW" }]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "PENDING_REVIEW", deletedAt: null }),
      }),
    );
  });
});

describe("nomination.draftSubmission validation", () => {
  it("refuses to draft when the infringement has no allocated renter", async () => {
    const findUniqueOrThrow = vi.fn().mockResolvedValue({
      id: "inf1",
      customerId: null,
      vehicle: { rego: "ABC123" },
    });
    const caller = nominationRouter.createCaller(
      makeCtx({ role: "MANAGER", prisma: { infringement: { findUniqueOrThrow } } }),
    );
    await expect(
      caller.draftSubmission({ infringementId: "inf1", channel: "ENOMINATIONS_CSV" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects an invalid channel via Zod", async () => {
    const caller = nominationRouter.createCaller(makeCtx({ role: "MANAGER" }));
    await expect(
      // @ts-expect-error — exercising the Zod guard with a bad enum value
      caller.draftSubmission({ infringementId: "inf1", channel: "FAX" }),
    ).rejects.toBeInstanceOf(TRPCError);
  });
});
