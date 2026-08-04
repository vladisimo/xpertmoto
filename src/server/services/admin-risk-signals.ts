import type { IncidentSeverity, IncidentType, Prisma, PrismaClient } from "@prisma/client";
import { prisma as sharedPrisma } from "@/lib/prisma";

export type PrismaLike = PrismaClient | Prisma.TransactionClient;

export type IncidentsSummary = {
  mtd: {
    total: number;
    byType: Record<IncidentType, number>;
    bySeverity: Record<IncidentSeverity, number>;
  };
  openTheft: number;
  trend12m: Array<{
    month: string;
    minor: number;
    moderate: number;
    major: number;
    totalLoss: number;
  }>;
};

const SEVERITIES: IncidentSeverity[] = ["MINOR", "MODERATE", "MAJOR", "TOTAL_LOSS"];
const TYPES: IncidentType[] = [
  "ACCIDENT",
  "THEFT",
  "VANDALISM",
  "BREAKDOWN",
  "CUSTOMER_DAMAGE",
  "WEATHER",
  "INFRINGEMENT",
  "OTHER",
];

export async function incidentsSummary(
  db: PrismaLike = sharedPrisma,
): Promise<IncidentsSummary> {
  // Prerender contract (cacheComponents): the current time may only be read
  // after the first uncached data access, or `next build` fails prerendering
  // /admin/dashboard/risk — issue the date-independent count first.
  const openThefts = await db.incident.count({
    where: { type: "THEFT", status: { notIn: ["RESOLVED", "CLOSED"] } },
  });
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);

  const [mtd, trendRows] = await Promise.all([
    db.incident.findMany({
      where: { dateTime: { gte: startOfMonth } },
      select: { type: true, severity: true },
    }),
    db.incident.findMany({
      where: { dateTime: { gte: twelveMonthsAgo } },
      select: { dateTime: true, severity: true },
    }),
  ]);

  const byType = Object.fromEntries(TYPES.map((t) => [t, 0])) as Record<IncidentType, number>;
  const bySeverity = Object.fromEntries(SEVERITIES.map((s) => [s, 0])) as Record<
    IncidentSeverity,
    number
  >;
  for (const i of mtd) {
    byType[i.type] = (byType[i.type] ?? 0) + 1;
    bySeverity[i.severity] = (bySeverity[i.severity] ?? 0) + 1;
  }

  const monthMap = new Map<string, { minor: number; moderate: number; major: number; totalLoss: number }>();
  for (let i = 0; i < 12; i++) {
    const d = new Date(twelveMonthsAgo.getFullYear(), twelveMonthsAgo.getMonth() + i, 1);
    monthMap.set(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, {
      minor: 0,
      moderate: 0,
      major: 0,
      totalLoss: 0,
    });
  }
  for (const r of trendRows) {
    const key = `${r.dateTime.getFullYear()}-${String(r.dateTime.getMonth() + 1).padStart(2, "0")}`;
    const bucket = monthMap.get(key);
    if (!bucket) continue;
    if (r.severity === "MINOR") bucket.minor += 1;
    else if (r.severity === "MODERATE") bucket.moderate += 1;
    else if (r.severity === "MAJOR") bucket.major += 1;
    else if (r.severity === "TOTAL_LOSS") bucket.totalLoss += 1;
  }

  return {
    mtd: { total: mtd.length, byType, bySeverity },
    openTheft: openThefts,
    trend12m: Array.from(monthMap.entries()).map(([month, v]) => ({ month, ...v })),
  };
}

export type TheftsOpen = {
  incidents: Array<{
    id: string;
    incidentNumber: string;
    dateTime: Date;
    status: string;
    vehicleCode: string;
    vehicleRego: string;
    customerName: string | null;
    estimatedCost: number;
  }>;
  stolenVehicles: Array<{ id: string; internalCode: string; rego: string; make: string; model: string }>;
};

export async function theftsOpen(db: PrismaLike = sharedPrisma): Promise<TheftsOpen> {
  const [incidents, stolenVehicles] = await Promise.all([
    db.incident.findMany({
      where: { type: "THEFT", status: { notIn: ["RESOLVED", "CLOSED"] } },
      orderBy: { dateTime: "desc" },
      include: {
        vehicle: { select: { internalCode: true, rego: true } },
        booking: { select: { customer: { select: { firstName: true, lastName: true } } } },
      },
    }),
    db.vehicle.findMany({
      where: { status: "STOLEN" },
      select: { id: true, internalCode: true, rego: true, make: true, model: true },
    }),
  ]);
  return {
    incidents: incidents.map((i) => ({
      id: i.id,
      incidentNumber: i.incidentNumber,
      dateTime: i.dateTime,
      status: i.status,
      vehicleCode: i.vehicle.internalCode,
      vehicleRego: i.vehicle.rego,
      customerName: i.booking?.customer
        ? `${i.booking.customer.firstName} ${i.booking.customer.lastName}`
        : null,
      estimatedCost: Number(i.estimatedDamageCost ?? 0),
    })),
    stolenVehicles,
  };
}

export type UnpaidInfringementsSummary = {
  totalAmount: number;
  totalCount: number;
  byType: Array<{ type: string; count: number; amount: number }>;
};

export async function unpaidInfringementsSummary(
  db: PrismaLike = sharedPrisma,
): Promise<UnpaidInfringementsSummary> {
  const rows = await db.infringement.groupBy({
    by: ["type"],
    where: { status: { notIn: ["PAID", "WRITTEN_OFF"] } },
    _sum: { amount: true },
    _count: true,
  });
  const byType = rows.map((r) => ({
    type: r.type,
    count: r._count,
    amount: Number(r._sum.amount ?? 0),
  }));
  return {
    totalAmount: byType.reduce((acc, r) => acc + r.amount, 0),
    totalCount: byType.reduce((acc, r) => acc + r.count, 0),
    byType,
  };
}

export type Debtor = {
  customerId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  bookingDebt: number;
  infringementDebt: number;
  invoiceDebt: number;
  totalOwed: number;
  lastReminderAt: Date | null;
};

export async function debtorsList(
  limit = 100,
  db: PrismaLike = sharedPrisma,
): Promise<Debtor[]> {
  const [bookingDebts, invoiceDebts, infringementDebts] = await Promise.all([
    db.booking.groupBy({
      by: ["customerId"],
      where: { balanceDue: { gt: 0 }, status: { notIn: ["CANCELLED", "NO_SHOW"] } },
      _sum: { balanceDue: true },
    }),
    db.invoice.groupBy({
      by: ["customerId"],
      where: { status: "OVERDUE", customerId: { not: null } },
      _sum: { totalAmount: true },
    }),
    db.infringement.groupBy({
      by: ["customerId"],
      where: { status: { notIn: ["PAID", "WRITTEN_OFF"] }, customerId: { not: null } },
      _sum: { amount: true },
    }),
  ]);

  const totals = new Map<string, { booking: number; invoice: number; infringement: number }>();
  const bumpBooking = (id: string, v: number) => {
    const t = totals.get(id) ?? { booking: 0, invoice: 0, infringement: 0 };
    t.booking += v;
    totals.set(id, t);
  };
  const bumpInvoice = (id: string, v: number) => {
    const t = totals.get(id) ?? { booking: 0, invoice: 0, infringement: 0 };
    t.invoice += v;
    totals.set(id, t);
  };
  const bumpInfr = (id: string, v: number) => {
    const t = totals.get(id) ?? { booking: 0, invoice: 0, infringement: 0 };
    t.infringement += v;
    totals.set(id, t);
  };
  for (const r of bookingDebts) bumpBooking(r.customerId, Number(r._sum.balanceDue ?? 0));
  for (const r of invoiceDebts) if (r.customerId) bumpInvoice(r.customerId, Number(r._sum.totalAmount ?? 0));
  for (const r of infringementDebts)
    if (r.customerId) bumpInfr(r.customerId, Number(r._sum.amount ?? 0));

  const ids = Array.from(totals.keys());
  if (ids.length === 0) return [];

  const [customers, reminders] = await Promise.all([
    db.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, firstName: true, lastName: true, email: true, phone: true },
    }),
    db.notification.findMany({
      where: { userId: { in: ids }, type: "DEBT_REMINDER" },
      orderBy: { createdAt: "desc" },
      select: { userId: true, createdAt: true },
    }),
  ]);

  const latestReminder = new Map<string, Date>();
  for (const n of reminders) {
    if (!latestReminder.has(n.userId)) latestReminder.set(n.userId, n.createdAt);
  }

  const debtors: Debtor[] = customers
    .map((c) => {
      const t = totals.get(c.id)!;
      return {
        customerId: c.id,
        firstName: c.firstName,
        lastName: c.lastName,
        email: c.email,
        phone: c.phone,
        bookingDebt: t.booking,
        infringementDebt: t.infringement,
        invoiceDebt: t.invoice,
        totalOwed: t.booking + t.infringement + t.invoice,
        lastReminderAt: latestReminder.get(c.id) ?? null,
      };
    })
    .filter((d) => d.totalOwed > 0)
    .sort((a, b) => b.totalOwed - a.totalOwed)
    .slice(0, limit);

  return debtors;
}

export type DebtorsSummary = {
  totalOwed: number;
  debtorCount: number;
  bookingPortion: number;
  invoicePortion: number;
  infringementPortion: number;
  remindedInLast7dCount: number;
};

export async function debtorsSummary(db: PrismaLike = sharedPrisma): Promise<DebtorsSummary> {
  const debtors = await debtorsList(500, db);
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000);
  return {
    totalOwed: debtors.reduce((a, d) => a + d.totalOwed, 0),
    debtorCount: debtors.length,
    bookingPortion: debtors.reduce((a, d) => a + d.bookingDebt, 0),
    invoicePortion: debtors.reduce((a, d) => a + d.invoiceDebt, 0),
    infringementPortion: debtors.reduce((a, d) => a + d.infringementDebt, 0),
    remindedInLast7dCount: debtors.filter((d) => d.lastReminderAt && d.lastReminderAt > sevenDaysAgo)
      .length,
  };
}
