import { describe, expect, it } from "vitest";
import { routeTicket } from "../../../src/server/services/support-routing";
import type { PrismaClient } from "@prisma/client";

/**
 * Hand-rolled fake Prisma for the routing-service tests. Implements only
 * the calls made inside `routeTicket` so we can exercise every branch of
 * the depot/priority/channel matrix without a database.
 */
function makePrisma(overrides: Partial<FakePrismaState> = {}): PrismaClient {
  const state: FakePrismaState = {
    depot: {
      id: "depot-gc",
      timezone: "Australia/Brisbane",
      onCallUserId: "user-oncall",
    },
    operatingHours: {
      dayOfWeek: 1,
      openTime: "08:00",
      closeTime: "18:00",
      isClosed: false,
    },
    staff: [
      { id: "user-staff-1", openCount: 1 },
      { id: "user-staff-2", openCount: 5 },
    ],
    manager: { id: "user-mgr" },
    admins: [{ id: "user-admin" }],
    ...overrides,
  };

  const fake = {
    depot: {
      findUnique: async ({ where: { id } }: { where: { id: string } }) =>
        id === state.depot.id ? state.depot : null,
    },
    depotOperatingHours: {
      findFirst: async () => state.operatingHours,
    },
    user: {
      findMany: async (args: {
        where: { role?: unknown };
        select?: unknown;
      }) => {
        const role = (args.where.role as { in?: string[] } | undefined)?.in;
        if (role?.includes("STAFF") && role.includes("MANAGER")) {
          // staff pool for assignee picker
          return state.staff.map((s) => ({
            id: s.id,
            _count: { supportTicketsAsAssignee: s.openCount },
          }));
        }
        if (role?.includes("ADMIN")) {
          return state.admins;
        }
        return [];
      },
      findFirst: async () => state.manager,
    },
    booking: {
      findUnique: async () => null,
      findFirst: async () => null,
    },
  } as unknown as PrismaClient;
  return fake;
}

type FakePrismaState = {
  depot: { id: string; timezone: string; onCallUserId: string | null };
  operatingHours: {
    dayOfWeek: number;
    openTime: string;
    closeTime: string;
    isClosed: boolean;
  };
  staff: Array<{ id: string; openCount: number }>;
  manager: { id: string };
  admins: Array<{ id: string }>;
};

// Noon on a Monday, local tz.
const midday = new Date("2026-04-20T02:00:00Z"); // 12:00 AEST (UTC+10)
const midnight = new Date("2026-04-20T14:00:00Z"); // 00:00 AEST next day

describe("routeTicket", () => {
  it("BREAKDOWN at depot assigns the staff member with the fewest open tickets", async () => {
    const prisma = makePrisma();
    const out = await routeTicket(prisma, {
      category: "BREAKDOWN",
      body: "tyre is flat",
      summary: "flat tyre",
      explicitDepotId: "depot-gc",
      userMarkedUrgent: false,
      now: midday,
    });
    expect(out.depotId).toBe("depot-gc");
    expect(out.assigneeId).toBe("user-staff-1");
    expect(out.priority).toBe("HIGH");
    expect(out.outsideHours).toBe(false);
    expect(out.channels.toAssignee).toEqual(["EMAIL", "IN_APP"]);
    expect(out.channels.toOnCall).toEqual([]);
  });

  it("BREAKDOWN roadside language upgrades to URGENT + on-call SMS", async () => {
    const prisma = makePrisma();
    const out = await routeTicket(prisma, {
      category: "BREAKDOWN",
      body: "I'm stranded on the road, won't start",
      summary: "stranded",
      explicitDepotId: "depot-gc",
      now: midday,
    });
    expect(out.priority).toBe("URGENT");
    expect(out.channels.toAssignee).toContain("SMS");
    expect(out.channels.toOnCall).toContain("SMS");
  });

  it("URGENT out-of-hours adds EMAIL to on-call too", async () => {
    const prisma = makePrisma();
    const out = await routeTicket(prisma, {
      category: "BREAKDOWN",
      body: "stranded",
      summary: "stranded",
      explicitDepotId: "depot-gc",
      now: midnight,
    });
    expect(out.priority).toBe("URGENT");
    expect(out.outsideHours).toBe(true);
    expect(out.channels.toOnCall).toEqual(["SMS", "EMAIL"]);
  });

  it("PAYMENT tickets clear the depot and populate the admin pool", async () => {
    const prisma = makePrisma();
    const out = await routeTicket(prisma, {
      category: "PAYMENT",
      body: "please refund my booking",
      summary: "refund",
      explicitDepotId: "depot-gc",
      now: midday,
    });
    expect(out.priority).toBe("NORMAL");
    expect(out.assigneeId).toBeNull();
    expect(out.channels.toAdminPool).toEqual(["EMAIL", "IN_APP"]);
    expect(out.adminPoolUserIds).toContain("user-admin");
  });

  it("falls back to MANAGER if no onCallUserId is configured", async () => {
    const prisma = makePrisma({
      depot: { id: "depot-gc", timezone: "Australia/Brisbane", onCallUserId: null },
    });
    const out = await routeTicket(prisma, {
      category: "BREAKDOWN",
      body: "stranded",
      summary: "stranded",
      explicitDepotId: "depot-gc",
      now: midday,
    });
    expect(out.onCallUserId).toBe("user-mgr");
  });
});
