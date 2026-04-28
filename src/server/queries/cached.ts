import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { cached as redisCached } from "@/lib/cache";
import { CACHE_TAGS } from "@/lib/cache-tags";
import {
  findCalendarMistakes,
  findTyreAlerts,
  type CalendarMistakes,
  type TyreAlert,
} from "@/server/services/staff-ops-signals";
import {
  debtorsSummary,
  incidentsSummary,
  theftsOpen,
  unpaidInfringementsSummary,
  type DebtorsSummary,
  type IncidentsSummary,
  type TheftsOpen,
  type UnpaidInfringementsSummary,
} from "@/server/services/admin-risk-signals";

export const getDepotList = cache(async () =>
  redisCached(
    "depot:list:active",
    3600,
    () =>
      prisma.depot.findMany({
        where: { isActive: true, deletedAt: null },
        orderBy: { name: "asc" },
        include: { operatingHours: true },
      }),
    [CACHE_TAGS.DEPOTS],
  ),
);

export const getDepotById = cache(async (id: string) =>
  redisCached(
    `depot:byId:${id}`,
    3600,
    () =>
      prisma.depot.findUnique({
        where: { id },
        include: { operatingHours: true },
      }),
    [CACHE_TAGS.DEPOTS],
  ),
);

export const getActiveCategories = cache(async () =>
  redisCached(
    "catalog:categories:active",
    3600,
    () =>
      prisma.vehicleCategory.findMany({
        where: { isActive: true },
        orderBy: { displayOrder: "asc" },
        select: { id: true, name: true, slug: true },
      }),
    [CACHE_TAGS.CATEGORIES],
  ),
);

const SIGNALS_TTL_SEC = 60;

export const getCalendarMistakes = cache(
  async (depotId?: string): Promise<CalendarMistakes> =>
    redisCached(
      `signals:calendar-mistakes:${depotId ?? "all"}`,
      SIGNALS_TTL_SEC,
      () => findCalendarMistakes(depotId),
      [CACHE_TAGS.DASHBOARD(depotId)],
    ),
);

export const getTyreAlerts = cache(
  async (depotId?: string): Promise<TyreAlert[]> =>
    redisCached(
      `signals:tyre-alerts:${depotId ?? "all"}`,
      SIGNALS_TTL_SEC,
      () => findTyreAlerts(depotId),
      [CACHE_TAGS.DASHBOARD(depotId)],
    ),
);

const RISK_TTL_SEC = 300;
const RISK_TAG = CACHE_TAGS.DASHBOARD("admin-risk");

export const getIncidentsSummary = cache(
  async (): Promise<IncidentsSummary> =>
    redisCached("signals:incidents-summary", RISK_TTL_SEC, () => incidentsSummary(), [RISK_TAG]),
);

export const getTheftsOpen = cache(
  async (): Promise<TheftsOpen> =>
    redisCached("signals:thefts-open", RISK_TTL_SEC, () => theftsOpen(), [RISK_TAG]),
);

export const getUnpaidInfringementsSummary = cache(
  async (): Promise<UnpaidInfringementsSummary> =>
    redisCached(
      "signals:unpaid-infringements",
      RISK_TTL_SEC,
      () => unpaidInfringementsSummary(),
      [RISK_TAG],
    ),
);

export const getDebtorsSummary = cache(
  async (): Promise<DebtorsSummary> =>
    redisCached("signals:debtors-summary", RISK_TTL_SEC, () => debtorsSummary(), [RISK_TAG]),
);
