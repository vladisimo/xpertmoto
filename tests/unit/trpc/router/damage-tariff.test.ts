import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { damageTariffRouter } from "@/server/trpc/router/damage-tariff";

/**
 * Unit tests for the damage-tariff router. Tariffs seed damage charges, so
 * the money assertions here are exact: `defaultPrice` must reach Prisma
 * byte-for-byte as supplied (the router does no GST maths of its own — GST
 * is derived downstream from the GST-inclusive amount via gstFromInclusive).
 */

type Caller = ReturnType<typeof damageTariffRouter.createCaller>;
type Role = "CUSTOMER" | "STAFF" | "MANAGER" | "ADMIN" | "SUPER_ADMIN";

function makePrisma(
  over: { tariffs?: unknown[]; duplicate?: unknown } = {},
) {
  return {
    damageTariff: {
      findMany: vi.fn().mockResolvedValue(over.tariffs ?? []),
      findUnique: vi.fn().mockResolvedValue(over.duplicate ?? null),
      create: vi
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: "dt-new", ...data }),
        ),
      update: vi
        .fn()
        .mockImplementation(
          ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) =>
            Promise.resolve({ id: where.id, ...data }),
        ),
    },
    // The auto-audit middleware fires on every mutation; give it a sink so
    // the write doesn't fall into the swallow-and-log branch.
    auditLog: { create: vi.fn().mockResolvedValue({ id: "audit1" }) },
  };
}

function makeCtx(prisma: unknown, role: Role | null = "ADMIN") {
  const user = role === null ? null : { id: "u1", email: "u@xpert.test", role, depotId: null };
  return {
    prisma,
    user,
    session: user ? { user } : null,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ipAddress: "127.0.0.1",
    userAgent: "test",
    reqId: "r1",
    headers: undefined,
  } as unknown as Parameters<Caller["list"]>[0];
}

function callerFor(prisma: unknown, role: Role | null = "ADMIN") {
  return damageTariffRouter.createCaller(makeCtx(prisma, role) as never);
}

/** A tariff row shaped like Prisma returns it (Decimal money column). */
function tariff(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "dt1",
    code: "SCRATCH_PANEL",
    name: "Scratched panel",
    description: null,
    defaultPrice: new Prisma.Decimal("149.95"),
    categoryScope: [] as string[],
    severityHint: "MINOR",
    isActive: true,
    displayOrder: 0,
    ...over,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("damageTariff.list", () => {
  it("defaults to active-only, ordered by displayOrder then name", async () => {
    const prisma = makePrisma({ tariffs: [tariff()] });
    const out = await callerFor(prisma, "STAFF").list();

    expect(prisma.damageTariff.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    });
    expect(out).toHaveLength(1);
  });

  it("drops the isActive filter only when activeOnly is explicitly false", async () => {
    const prisma = makePrisma();
    const caller = callerFor(prisma, "STAFF");

    await caller.list({ activeOnly: false });
    expect(prisma.damageTariff.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: {} }),
    );

    await caller.list({ activeOnly: true });
    expect(prisma.damageTariff.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { isActive: true } }),
    );
  });

  it("keeps globally-scoped tariffs and those scoped to the requested category", async () => {
    const global = tariff({ id: "dt-global", code: "GLOBAL", categoryScope: [] });
    const scooter = tariff({ id: "dt-scooter", code: "SCOOTER", categoryScope: ["cat-scooter"] });
    const motorbike = tariff({ id: "dt-bike", code: "BIKE", categoryScope: ["cat-motorbike"] });
    const prisma = makePrisma({ tariffs: [global, scooter, motorbike] });

    const out = await callerFor(prisma, "STAFF").list({ categoryId: "cat-scooter" });

    expect(out.map((t) => t.id)).toEqual(["dt-global", "dt-scooter"]);
  });

  it("still filters to active rows when only a categoryId is supplied", async () => {
    const prisma = makePrisma({ tariffs: [tariff()] });
    await callerFor(prisma, "STAFF").list({ categoryId: "cat-scooter" });

    expect(prisma.damageTariff.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true } }),
    );
  });

  it("returns an empty list when no tariff is scoped to the category", async () => {
    const prisma = makePrisma({ tariffs: [tariff({ categoryScope: ["cat-motorbike"] })] });
    const out = await callerFor(prisma, "STAFF").list({ categoryId: "cat-scooter" });

    expect(out).toEqual([]);
  });

  it("passes prices through verbatim — no GST split, no re-rounding", async () => {
    const prisma = makePrisma({
      tariffs: [
        tariff({ id: "a", defaultPrice: new Prisma.Decimal("149.95") }),
        tariff({ id: "b", code: "MIRROR", defaultPrice: new Prisma.Decimal("0.05") }),
      ],
    });
    const out = await callerFor(prisma, "STAFF").list();

    expect(out.map((t) => t.defaultPrice.toFixed(2))).toEqual(["149.95", "0.05"]);
  });

  it("rejects a customer caller (staffProcedure)", async () => {
    await expect(callerFor(makePrisma(), "CUSTOMER").list()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("rejects an anonymous caller", async () => {
    await expect(callerFor(makePrisma(), null).list()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("rejects a non-boolean activeOnly (Zod)", async () => {
    const prisma = makePrisma();
    await expect(
      callerFor(prisma, "STAFF").list({ activeOnly: "yes" } as never),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(prisma.damageTariff.findMany).not.toHaveBeenCalled();
  });
});

describe("damageTariff.upsert — create", () => {
  const input = {
    code: "SCRATCH_PANEL",
    name: "Scratched panel",
    description: "Single panel, no primer damage",
    defaultPrice: 149.95,
    categoryScope: ["cat-scooter"],
    severityHint: "MINOR" as const,
    isActive: true,
    displayOrder: 3,
  };

  it("creates a tariff when the code is free, preserving the exact price", async () => {
    const prisma = makePrisma();
    const out = await callerFor(prisma, "ADMIN").upsert(input);

    expect(prisma.damageTariff.findUnique).toHaveBeenCalledWith({
      where: { code: "SCRATCH_PANEL" },
    });
    expect(prisma.damageTariff.create).toHaveBeenCalledWith({
      data: {
        code: "SCRATCH_PANEL",
        name: "Scratched panel",
        description: "Single panel, no primer damage",
        defaultPrice: 149.95,
        categoryScope: ["cat-scooter"],
        severityHint: "MINOR",
        isActive: true,
        displayOrder: 3,
      },
    });
    expect(out.defaultPrice).toBe(149.95);
  });

  it("applies the Zod defaults for scope, active flag and display order", async () => {
    const prisma = makePrisma();
    await callerFor(prisma, "ADMIN").upsert({
      code: "MIRROR",
      name: "Mirror replacement",
      defaultPrice: 89,
    });

    expect(prisma.damageTariff.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        categoryScope: [],
        isActive: true,
        displayOrder: 0,
        description: undefined,
        severityHint: undefined,
      }),
    });
  });

  it("accepts a zero-dollar tariff (min boundary)", async () => {
    const prisma = makePrisma();
    await callerFor(prisma, "ADMIN").upsert({ code: "WAIVED", name: "Waived", defaultPrice: 0 });

    expect(prisma.damageTariff.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ defaultPrice: 0 }),
    });
  });

  it("rejects a duplicate code with CONFLICT and never writes", async () => {
    const prisma = makePrisma({ duplicate: tariff() });
    const caller = callerFor(prisma, "ADMIN");

    await expect(caller.upsert(input)).rejects.toMatchObject({
      code: "CONFLICT",
      message: 'Tariff code "SCRATCH_PANEL" already exists',
    });
    expect(prisma.damageTariff.create).not.toHaveBeenCalled();
  });

  it.each([
    ["a code shorter than 2 chars", { code: "S", name: "X", defaultPrice: 10 }],
    ["an empty name", { code: "SCRATCH", name: "", defaultPrice: 10 }],
    ["a negative price", { code: "SCRATCH", name: "X", defaultPrice: -1 }],
    [
      "an unknown severity hint",
      { code: "SCRATCH", name: "X", defaultPrice: 10, severityHint: "CATASTROPHIC" },
    ],
    [
      "a fractional display order",
      { code: "SCRATCH", name: "X", defaultPrice: 10, displayOrder: 1.5 },
    ],
  ])("rejects %s (Zod)", async (_label, bad) => {
    const prisma = makePrisma();
    await expect(callerFor(prisma, "ADMIN").upsert(bad as never)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(prisma.damageTariff.create).not.toHaveBeenCalled();
  });

  it.each(["STAFF", "MANAGER"] as const)("rejects a %s caller (adminProcedure)", async (role) => {
    const prisma = makePrisma();
    await expect(callerFor(prisma, role).upsert(input)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(prisma.damageTariff.create).not.toHaveBeenCalled();
  });

  it("rejects an anonymous caller", async () => {
    await expect(callerFor(makePrisma(), null).upsert(input)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("allows a super-admin caller", async () => {
    const prisma = makePrisma();
    await callerFor(prisma, "SUPER_ADMIN").upsert(input);
    expect(prisma.damageTariff.create).toHaveBeenCalledTimes(1);
  });
});

describe("damageTariff.upsert — update", () => {
  it("updates by id with the full field set and the exact price", async () => {
    const prisma = makePrisma();
    const out = await callerFor(prisma, "ADMIN").upsert({
      id: "dt1",
      code: "SCRATCH_PANEL",
      name: "Scratched panel (deep)",
      defaultPrice: 275.5,
      categoryScope: ["cat-scooter", "cat-motorbike"],
      severityHint: "MAJOR",
      isActive: false,
      displayOrder: 2,
    });

    expect(prisma.damageTariff.update).toHaveBeenCalledWith({
      where: { id: "dt1" },
      data: {
        code: "SCRATCH_PANEL",
        name: "Scratched panel (deep)",
        description: undefined,
        defaultPrice: 275.5,
        categoryScope: ["cat-scooter", "cat-motorbike"],
        severityHint: "MAJOR",
        isActive: false,
        displayOrder: 2,
      },
    });
    expect(out.defaultPrice).toBe(275.5);
  });

  it("does not run the duplicate-code check on the update path (current behaviour)", async () => {
    // A rename onto an existing code therefore surfaces as a raw Prisma
    // unique-constraint error rather than the friendly CONFLICT the create
    // path returns.
    const prisma = makePrisma({ duplicate: tariff({ id: "other" }) });
    await callerFor(prisma, "ADMIN").upsert({ id: "dt1", code: "MIRROR", name: "X", defaultPrice: 10 });

    expect(prisma.damageTariff.findUnique).not.toHaveBeenCalled();
    expect(prisma.damageTariff.update).toHaveBeenCalledTimes(1);
  });

  it("rejects a staff caller (adminProcedure)", async () => {
    const prisma = makePrisma();
    await expect(
      callerFor(prisma, "STAFF").upsert({ id: "dt1", code: "MIRROR", name: "X", defaultPrice: 10 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(prisma.damageTariff.update).not.toHaveBeenCalled();
  });
});

describe("damageTariff.disable / enable", () => {
  it("disable flips isActive to false", async () => {
    const prisma = makePrisma();
    const out = await callerFor(prisma, "ADMIN").disable({ id: "dt1" });

    expect(prisma.damageTariff.update).toHaveBeenCalledWith({
      where: { id: "dt1" },
      data: { isActive: false },
    });
    expect(out).toMatchObject({ id: "dt1", isActive: false });
  });

  it("enable flips isActive to true", async () => {
    const prisma = makePrisma();
    const out = await callerFor(prisma, "SUPER_ADMIN").enable({ id: "dt1" });

    expect(prisma.damageTariff.update).toHaveBeenCalledWith({
      where: { id: "dt1" },
      data: { isActive: true },
    });
    expect(out).toMatchObject({ id: "dt1", isActive: true });
  });

  it.each(["disable", "enable"] as const)("%s rejects a staff caller", async (proc) => {
    const prisma = makePrisma();
    await expect(callerFor(prisma, "STAFF")[proc]({ id: "dt1" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(prisma.damageTariff.update).not.toHaveBeenCalled();
  });

  it.each(["disable", "enable"] as const)("%s rejects an anonymous caller", async (proc) => {
    await expect(callerFor(makePrisma(), null)[proc]({ id: "dt1" })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it.each(["disable", "enable"] as const)("%s requires an id (Zod)", async (proc) => {
    const prisma = makePrisma();
    await expect(callerFor(prisma, "ADMIN")[proc]({} as never)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(prisma.damageTariff.update).not.toHaveBeenCalled();
  });
});
