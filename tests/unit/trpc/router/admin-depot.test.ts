import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/cache", () => ({ invalidateTag: vi.fn().mockResolvedValue(undefined) }));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));
vi.mock("@/lib/geo", () => ({ geocodeAddress: vi.fn().mockResolvedValue({ lat: -27.47, lng: 153.02 }) }));

const trackServerGroupIdentify = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/analytics", () => ({
  trackServerGroupIdentify: (...a: unknown[]) => trackServerGroupIdentify(...a),
}));

import { adminRouter } from "@/server/trpc/router/admin";

const DEPOT = {
  id: "d1",
  slug: "brisbane-cbd",
  name: "Brisbane CBD",
  state: "QLD",
  timezone: "Australia/Brisbane",
  isActive: true,
  maxCapacity: 50,
};

function makePrisma() {
  return {
    depot: {
      findUnique: vi.fn().mockResolvedValue(null), // slug is free
      findUniqueOrThrow: vi.fn().mockResolvedValue(DEPOT),
      create: vi.fn().mockResolvedValue(DEPOT),
      update: vi.fn().mockResolvedValue({ ...DEPOT, name: "Brisbane Central" }),
    },
  };
}

function adminCtx(prisma: unknown) {
  return {
    prisma,
    user: { id: "admin1", email: "admin@xpert.test", name: "Admin", role: "ADMIN", depotId: null },
    session: { user: { id: "admin1", email: "admin@xpert.test", name: "Admin", role: "ADMIN", depotId: null } },
    ipAddress: "127.0.0.1",
    userAgent: "test",
    reqId: "r1",
    headers: undefined,
  } as unknown as Parameters<typeof adminRouter.createCaller>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("admin.createDepot — PostHog group identify", () => {
  it("registers the depot group keyed on slug after create", async () => {
    const prisma = makePrisma();
    const caller = adminRouter.createCaller(adminCtx(prisma));
    await caller.createDepot({
      name: "Brisbane CBD",
      slug: "brisbane-cbd",
      addressLine1: "1 Queen St",
      suburb: "Brisbane",
      state: "QLD",
      postcode: "4000",
      timezone: "Australia/Brisbane",
    });

    expect(trackServerGroupIdentify).toHaveBeenCalledTimes(1);
    expect(trackServerGroupIdentify).toHaveBeenCalledWith({
      groupType: "depot",
      groupKey: "brisbane-cbd",
      set: {
        name: "Brisbane CBD",
        state: "QLD",
        timezone: "Australia/Brisbane",
        isActive: true,
        maxCapacity: 50,
      },
    });
  });
});

describe("admin.updateDepot — PostHog group identify", () => {
  it("re-identifies the depot group after update", async () => {
    const prisma = makePrisma();
    const caller = adminRouter.createCaller(adminCtx(prisma));
    await caller.updateDepot({ id: "d1", name: "Brisbane Central" });

    expect(trackServerGroupIdentify).toHaveBeenCalledTimes(1);
    expect(trackServerGroupIdentify.mock.calls[0]![0]).toMatchObject({
      groupType: "depot",
      groupKey: "brisbane-cbd",
    });
  });
});
