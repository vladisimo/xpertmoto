import { describe, expect, test } from "vitest";
import { toStoredMarkers } from "@/server/trpc/router/inspection";

const FIXED_NOW = new Date("2026-04-18T10:00:00.000Z");

describe("toStoredMarkers", () => {
  test("defaults missing view to LEFT (legacy-safe persistence)", () => {
    const [out] = toStoredMarkers(
      [{ x: 0.1, y: 0.2, severity: "MINOR", source: "staff" }],
      FIXED_NOW,
    );
    expect(out?.view).toBe("LEFT");
  });

  test("preserves a supplied view unchanged", () => {
    const stored = toStoredMarkers(
      [
        { x: 0.1, y: 0.2, severity: "MINOR", source: "staff", view: "RIGHT" },
        { x: 0.3, y: 0.4, severity: "MODERATE", source: "customer", view: "FRONT" },
        { x: 0.5, y: 0.6, severity: "MAJOR", source: "staff", view: "REAR" },
      ],
      FIXED_NOW,
    );
    expect(stored.map((m) => m.view)).toEqual(["RIGHT", "FRONT", "REAR"]);
  });

  test("stamps addedAt when missing, preserves when supplied", () => {
    const stored = toStoredMarkers(
      [
        { x: 0, y: 0, severity: "MINOR", source: "staff" },
        { x: 0, y: 0, severity: "MINOR", source: "staff", addedAt: "2025-12-01T00:00:00.000Z" },
      ],
      FIXED_NOW,
    );
    expect(stored[0]?.addedAt).toBe(FIXED_NOW.toISOString());
    expect(stored[1]?.addedAt).toBe("2025-12-01T00:00:00.000Z");
  });

  test("propagates id, note, severity, source verbatim", () => {
    const [out] = toStoredMarkers(
      [{ id: "abc", x: 0.1, y: 0.2, severity: "MAJOR", note: "cracked panel", source: "customer", view: "REAR" }],
      FIXED_NOW,
    );
    expect(out).toEqual({
      id: "abc",
      x: 0.1,
      y: 0.2,
      severity: "MAJOR",
      note: "cracked panel",
      source: "customer",
      view: "REAR",
      addedAt: FIXED_NOW.toISOString(),
    });
  });

  test("empty array round-trips to empty array", () => {
    expect(toStoredMarkers([], FIXED_NOW)).toEqual([]);
  });
});

describe("inspection depot scoping (B1 follow-up)", () => {
  test("FORBIDDEN: depot-assigned STAFF cannot create an inspection at another depot", async () => {
    const { vi } = await import("vitest");
    const { inspectionRouter } = await import("@/server/trpc/router/inspection");
    const prisma = {
      booking: { findUnique: vi.fn() },
      inspection: { findFirst: vi.fn(), create: vi.fn() },
    };
    const ctx = {
      prisma,
      user: { id: "staff1", role: "STAFF" as const, depotId: "depot-a" },
      session: { user: { id: "staff1", role: "STAFF" as const, depotId: "depot-a" } },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      reqId: "r1",
      _skipAudit: true,
    };
    const caller = inspectionRouter.createCaller(ctx as never);
    await expect(
      caller.create({
        vehicleId: "v1",
        type: "ROUTINE",
        depotId: "depot-b",
        odometerKm: 100,
        fuelLevel: 50,
        overallCondition: "GOOD",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(prisma.inspection.create).not.toHaveBeenCalled();
  });

  test("FORBIDDEN: depot-assigned STAFF cannot read inspections for another depot's booking", async () => {
    const { vi } = await import("vitest");
    const { inspectionRouter } = await import("@/server/trpc/router/inspection");
    const prisma = {
      booking: { findUnique: vi.fn(async () => ({ depotId: "depot-b" })) },
      inspection: { findMany: vi.fn() },
    };
    const ctx = {
      prisma,
      user: { id: "staff1", role: "STAFF" as const, depotId: "depot-a" },
      session: { user: { id: "staff1", role: "STAFF" as const, depotId: "depot-a" } },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      reqId: "r1",
      _skipAudit: true,
    };
    const caller = inspectionRouter.createCaller(ctx as never);
    await expect(caller.byBooking({ bookingId: "b-other" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(prisma.inspection.findMany).not.toHaveBeenCalled();
  });
});

describe("inspection.addIssue / removeIssue (labelled photo issues)", () => {
  const staff = { id: "staff1", role: "STAFF" as const, depotId: "depot-a" };

  test("addIssue creates a labelled issue on a DRAFT inspection at the staff's depot", async () => {
    const { vi } = await import("vitest");
    const { inspectionRouter } = await import("@/server/trpc/router/inspection");
    const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "iss1", ...data }));
    const prisma = {
      inspection: {
        findUniqueOrThrow: vi.fn(async () => ({
          depotId: "depot-a",
          bookingId: "b1",
          status: "DRAFT",
          type: "PRE_HIRE",
        })),
      },
      inspectionIssue: { create },
    };
    const ctx = { prisma, user: staff, session: { user: staff }, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, reqId: "r1", _skipAudit: true };
    const caller = inspectionRouter.createCaller(ctx as never);
    await caller.addIssue({
      inspectionId: "i1",
      inspectionPhotoId: "p1",
      label: "Broken mirror",
      severity: "MAJOR",
      posX: 0.4,
      posY: 0.6,
      side: "LEFT",
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]?.[0].data).toMatchObject({
      inspectionId: "i1",
      inspectionPhotoId: "p1",
      label: "Broken mirror",
      severity: "MAJOR",
      posX: 0.4,
      posY: 0.6,
      side: "LEFT",
      isPreExisting: true, // PRE_HIRE inspection → pre-existing damage
    });
  });

  test("addIssue rejects BAD_REQUEST when the inspection is not DRAFT", async () => {
    const { vi } = await import("vitest");
    const { inspectionRouter } = await import("@/server/trpc/router/inspection");
    const create = vi.fn();
    const prisma = {
      inspection: {
        findUniqueOrThrow: vi.fn(async () => ({ depotId: "depot-a", bookingId: "b1", status: "COMPLETED", type: "POST_HIRE" })),
      },
      inspectionIssue: { create },
    };
    const ctx = { prisma, user: staff, session: { user: staff }, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, reqId: "r1", _skipAudit: true };
    const caller = inspectionRouter.createCaller(ctx as never);
    await expect(
      caller.addIssue({ inspectionId: "i1", label: "Scratch", severity: "MINOR" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(create).not.toHaveBeenCalled();
  });

  test("addIssue rejects FORBIDDEN for another depot's inspection", async () => {
    const { vi } = await import("vitest");
    const { inspectionRouter } = await import("@/server/trpc/router/inspection");
    const create = vi.fn();
    const prisma = {
      inspection: {
        findUniqueOrThrow: vi.fn(async () => ({ depotId: "depot-b", bookingId: "b1", status: "DRAFT", type: "PRE_HIRE" })),
      },
      inspectionIssue: { create },
    };
    const ctx = { prisma, user: staff, session: { user: staff }, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, reqId: "r1", _skipAudit: true };
    const caller = inspectionRouter.createCaller(ctx as never);
    await expect(
      caller.addIssue({ inspectionId: "i1", label: "Dent", severity: "MODERATE" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(create).not.toHaveBeenCalled();
  });

  test("removeIssue deletes an issue on a DRAFT inspection", async () => {
    const { vi } = await import("vitest");
    const { inspectionRouter } = await import("@/server/trpc/router/inspection");
    const del = vi.fn(async () => ({ id: "iss1" }));
    const prisma = {
      inspectionIssue: {
        findUniqueOrThrow: vi.fn(async () => ({ inspection: { depotId: "depot-a", bookingId: "b1", status: "DRAFT" } })),
        delete: del,
      },
    };
    const ctx = { prisma, user: staff, session: { user: staff }, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, reqId: "r1", _skipAudit: true };
    const caller = inspectionRouter.createCaller(ctx as never);
    await caller.removeIssue({ id: "iss1" });
    expect(del).toHaveBeenCalledWith({ where: { id: "iss1" } });
  });
});
