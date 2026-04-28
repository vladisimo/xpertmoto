import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { ColumnDef, ExportFilter, ExportMeta } from "./index";
import { DEFAULT_BRAND } from "./index";

export interface ReportContext {
  userId: string | null;
  userRole: string;
  depotId: string | null;
}

export interface ReportResult<T> {
  rows: T[];
  meta: Partial<ExportMeta>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface ReportRegistration<TInput = any, TRow = any> {
  id: string;
  title: string;
  columns: ColumnDef<TRow>[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputSchema: z.ZodType<TInput, z.ZodTypeDef, any>;
  allowedRoles?: string[];
  fetch: (ctx: ReportContext, input: TInput) => Promise<ReportResult<TRow>>;
}

function dateRangeFilters(from: Date, to: Date, depotName?: string | null): ExportFilter[] {
  const filters: ExportFilter[] = [
    {
      label: "Period",
      value: `${from.toLocaleDateString("en-AU")} – ${to.toLocaleDateString("en-AU")}`,
    },
  ];
  if (depotName) filters.push({ label: "Depot", value: depotName });
  return filters;
}

async function resolveDepotName(depotId: string | null | undefined): Promise<string | null> {
  if (!depotId) return null;
  const d = await prisma.depot.findUnique({ where: { id: depotId }, select: { name: true } });
  return d?.name ?? null;
}

// ---------------------------------------------------------------------------
// Baseline input shape shared by most reports
// ---------------------------------------------------------------------------

const baseInput = z.object({
  from: z.string().transform((s) => new Date(s)),
  to: z.string().transform((s) => new Date(s)),
  depotId: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Report: finance.overview — migrates existing /api/admin/finance/export CSV
// ---------------------------------------------------------------------------

interface FinanceOverviewRow {
  reference: string;
  createdAt: Date;
  customer: string;
  email: string;
  depot: string;
  category: string;
  pickup: Date;
  return: Date;
  days: number;
  subtotal: number;
  addons: number;
  insurance: number;
  discount: number;
  gst: number;
  total: number;
  paid: number;
  balance: number;
  status: string;
}

const financeOverviewColumns: ColumnDef<FinanceOverviewRow>[] = [
  { key: "reference", header: "Reference", width: 18 },
  { key: "createdAt", header: "Created", format: "datetime", width: 16 },
  { key: "customer", header: "Customer", width: 22 },
  { key: "email", header: "Email", width: 22 },
  { key: "depot", header: "Depot", width: 18 },
  { key: "category", header: "Category", width: 18 },
  { key: "pickup", header: "Pickup", format: "datetime", width: 16 },
  { key: "return", header: "Return", format: "datetime", width: 16 },
  { key: "days", header: "Days", format: "number", width: 7 },
  { key: "subtotal", header: "Subtotal", format: "currency", width: 12, footer: "sum" },
  { key: "addons", header: "Add-ons", format: "currency", width: 12, footer: "sum" },
  { key: "insurance", header: "Insurance", format: "currency", width: 12, footer: "sum" },
  { key: "discount", header: "Discount", format: "currency", width: 12, footer: "sum" },
  { key: "gst", header: "GST", format: "currency", width: 12, footer: "sum" },
  { key: "total", header: "Total", format: "currency", width: 12, footer: "sum" },
  { key: "paid", header: "Paid", format: "currency", width: 12, footer: "sum" },
  { key: "balance", header: "Balance", format: "currency", width: 12, footer: "sum" },
  { key: "status", header: "Status", width: 14 },
];

const financeOverview: ReportRegistration<z.infer<typeof baseInput>, FinanceOverviewRow> = {
  id: "finance.overview",
  title: "Finance overview",
  columns: financeOverviewColumns,
  inputSchema: baseInput,
  allowedRoles: ["ADMIN", "SUPER_ADMIN"],
  async fetch(_ctx, input) {
    const where: Record<string, unknown> = { createdAt: { gte: input.from, lte: input.to } };
    if (input.depotId) where.depotId = input.depotId;
    const bookings = await prisma.booking.findMany({
      where,
      include: {
        customer: { select: { firstName: true, lastName: true, email: true } },
        category: { select: { name: true } },
        pickupDepot: { select: { name: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    const rows: FinanceOverviewRow[] = bookings.map((b) => ({
      reference: b.bookingReference,
      createdAt: b.createdAt,
      customer: `${b.customer.firstName} ${b.customer.lastName}`,
      email: b.customer.email,
      depot: b.pickupDepot.name,
      category: b.category.name,
      pickup: b.pickupDateTime,
      return: b.returnDateTime,
      days: b.durationDays,
      subtotal: Number(b.subtotal),
      addons: Number(b.addonTotal),
      insurance: Number(b.insuranceTotal),
      discount: Number(b.discountAmount),
      gst: Number(b.gstAmount),
      total: Number(b.totalAmount),
      paid: Number(b.amountPaid),
      balance: Number(b.balanceDue),
      status: b.status,
    }));
    const depotName = await resolveDepotName(input.depotId);
    return {
      rows,
      meta: {
        title: "Finance overview",
        subtitle: `${rows.length} bookings`,
        filters: dateRangeFilters(input.from, input.to, depotName),
        brand: DEFAULT_BRAND,
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Report: finance.transactions — Payment register export
// ---------------------------------------------------------------------------

interface TransactionRow {
  reference: string;
  createdAt: Date;
  type: string;
  method: string;
  status: string;
  amount: number;
  gst: number;
  bookingReference: string;
  customer: string;
}

const transactionColumns: ColumnDef<TransactionRow>[] = [
  { key: "reference", header: "Reference", width: 16 },
  { key: "createdAt", header: "Date", format: "datetime", width: 16 },
  { key: "type", header: "Type", width: 16 },
  { key: "method", header: "Method", width: 10 },
  { key: "status", header: "Status", width: 10 },
  { key: "amount", header: "Amount", format: "currency", width: 12, footer: "sum" },
  { key: "gst", header: "GST", format: "currency", width: 10, footer: "sum" },
  { key: "bookingReference", header: "Booking", width: 16 },
  { key: "customer", header: "Customer", width: 22 },
];

const financeTransactions: ReportRegistration<z.infer<typeof baseInput>, TransactionRow> = {
  id: "finance.transactions",
  title: "Transaction register",
  columns: transactionColumns,
  inputSchema: baseInput,
  allowedRoles: ["ADMIN", "SUPER_ADMIN"],
  async fetch(_ctx, input) {
    const where: Record<string, unknown> = { createdAt: { gte: input.from, lte: input.to } };
    if (input.depotId) where.booking = { depotId: input.depotId };
    const payments = await prisma.payment.findMany({
      where,
      include: {
        booking: { select: { bookingReference: true } },
        customer: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    const rows: TransactionRow[] = payments.map((p) => ({
      reference: p.reference,
      createdAt: p.createdAt,
      type: p.type,
      method: p.method,
      status: p.status,
      amount: Number(p.amount),
      gst: Number(p.gstAmount),
      bookingReference: p.booking?.bookingReference ?? "",
      customer: p.customer ? `${p.customer.firstName} ${p.customer.lastName}` : "",
    }));
    const depotName = await resolveDepotName(input.depotId);
    return {
      rows,
      meta: {
        title: "Transaction register",
        subtitle: `${rows.length} payments`,
        filters: dateRangeFilters(input.from, input.to, depotName),
        brand: DEFAULT_BRAND,
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Report: finance.invoices
// ---------------------------------------------------------------------------

interface InvoiceRow {
  invoiceNumber: string;
  status: string;
  customer: string;
  bookingReference: string;
  subtotal: number;
  gstAmount: number;
  totalAmount: number;
  creditNoteTotal: number;
  dueDate: Date | null;
  sentAt: Date | null;
  paidAt: Date | null;
}

const invoiceColumns: ColumnDef<InvoiceRow>[] = [
  { key: "invoiceNumber", header: "Number", width: 16 },
  { key: "customer", header: "Customer", width: 22 },
  { key: "bookingReference", header: "Booking", width: 16 },
  { key: "subtotal", header: "Subtotal", format: "currency", width: 12, footer: "sum" },
  { key: "gstAmount", header: "GST", format: "currency", width: 10, footer: "sum" },
  { key: "totalAmount", header: "Total", format: "currency", width: 12, footer: "sum" },
  { key: "creditNoteTotal", header: "Credited", format: "currency", width: 12, footer: "sum" },
  { key: "status", header: "Status", width: 10 },
  { key: "dueDate", header: "Due", format: "date", width: 12 },
  { key: "sentAt", header: "Sent", format: "datetime", width: 16 },
  { key: "paidAt", header: "Paid", format: "datetime", width: 16 },
];

const financeInvoices: ReportRegistration<z.infer<typeof baseInput>, InvoiceRow> = {
  id: "finance.invoices",
  title: "Invoices",
  columns: invoiceColumns,
  inputSchema: baseInput,
  allowedRoles: ["ADMIN", "SUPER_ADMIN"],
  async fetch(_ctx, input) {
    const where: Record<string, unknown> = { createdAt: { gte: input.from, lte: input.to } };
    if (input.depotId) where.booking = { depotId: input.depotId };
    const invoices = await prisma.invoice.findMany({
      where,
      include: {
        booking: {
          select: {
            bookingReference: true,
            customer: { select: { firstName: true, lastName: true } },
          },
        },
        creditNotes: { select: { amount: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    const rows: InvoiceRow[] = invoices.map((i) => ({
      invoiceNumber: i.invoiceNumber,
      status: i.status,
      customer: i.booking?.customer
        ? `${i.booking.customer.firstName} ${i.booking.customer.lastName}`
        : "",
      bookingReference: i.booking?.bookingReference ?? "",
      subtotal: Number(i.subtotal),
      gstAmount: Number(i.gstAmount),
      totalAmount: Number(i.totalAmount),
      creditNoteTotal: i.creditNotes.reduce((a, c) => a + Number(c.amount), 0),
      dueDate: i.dueDate,
      sentAt: i.sentAt,
      paidAt: i.paidAt,
    }));
    const depotName = await resolveDepotName(input.depotId);
    return {
      rows,
      meta: {
        title: "Invoices",
        subtitle: `${rows.length} invoices`,
        filters: dateRangeFilters(input.from, input.to, depotName),
        brand: DEFAULT_BRAND,
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Report: finance.bonds
// ---------------------------------------------------------------------------

interface BondRow {
  bookingReference: string;
  customer: string;
  status: string;
  heldAmount: number;
  capturedAmount: number;
  releasedAmount: number;
  createdAt: Date;
}

const bondColumns: ColumnDef<BondRow>[] = [
  { key: "bookingReference", header: "Booking", width: 16 },
  { key: "customer", header: "Customer", width: 22 },
  { key: "status", header: "Status", width: 14 },
  { key: "heldAmount", header: "Held", format: "currency", width: 12, footer: "sum" },
  { key: "capturedAmount", header: "Captured", format: "currency", width: 12, footer: "sum" },
  { key: "releasedAmount", header: "Released", format: "currency", width: 12, footer: "sum" },
  { key: "createdAt", header: "Created", format: "datetime", width: 16 },
];

const financeBonds: ReportRegistration<z.infer<typeof baseInput>, BondRow> = {
  id: "finance.bonds",
  title: "Bond ledger",
  columns: bondColumns,
  inputSchema: baseInput,
  allowedRoles: ["ADMIN", "SUPER_ADMIN"],
  async fetch(_ctx, input) {
    const where: Record<string, unknown> = { createdAt: { gte: input.from, lte: input.to } };
    if (input.depotId) where.booking = { depotId: input.depotId };
    const bonds = await prisma.bondLedger.findMany({
      where,
      include: {
        booking: {
          select: {
            bookingReference: true,
            customer: { select: { firstName: true, lastName: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    const rows: BondRow[] = bonds.map((b) => ({
      bookingReference: b.booking?.bookingReference ?? "",
      customer: b.booking?.customer
        ? `${b.booking.customer.firstName} ${b.booking.customer.lastName}`
        : "",
      status: b.status,
      heldAmount: Number(b.heldAmount),
      capturedAmount: Number(b.capturedAmount),
      releasedAmount: Number(b.releasedAmount),
      createdAt: b.createdAt,
    }));
    const depotName = await resolveDepotName(input.depotId);
    return {
      rows,
      meta: {
        title: "Bond ledger",
        subtitle: `${rows.length} bonds`,
        filters: dateRangeFilters(input.from, input.to, depotName),
        brand: DEFAULT_BRAND,
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Report: finance.gst
// ---------------------------------------------------------------------------

interface GstRow {
  depotName: string;
  revenueInc: number;
  revenueEx: number;
  gst: number;
}

const gstColumns: ColumnDef<GstRow>[] = [
  { key: "depotName", header: "Depot", width: 20 },
  { key: "revenueInc", header: "Revenue (inc)", format: "currency", width: 14, footer: "sum" },
  { key: "revenueEx", header: "Revenue (ex)", format: "currency", width: 14, footer: "sum" },
  { key: "gst", header: "GST", format: "currency", width: 12, footer: "sum" },
];

const financeGst: ReportRegistration<z.infer<typeof baseInput>, GstRow> = {
  id: "finance.gst",
  title: "GST / BAS",
  columns: gstColumns,
  inputSchema: baseInput,
  allowedRoles: ["ADMIN", "SUPER_ADMIN"],
  async fetch(_ctx, input) {
    const where: Record<string, unknown> = {
      createdAt: { gte: input.from, lte: input.to },
      status: { notIn: ["CANCELLED", "NO_SHOW"] },
    };
    if (input.depotId) where.depotId = input.depotId;
    const byDepotRaw = await prisma.booking.groupBy({
      by: ["depotId"],
      where: where as never,
      _sum: { totalAmount: true, gstAmount: true },
    });
    const depots = await prisma.depot.findMany({
      where: { id: { in: byDepotRaw.map((d) => d.depotId) } },
      select: { id: true, name: true },
    });
    const nameOf = new Map(depots.map((d) => [d.id, d.name]));
    const rows: GstRow[] = byDepotRaw.map((d) => {
      const revenueInc = Number(d._sum.totalAmount ?? 0);
      const gst = Number(d._sum.gstAmount ?? 0);
      return {
        depotName: nameOf.get(d.depotId) ?? "Unknown",
        revenueInc,
        revenueEx: revenueInc - gst,
        gst,
      };
    });
    const depotName = await resolveDepotName(input.depotId);
    return {
      rows,
      meta: {
        title: "GST / BAS summary",
        subtitle: `${rows.length} depots`,
        filters: dateRangeFilters(input.from, input.to, depotName),
        brand: DEFAULT_BRAND,
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Report: finance.reconciliation
// ---------------------------------------------------------------------------

interface ReconciliationRow {
  bucket: string;
  stripeGross: number;
  bookGross: number;
  refunds: number;
  variance: number;
}

const reconColumns: ColumnDef<ReconciliationRow>[] = [
  { key: "bucket", header: "Source", width: 20 },
  { key: "stripeGross", header: "Stripe gross", format: "currency", width: 14, footer: "sum" },
  { key: "bookGross", header: "Book gross", format: "currency", width: 14, footer: "sum" },
  { key: "refunds", header: "Refunds", format: "currency", width: 12, footer: "sum" },
  { key: "variance", header: "Variance", format: "currency", width: 12, footer: "sum" },
];

const financeReconciliation: ReportRegistration<z.infer<typeof baseInput>, ReconciliationRow> = {
  id: "finance.reconciliation",
  title: "Reconciliation",
  columns: reconColumns,
  inputSchema: baseInput,
  allowedRoles: ["ADMIN", "SUPER_ADMIN"],
  async fetch(_ctx, input) {
    const whereSt: Record<string, unknown> = {
      createdAt: { gte: input.from, lte: input.to },
      status: "SUCCEEDED",
      stripeChargeId: { not: null },
    };
    const whereAll: Record<string, unknown> = {
      createdAt: { gte: input.from, lte: input.to },
      status: "SUCCEEDED",
    };
    if (input.depotId) {
      whereSt.booking = { depotId: input.depotId };
      whereAll.booking = { depotId: input.depotId };
    }
    const [stripe, book, refunds] = await Promise.all([
      prisma.payment.aggregate({ where: whereSt as never, _sum: { amount: true } }),
      prisma.payment.aggregate({ where: whereAll as never, _sum: { amount: true } }),
      prisma.payment.aggregate({
        where: { type: "REFUND", createdAt: { gte: input.from, lte: input.to } },
        _sum: { amount: true },
      }),
    ]);
    const stripeGross = Number(stripe._sum.amount ?? 0);
    const bookGross = Number(book._sum.amount ?? 0);
    const rows: ReconciliationRow[] = [
      {
        bucket: "Period total",
        stripeGross,
        bookGross,
        refunds: Number(refunds._sum.amount ?? 0),
        variance: bookGross - stripeGross,
      },
    ];
    const depotName = await resolveDepotName(input.depotId);
    return {
      rows,
      meta: {
        title: "Reconciliation",
        subtitle: `Stripe vs book-side`,
        filters: dateRangeFilters(input.from, input.to, depotName),
        brand: DEFAULT_BRAND,
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Reports — minimal export shapes (rows built by tRPC procedures)
// ---------------------------------------------------------------------------

const bookingsByPeriodInput = z
  .object({
    from: z.string().transform((s) => new Date(s)),
    to: z.string().transform((s) => new Date(s)),
    period: z.enum(["day", "week", "month"]).default("day"),
  });

const bookingsByPeriod: ReportRegistration<
  z.infer<typeof bookingsByPeriodInput>,
  { key: string; count: number; revenue: number }
> = {
  id: "bookings.byPeriod",
  title: "Bookings by period",
  columns: [
    { key: "key", header: "Period", width: 14 },
    { key: "count", header: "Bookings", format: "number", width: 10, footer: "sum" },
    { key: "revenue", header: "Revenue", format: "currency", width: 14, footer: "sum" },
  ],
  inputSchema: bookingsByPeriodInput,
  async fetch(_ctx, input) {
    const bookings = await prisma.booking.findMany({
      where: { createdAt: { gte: input.from, lte: input.to } },
      select: { createdAt: true, totalAmount: true },
    });
    const buckets = new Map<string, { revenue: number; count: number }>();
    for (const b of bookings) {
      let key: string;
      if (input.period === "day") key = b.createdAt.toISOString().slice(0, 10);
      else if (input.period === "week") {
        const d = new Date(b.createdAt);
        const day = d.getDay();
        d.setDate(d.getDate() - day);
        key = d.toISOString().slice(0, 10);
      } else key = b.createdAt.toISOString().slice(0, 7);
      const e = buckets.get(key) ?? { revenue: 0, count: 0 };
      e.revenue += Number(b.totalAmount);
      e.count += 1;
      buckets.set(key, e);
    }
    const rows = [...buckets.entries()]
      .map(([k, v]) => ({ key: k, ...v }))
      .sort((a, b) => a.key.localeCompare(b.key));
    return {
      rows,
      meta: {
        title: "Bookings by period",
        subtitle: `Bucketed by ${input.period}`,
        filters: dateRangeFilters(input.from, input.to),
        brand: DEFAULT_BRAND,
      },
    };
  },
};

const bySourceReport: ReportRegistration<
  z.infer<typeof baseInput>,
  { source: string; count: number; revenue: number; share: number }
> = {
  id: "bookings.bySource",
  title: "Bookings by source",
  columns: [
    { key: "source", header: "Source", width: 16 },
    { key: "count", header: "Bookings", format: "number", width: 10, footer: "sum" },
    { key: "revenue", header: "Revenue", format: "currency", width: 14, footer: "sum" },
    { key: "share", header: "Share", format: "percent", width: 10 },
  ],
  inputSchema: baseInput,
  async fetch(_ctx, input) {
    const grouped = await prisma.booking.groupBy({
      by: ["source"],
      where: {
        createdAt: { gte: input.from, lte: input.to },
        ...(input.depotId ? { depotId: input.depotId } : {}),
      },
      _count: true,
      _sum: { totalAmount: true },
    });
    const total = grouped.reduce((a, g) => a + g._count, 0);
    const rows = grouped.map((g) => ({
      source: g.source,
      count: g._count,
      revenue: Number(g._sum.totalAmount ?? 0),
      share: total > 0 ? g._count / total : 0,
    }));
    const depotName = await resolveDepotName(input.depotId);
    return {
      rows,
      meta: {
        title: "Bookings by source",
        filters: dateRangeFilters(input.from, input.to, depotName),
        brand: DEFAULT_BRAND,
      },
    };
  },
};

const cancellationsReport: ReportRegistration<
  z.infer<typeof baseInput>,
  { reason: string; count: number; lostRevenue: number; avgLeadDays: number }
> = {
  id: "bookings.cancellations",
  title: "Cancellation analysis",
  columns: [
    { key: "reason", header: "Reason", width: 30 },
    { key: "count", header: "Count", format: "number", width: 10, footer: "sum" },
    { key: "lostRevenue", header: "Lost revenue", format: "currency", width: 14, footer: "sum" },
    { key: "avgLeadDays", header: "Avg lead (d)", format: "number", width: 12 },
  ],
  inputSchema: baseInput,
  async fetch(_ctx, input) {
    const cancellations = await prisma.booking.findMany({
      where: {
        status: { in: ["CANCELLED", "NO_SHOW"] },
        updatedAt: { gte: input.from, lte: input.to },
        ...(input.depotId ? { depotId: input.depotId } : {}),
      },
      select: { createdAt: true, pickupDateTime: true, cancellationReason: true, totalAmount: true, status: true },
    });
    const byReason = new Map<string, { count: number; lostRevenue: number; totalLeadMs: number }>();
    for (const b of cancellations) {
      const key = b.cancellationReason ?? (b.status === "NO_SHOW" ? "No-show" : "Unspecified");
      const e = byReason.get(key) ?? { count: 0, lostRevenue: 0, totalLeadMs: 0 };
      e.count += 1;
      e.lostRevenue += Number(b.totalAmount);
      e.totalLeadMs += Math.max(0, b.pickupDateTime.getTime() - b.createdAt.getTime());
      byReason.set(key, e);
    }
    const rows = [...byReason.entries()]
      .map(([reason, v]) => ({
        reason,
        count: v.count,
        lostRevenue: v.lostRevenue,
        avgLeadDays: v.count > 0 ? v.totalLeadMs / v.count / 86400000 : 0,
      }))
      .sort((a, b) => b.count - a.count);
    const depotName = await resolveDepotName(input.depotId);
    return {
      rows,
      meta: {
        title: "Cancellation analysis",
        filters: dateRangeFilters(input.from, input.to, depotName),
        brand: DEFAULT_BRAND,
      },
    };
  },
};

const fleetUtilReport: ReportRegistration<
  z.infer<typeof baseInput>,
  { code: string; category: string; depot: string; bookingCount: number; utilisation: number; revenue: number }
> = {
  id: "fleet.utilisation",
  title: "Fleet utilisation",
  columns: [
    { key: "code", header: "Vehicle", width: 12 },
    { key: "category", header: "Category", width: 18 },
    { key: "depot", header: "Depot", width: 18 },
    { key: "bookingCount", header: "Bookings", format: "number", width: 10, footer: "sum" },
    { key: "utilisation", header: "Util %", format: "number", width: 10 },
    { key: "revenue", header: "Revenue", format: "currency", width: 14, footer: "sum" },
  ],
  inputSchema: baseInput,
  async fetch(_ctx, input) {
    const vehicles = await prisma.vehicle.findMany({
      where: { isActive: true, ...(input.depotId ? { depotId: input.depotId } : {}) },
      include: {
        category: true,
        depot: true,
        bookings: {
          where: {
            status: { in: ["CONFIRMED", "CHECKED_OUT", "ACTIVE", "COMPLETED"] },
            pickupDateTime: { lt: input.to },
            returnDateTime: { gt: input.from },
          },
          select: { pickupDateTime: true, returnDateTime: true, totalAmount: true },
        },
      },
    });
    const periodMs = input.to.getTime() - input.from.getTime();
    const rows = vehicles
      .map((v) => {
        const rentedMs = v.bookings.reduce((sum, b) => {
          const start = Math.max(b.pickupDateTime.getTime(), input.from.getTime());
          const end = Math.min(b.returnDateTime.getTime(), input.to.getTime());
          return sum + Math.max(0, end - start);
        }, 0);
        return {
          code: v.internalCode,
          category: v.category.name,
          depot: v.depot.name,
          bookingCount: v.bookings.length,
          utilisation: Math.round((rentedMs / periodMs) * 100),
          revenue: v.bookings.reduce((s, b) => s + Number(b.totalAmount), 0),
        };
      })
      .sort((a, b) => b.utilisation - a.utilisation);
    const depotName = await resolveDepotName(input.depotId);
    return {
      rows,
      meta: {
        title: "Fleet utilisation",
        filters: dateRangeFilters(input.from, input.to, depotName),
        brand: DEFAULT_BRAND,
      },
    };
  },
};

const revenuePerVehicleReport: ReportRegistration<
  z.infer<typeof baseInput>,
  { code: string; category: string; depot: string; rentals: number; days: number; revenue: number; avgPerDay: number }
> = {
  id: "fleet.revenuePerVehicle",
  title: "Revenue per vehicle",
  columns: [
    { key: "code", header: "Vehicle", width: 12 },
    { key: "category", header: "Category", width: 18 },
    { key: "depot", header: "Depot", width: 18 },
    { key: "rentals", header: "Rentals", format: "number", width: 10, footer: "sum" },
    { key: "days", header: "Days", format: "number", width: 8, footer: "sum" },
    { key: "revenue", header: "Revenue", format: "currency", width: 14, footer: "sum" },
    { key: "avgPerDay", header: "$/day", format: "currency", width: 12 },
  ],
  inputSchema: baseInput,
  async fetch(_ctx, input) {
    const vehicles = await prisma.vehicle.findMany({
      where: { isActive: true, ...(input.depotId ? { depotId: input.depotId } : {}) },
      include: {
        category: true,
        depot: true,
        bookings: {
          where: {
            status: { in: ["CONFIRMED", "CHECKED_OUT", "ACTIVE", "COMPLETED"] },
            createdAt: { gte: input.from, lte: input.to },
          },
          select: { totalAmount: true, durationDays: true },
        },
      },
    });
    const rows = vehicles
      .map((v) => {
        const rentalDays = v.bookings.reduce((a, b) => a + (b.durationDays ?? 0), 0);
        const revenue = v.bookings.reduce((a, b) => a + Number(b.totalAmount), 0);
        return {
          code: v.internalCode,
          category: v.category.name,
          depot: v.depot.name,
          rentals: v.bookings.length,
          days: rentalDays,
          revenue,
          avgPerDay: rentalDays > 0 ? revenue / rentalDays : 0,
        };
      })
      .sort((a, b) => b.revenue - a.revenue);
    const depotName = await resolveDepotName(input.depotId);
    return {
      rows,
      meta: {
        title: "Revenue per vehicle",
        filters: dateRangeFilters(input.from, input.to, depotName),
        brand: DEFAULT_BRAND,
      },
    };
  },
};

const topCustomersInput = z.object({}).passthrough();

const topCustomersReport: ReportRegistration<
  z.infer<typeof topCustomersInput>,
  { name: string; email: string; bookings: number; spend: number }
> = {
  id: "customers.top",
  title: "Top customers",
  columns: [
    { key: "name", header: "Customer", width: 22 },
    { key: "email", header: "Email", width: 26 },
    { key: "bookings", header: "Bookings", format: "number", width: 10, footer: "sum" },
    { key: "spend", header: "Lifetime spend", format: "currency", width: 16, footer: "sum" },
  ],
  inputSchema: topCustomersInput,
  async fetch() {
    const users = await prisma.user.findMany({
      where: { role: "CUSTOMER" },
      select: {
        firstName: true,
        lastName: true,
        email: true,
        bookings: {
          where: { status: { notIn: ["CANCELLED", "NO_SHOW"] } },
          select: { totalAmount: true },
        },
      },
      take: 500,
    });
    const rows = users
      .map((u) => ({
        name: `${u.firstName} ${u.lastName}`,
        email: u.email,
        bookings: u.bookings.length,
        spend: u.bookings.reduce((s, b) => s + Number(b.totalAmount), 0),
      }))
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 50);
    return {
      rows,
      meta: {
        title: "Top customers by lifetime spend",
        filters: [],
        brand: DEFAULT_BRAND,
      },
    };
  },
};

const newVsReturningReport: ReportRegistration<
  { from: Date; to: Date },
  { month: string; newCount: number; returningCount: number; ratio: number }
> = {
  id: "customers.newVsReturning",
  title: "New vs returning",
  columns: [
    { key: "month", header: "Month", width: 10 },
    { key: "newCount", header: "New", format: "number", width: 10, footer: "sum" },
    { key: "returningCount", header: "Returning", format: "number", width: 12, footer: "sum" },
    { key: "ratio", header: "New share", format: "percent", width: 12 },
  ],
  inputSchema: z.object({
    from: z.string().transform((s) => new Date(s)),
    to: z.string().transform((s) => new Date(s)),
  }),
  async fetch(_ctx, input) {
    const bookings = await prisma.booking.findMany({
      where: { createdAt: { gte: input.from, lte: input.to } },
      select: { createdAt: true, customer: { select: { createdAt: true } } },
    });
    const byMonth = new Map<string, { newCount: number; returningCount: number }>();
    for (const b of bookings) {
      const key = b.createdAt.toISOString().slice(0, 7);
      const e = byMonth.get(key) ?? { newCount: 0, returningCount: 0 };
      const isNew =
        b.customer && b.customer.createdAt.getTime() >= b.createdAt.getTime() - 30 * 86400000;
      if (isNew) e.newCount += 1;
      else e.returningCount += 1;
      byMonth.set(key, e);
    }
    const rows = [...byMonth.entries()]
      .map(([month, v]) => ({
        month,
        newCount: v.newCount,
        returningCount: v.returningCount,
        ratio:
          v.newCount + v.returningCount > 0 ? v.newCount / (v.newCount + v.returningCount) : 0,
      }))
      .sort((a, b) => a.month.localeCompare(b.month));
    return {
      rows,
      meta: {
        title: "New vs returning",
        filters: dateRangeFilters(input.from, input.to),
        brand: DEFAULT_BRAND,
      },
    };
  },
};

const agingReport: ReportRegistration<
  { depotId?: string },
  { bookingReference: string; customer: string; balance: number; pickupDate: Date; ageBucket: string }
> = {
  id: "financial.aging",
  title: "Outstanding aging",
  columns: [
    { key: "bookingReference", header: "Booking", width: 14 },
    { key: "customer", header: "Customer", width: 22 },
    { key: "pickupDate", header: "Pickup", format: "date", width: 12 },
    { key: "ageBucket", header: "Age", width: 10 },
    { key: "balance", header: "Balance", format: "currency", width: 14, footer: "sum" },
  ],
  inputSchema: z.object({ depotId: z.string().optional() }).passthrough(),
  async fetch(_ctx, input) {
    const now = new Date();
    const bookings = await prisma.booking.findMany({
      where: {
        balanceDue: { gt: 0 },
        status: { notIn: ["CANCELLED"] },
        ...(input.depotId ? { depotId: input.depotId } : {}),
      },
      select: {
        bookingReference: true,
        balanceDue: true,
        pickupDateTime: true,
        customer: { select: { firstName: true, lastName: true } },
      },
    });
    const d30 = now.getTime() - 30 * 86400000;
    const d60 = now.getTime() - 60 * 86400000;
    const d90 = now.getTime() - 90 * 86400000;
    const rows = bookings
      .map((b) => {
        const t = b.pickupDateTime.getTime();
        const bucket = t >= d30 ? "0-30" : t >= d60 ? "31-60" : t >= d90 ? "61-90" : "90+";
        return {
          bookingReference: b.bookingReference,
          customer: b.customer ? `${b.customer.firstName} ${b.customer.lastName}` : "",
          balance: Number(b.balanceDue),
          pickupDate: b.pickupDateTime,
          ageBucket: bucket,
        };
      })
      .sort((a, b) => b.balance - a.balance);
    const depotName = await resolveDepotName(input.depotId);
    return {
      rows,
      meta: {
        title: "Outstanding aging",
        filters: depotName ? [{ label: "Depot", value: depotName }] : [],
        brand: DEFAULT_BRAND,
      },
    };
  },
};

const refundsReport: ReportRegistration<
  { from: Date; to: Date },
  { month: string; count: number; amount: number; share: number }
> = {
  id: "financial.refundAnalysis",
  title: "Refund analysis",
  columns: [
    { key: "month", header: "Month", width: 10 },
    { key: "count", header: "Count", format: "number", width: 10, footer: "sum" },
    { key: "amount", header: "Amount", format: "currency", width: 14, footer: "sum" },
    { key: "share", header: "% of revenue", format: "percent", width: 14 },
  ],
  inputSchema: z.object({
    from: z.string().transform((s) => new Date(s)),
    to: z.string().transform((s) => new Date(s)),
  }),
  async fetch(_ctx, input) {
    const [refunds, revenue] = await Promise.all([
      prisma.payment.findMany({
        where: { type: "REFUND", createdAt: { gte: input.from, lte: input.to } },
        select: { amount: true, createdAt: true },
      }),
      prisma.booking.aggregate({
        where: { createdAt: { gte: input.from, lte: input.to } },
        _sum: { totalAmount: true },
      }),
    ]);
    const byMonth = new Map<string, { count: number; amount: number }>();
    for (const r of refunds) {
      const key = r.createdAt.toISOString().slice(0, 7);
      const e = byMonth.get(key) ?? { count: 0, amount: 0 };
      e.count += 1;
      e.amount += Number(r.amount);
      byMonth.set(key, e);
    }
    const totalRev = Number(revenue._sum.totalAmount ?? 0);
    const rows = [...byMonth.entries()]
      .map(([month, v]) => ({
        month,
        count: v.count,
        amount: v.amount,
        share: totalRev > 0 ? v.amount / totalRev : 0,
      }))
      .sort((a, b) => a.month.localeCompare(b.month));
    return {
      rows,
      meta: {
        title: "Refund analysis",
        filters: dateRangeFilters(input.from, input.to),
        brand: DEFAULT_BRAND,
      },
    };
  },
};

const incidentFreqReport: ReportRegistration<
  { from: Date; to: Date },
  { month: string; total: number; MINOR: number; MODERATE: number; MAJOR: number; TOTAL_LOSS: number }
> = {
  id: "operational.incidentFrequency",
  title: "Incident frequency",
  columns: [
    { key: "month", header: "Month", width: 10 },
    { key: "total", header: "Total", format: "number", width: 8, footer: "sum" },
    { key: "MINOR", header: "Minor", format: "number", width: 8, footer: "sum" },
    { key: "MODERATE", header: "Moderate", format: "number", width: 10, footer: "sum" },
    { key: "MAJOR", header: "Major", format: "number", width: 8, footer: "sum" },
    { key: "TOTAL_LOSS", header: "Total loss", format: "number", width: 10, footer: "sum" },
  ],
  inputSchema: z.object({
    from: z.string().transform((s) => new Date(s)),
    to: z.string().transform((s) => new Date(s)),
  }),
  async fetch(_ctx, input) {
    const incidents = await prisma.incident.findMany({
      where: { createdAt: { gte: input.from, lte: input.to } },
      select: { createdAt: true, severity: true },
    });
    const byMonth = new Map<string, { total: number; MINOR: number; MODERATE: number; MAJOR: number; TOTAL_LOSS: number }>();
    for (const i of incidents) {
      const key = i.createdAt.toISOString().slice(0, 7);
      const e = byMonth.get(key) ?? { total: 0, MINOR: 0, MODERATE: 0, MAJOR: 0, TOTAL_LOSS: 0 };
      e.total += 1;
      e[i.severity as keyof typeof e] = (e[i.severity as keyof typeof e] ?? 0) + 1;
      byMonth.set(key, e);
    }
    const rows = [...byMonth.entries()]
      .map(([month, v]) => ({ month, ...v }))
      .sort((a, b) => a.month.localeCompare(b.month));
    return {
      rows,
      meta: {
        title: "Incident frequency",
        filters: dateRangeFilters(input.from, input.to),
        brand: DEFAULT_BRAND,
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Extended reports (16 additional)
// ---------------------------------------------------------------------------

const fromToInput = z.object({
  from: z.string().transform((s) => new Date(s)),
  to: z.string().transform((s) => new Date(s)),
});

const fromToDepotInput = z.object({
  from: z.string().transform((s) => new Date(s)),
  to: z.string().transform((s) => new Date(s)),
  depotId: z.string().optional(),
});

const leadTimeReport: ReportRegistration<
  z.infer<typeof fromToDepotInput>,
  { bucket: string; count: number; share: number }
> = {
  id: "bookings.leadTime",
  title: "Booking lead time",
  columns: [
    { key: "bucket", header: "Lead time", width: 12 },
    { key: "count", header: "Bookings", format: "number", width: 10, footer: "sum" },
    { key: "share", header: "Share", format: "percent", width: 10 },
  ],
  inputSchema: fromToDepotInput,
  async fetch(_ctx, input) {
    const bookings = await prisma.booking.findMany({
      where: {
        createdAt: { gte: input.from, lte: input.to },
        ...(input.depotId ? { depotId: input.depotId } : {}),
      },
      select: { createdAt: true, pickupDateTime: true },
    });
    const buckets: Record<string, number> = { "0-1d": 0, "2-7d": 0, "8-30d": 0, "31-90d": 0, "90d+": 0 };
    for (const b of bookings) {
      const days = (b.pickupDateTime.getTime() - b.createdAt.getTime()) / 86400000;
      if (days < 2) buckets["0-1d"]!++;
      else if (days < 8) buckets["2-7d"]!++;
      else if (days < 31) buckets["8-30d"]!++;
      else if (days < 91) buckets["31-90d"]!++;
      else buckets["90d+"]!++;
    }
    const total = bookings.length;
    const depotName = await resolveDepotName(input.depotId);
    return {
      rows: Object.entries(buckets).map(([bucket, count]) => ({
        bucket,
        count,
        share: total > 0 ? count / total : 0,
      })),
      meta: { title: "Booking lead time", filters: dateRangeFilters(input.from, input.to, depotName), brand: DEFAULT_BRAND },
    };
  },
};

const noShowReport: ReportRegistration<
  z.infer<typeof fromToDepotInput>,
  { month: string; bookings: number; noShows: number; rate: number }
> = {
  id: "bookings.noShow",
  title: "No-show rate",
  columns: [
    { key: "month", header: "Month", width: 10 },
    { key: "bookings", header: "Bookings", format: "number", width: 10, footer: "sum" },
    { key: "noShows", header: "No-shows", format: "number", width: 10, footer: "sum" },
    { key: "rate", header: "Rate", format: "percent", width: 10 },
  ],
  inputSchema: fromToDepotInput,
  async fetch(_ctx, input) {
    const bookings = await prisma.booking.findMany({
      where: {
        createdAt: { gte: input.from, lte: input.to },
        ...(input.depotId ? { depotId: input.depotId } : {}),
      },
      select: { createdAt: true, status: true },
    });
    const byMonth = new Map<string, { bookings: number; noShows: number }>();
    for (const b of bookings) {
      const key = b.createdAt.toISOString().slice(0, 7);
      const e = byMonth.get(key) ?? { bookings: 0, noShows: 0 };
      e.bookings += 1;
      if (b.status === "NO_SHOW") e.noShows += 1;
      byMonth.set(key, e);
    }
    const depotName = await resolveDepotName(input.depotId);
    return {
      rows: [...byMonth.entries()]
        .map(([month, v]) => ({ month, ...v, rate: v.bookings > 0 ? v.noShows / v.bookings : 0 }))
        .sort((a, b) => a.month.localeCompare(b.month)),
      meta: { title: "No-show rate", filters: dateRangeFilters(input.from, input.to, depotName), brand: DEFAULT_BRAND },
    };
  },
};

const conversionReport: ReportRegistration<
  z.infer<typeof fromToDepotInput>,
  { step: string; count: number; share: number }
> = {
  id: "bookings.conversion",
  title: "Conversion funnel",
  columns: [
    { key: "step", header: "Step", width: 22 },
    { key: "count", header: "Count", format: "number", width: 10, footer: "sum" },
    { key: "share", header: "Share", format: "percent", width: 10 },
  ],
  inputSchema: fromToDepotInput,
  async fetch(_ctx, input) {
    const grouped = await prisma.booking.groupBy({
      by: ["status"],
      where: { createdAt: { gte: input.from, lte: input.to }, ...(input.depotId ? { depotId: input.depotId } : {}) },
      _count: true,
    });
    const m: Record<string, number> = {};
    for (const g of grouped) m[g.status] = g._count;
    const steps = [
      { step: "1. Quote", count: m.QUOTE ?? 0 },
      { step: "2. Pending payment", count: m.PENDING_PAYMENT ?? 0 },
      { step: "3. Confirmed", count: m.CONFIRMED ?? 0 },
      { step: "4. Checked out", count: m.CHECKED_OUT ?? 0 },
      { step: "5. Active", count: m.ACTIVE ?? 0 },
      { step: "6. Completed", count: m.COMPLETED ?? 0 },
    ];
    const total = steps.reduce((a, s) => a + s.count, 0);
    const depotName = await resolveDepotName(input.depotId);
    return {
      rows: steps.map((s) => ({ ...s, share: total > 0 ? s.count / total : 0 })),
      meta: { title: "Conversion funnel", filters: dateRangeFilters(input.from, input.to, depotName), brand: DEFAULT_BRAND },
    };
  },
};

const maintCostReport: ReportRegistration<
  z.infer<typeof fromToDepotInput>,
  { code: string; category: string; woCount: number; labour: number; parts: number; total: number; costPerKm: number }
> = {
  id: "fleet.maintenanceCost",
  title: "Maintenance cost",
  columns: [
    { key: "code", header: "Vehicle", width: 12 },
    { key: "category", header: "Category", width: 16 },
    { key: "woCount", header: "WOs", format: "number", width: 8, footer: "sum" },
    { key: "labour", header: "Labour", format: "currency", width: 12, footer: "sum" },
    { key: "parts", header: "Parts", format: "currency", width: 12, footer: "sum" },
    { key: "total", header: "Total", format: "currency", width: 12, footer: "sum" },
    { key: "costPerKm", header: "$/km", format: "currency", width: 10 },
  ],
  inputSchema: fromToDepotInput,
  async fetch(_ctx, input) {
    const wos = await prisma.maintenanceWorkOrder.findMany({
      where: {
        completedAt: { gte: input.from, lte: input.to },
        ...(input.depotId ? { depotId: input.depotId } : {}),
      },
      include: {
        vehicle: { select: { internalCode: true, currentOdometerKm: true, category: { select: { name: true } } } },
      },
    });
    const byVehicle = new Map<string, { code: string; category: string; woCount: number; labour: number; parts: number; total: number; odo: number }>();
    for (const w of wos) {
      const e = byVehicle.get(w.vehicleId) ?? {
        code: w.vehicle.internalCode,
        category: w.vehicle.category.name,
        woCount: 0,
        labour: 0,
        parts: 0,
        total: 0,
        odo: w.vehicle.currentOdometerKm ?? 0,
      };
      e.woCount += 1;
      e.labour += Number(w.labourCost ?? 0);
      e.parts += Number(w.partsCost ?? 0);
      e.total += Number(w.actualCost ?? 0);
      byVehicle.set(w.vehicleId, e);
    }
    const depotName = await resolveDepotName(input.depotId);
    return {
      rows: [...byVehicle.values()]
        .map((v) => ({
          code: v.code,
          category: v.category,
          woCount: v.woCount,
          labour: v.labour,
          parts: v.parts,
          total: v.total,
          costPerKm: v.odo > 0 ? v.total / v.odo : 0,
        }))
        .sort((a, b) => b.total - a.total),
      meta: { title: "Maintenance cost", filters: dateRangeFilters(input.from, input.to, depotName), brand: DEFAULT_BRAND },
    };
  },
};

const downtimeReport: ReportRegistration<
  z.infer<typeof fromToDepotInput>,
  { workOrderNumber: string; vehicle: string; type: string; days: number; startedAt: Date | null; completedAt: Date | null }
> = {
  id: "fleet.downtime",
  title: "Vehicle downtime",
  columns: [
    { key: "workOrderNumber", header: "WO", width: 12 },
    { key: "vehicle", header: "Vehicle", width: 12 },
    { key: "type", header: "Type", width: 16 },
    { key: "days", header: "Days", format: "number", width: 10, footer: "sum" },
    { key: "startedAt", header: "Started", format: "datetime", width: 16 },
    { key: "completedAt", header: "Completed", format: "datetime", width: 16 },
  ],
  inputSchema: fromToDepotInput,
  async fetch(_ctx, input) {
    const wos = await prisma.maintenanceWorkOrder.findMany({
      where: {
        startedAt: { lte: input.to },
        completedAt: { gte: input.from },
        ...(input.depotId ? { depotId: input.depotId } : {}),
      },
      include: { vehicle: { select: { internalCode: true } } },
    });
    const rows = wos.map((w) => {
      const start = w.startedAt ? Math.max(w.startedAt.getTime(), input.from.getTime()) : input.from.getTime();
      const end = w.completedAt ? Math.min(w.completedAt.getTime(), input.to.getTime()) : input.to.getTime();
      return {
        workOrderNumber: w.workOrderNumber,
        vehicle: w.vehicle.internalCode,
        type: w.type,
        days: Math.round((Math.max(0, end - start) / 86400000) * 10) / 10,
        startedAt: w.startedAt,
        completedAt: w.completedAt,
      };
    }).sort((a, b) => b.days - a.days);
    const depotName = await resolveDepotName(input.depotId);
    return { rows, meta: { title: "Vehicle downtime", filters: dateRangeFilters(input.from, input.to, depotName), brand: DEFAULT_BRAND } };
  },
};

const profitReport: ReportRegistration<
  z.infer<typeof fromToDepotInput>,
  { code: string; category: string; revenue: number; maintenance: number; net: number }
> = {
  id: "fleet.profitability",
  title: "Vehicle profitability",
  columns: [
    { key: "code", header: "Vehicle", width: 12 },
    { key: "category", header: "Category", width: 16 },
    { key: "revenue", header: "Revenue", format: "currency", width: 14, footer: "sum" },
    { key: "maintenance", header: "Maintenance", format: "currency", width: 14, footer: "sum" },
    { key: "net", header: "Net", format: "currency", width: 14, footer: "sum" },
  ],
  inputSchema: fromToDepotInput,
  async fetch(_ctx, input) {
    const [vehicles, maintenance] = await Promise.all([
      prisma.vehicle.findMany({
        where: { isActive: true, ...(input.depotId ? { depotId: input.depotId } : {}) },
        include: {
          category: { select: { name: true } },
          bookings: {
            where: {
              status: { in: ["CONFIRMED", "CHECKED_OUT", "ACTIVE", "COMPLETED"] },
              createdAt: { gte: input.from, lte: input.to },
            },
            select: { totalAmount: true },
          },
        },
      }),
      prisma.maintenanceWorkOrder.groupBy({
        by: ["vehicleId"],
        where: { completedAt: { gte: input.from, lte: input.to } },
        _sum: { actualCost: true },
      }),
    ]);
    const costByVehicle = new Map<string, number>();
    for (const m of maintenance) costByVehicle.set(m.vehicleId, Number(m._sum.actualCost ?? 0));
    const rows = vehicles
      .map((v) => {
        const revenue = v.bookings.reduce((a, b) => a + Number(b.totalAmount), 0);
        const maint = costByVehicle.get(v.id) ?? 0;
        return { code: v.internalCode, category: v.category.name, revenue, maintenance: maint, net: revenue - maint };
      })
      .sort((a, b) => b.net - a.net);
    const depotName = await resolveDepotName(input.depotId);
    return { rows, meta: { title: "Vehicle profitability", filters: dateRangeFilters(input.from, input.to, depotName), brand: DEFAULT_BRAND } };
  },
};

const ageOdoInput = z.object({ depotId: z.string().optional() }).passthrough();

const ageOdometerReport: ReportRegistration<
  z.infer<typeof ageOdoInput>,
  { code: string; category: string; depot: string; year: number; age: number; odometer: number; rentalDays: number; kmPerRentalDay: number }
> = {
  id: "fleet.ageOdometer",
  title: "Age & odometer",
  columns: [
    { key: "code", header: "Vehicle", width: 12 },
    { key: "category", header: "Category", width: 16 },
    { key: "depot", header: "Depot", width: 16 },
    { key: "year", header: "Year", format: "number", width: 8 },
    { key: "age", header: "Age", format: "number", width: 8 },
    { key: "odometer", header: "Odometer", format: "number", width: 12, footer: "sum" },
    { key: "rentalDays", header: "Rental days", format: "number", width: 12, footer: "sum" },
    { key: "kmPerRentalDay", header: "km/day", format: "number", width: 10 },
  ],
  inputSchema: ageOdoInput,
  async fetch(_ctx, input) {
    const vehicles = await prisma.vehicle.findMany({
      where: { isActive: true, ...(input.depotId ? { depotId: input.depotId } : {}) },
      include: { category: true, depot: true, bookings: { where: { status: "COMPLETED" }, select: { durationDays: true } } },
    });
    const nowYear = new Date().getFullYear();
    const rows = vehicles.map((v) => {
      const rentalDays = v.bookings.reduce((a, b) => a + (b.durationDays ?? 0), 0);
      return {
        code: v.internalCode,
        category: v.category.name,
        depot: v.depot.name,
        year: v.year,
        age: nowYear - v.year,
        odometer: v.currentOdometerKm ?? 0,
        rentalDays,
        kmPerRentalDay: rentalDays > 0 ? (v.currentOdometerKm ?? 0) / rentalDays : 0,
      };
    }).sort((a, b) => b.odometer - a.odometer);
    const depotName = await resolveDepotName(input.depotId);
    return { rows, meta: { title: "Age & odometer", filters: depotName ? [{ label: "Depot", value: depotName }] : [], brand: DEFAULT_BRAND } };
  },
};

const ltvInput = z.object({}).passthrough();
const ltvReport: ReportRegistration<
  z.infer<typeof ltvInput>,
  { metric: string; value: number; format: string }
> = {
  id: "customers.ltv",
  title: "Customer LTV",
  columns: [
    { key: "metric", header: "Metric", width: 30 },
    { key: "value", header: "Value", format: "number", width: 14 },
  ],
  inputSchema: ltvInput,
  async fetch() {
    const customers = await prisma.user.findMany({
      where: { role: "CUSTOMER" },
      select: { customerProfile: { select: { totalBookings: true, totalSpend: true } } },
    });
    const totals = customers.reduce(
      (acc, c) => {
        const bookings = c.customerProfile?.totalBookings ?? 0;
        const spend = Number(c.customerProfile?.totalSpend ?? 0);
        if (bookings > 0) {
          acc.customersWithBookings += 1;
          acc.totalBookings += bookings;
          acc.totalSpend += spend;
        }
        acc.totalCustomers += 1;
        return acc;
      },
      { totalCustomers: 0, customersWithBookings: 0, totalBookings: 0, totalSpend: 0 },
    );
    const avgLtv = totals.customersWithBookings > 0 ? totals.totalSpend / totals.customersWithBookings : 0;
    const avgBookings = totals.customersWithBookings > 0 ? totals.totalBookings / totals.customersWithBookings : 0;
    const repeatCount = customers.filter((c) => (c.customerProfile?.totalBookings ?? 0) > 1).length;
    return {
      rows: [
        { metric: "Total customers", value: totals.totalCustomers, format: "number" },
        { metric: "Customers with bookings", value: totals.customersWithBookings, format: "number" },
        { metric: "Repeat customers", value: repeatCount, format: "number" },
        { metric: "Avg LTV (AUD)", value: avgLtv, format: "currency" },
        { metric: "Avg bookings per customer", value: avgBookings, format: "number" },
        {
          metric: "Repeat rate",
          value: totals.customersWithBookings > 0 ? repeatCount / totals.customersWithBookings : 0,
          format: "percent",
        },
      ],
      meta: { title: "Customer LTV", filters: [], brand: DEFAULT_BRAND },
    };
  },
};

const acquisitionReport: ReportRegistration<
  z.infer<typeof fromToInput>,
  { source: string; customers: number; revenue: number }
> = {
  id: "customers.acquisition",
  title: "Acquisition by source",
  columns: [
    { key: "source", header: "Source", width: 16 },
    { key: "customers", header: "New customers", format: "number", width: 14, footer: "sum" },
    { key: "revenue", header: "First-booking revenue", format: "currency", width: 16, footer: "sum" },
  ],
  inputSchema: fromToInput,
  async fetch(_ctx, input) {
    const customers = await prisma.user.findMany({
      where: { role: "CUSTOMER", createdAt: { gte: input.from, lte: input.to } },
      select: {
        bookings: { orderBy: { createdAt: "asc" }, take: 1, select: { source: true, totalAmount: true } },
      },
    });
    const bySource = new Map<string, { customers: number; revenue: number }>();
    for (const c of customers) {
      const source = c.bookings[0]?.source ?? "NO_BOOKING";
      const e = bySource.get(source) ?? { customers: 0, revenue: 0 };
      e.customers += 1;
      e.revenue += Number(c.bookings[0]?.totalAmount ?? 0);
      bySource.set(source, e);
    }
    return {
      rows: [...bySource.entries()].map(([source, v]) => ({ source, ...v })).sort((a, b) => b.customers - a.customers),
      meta: { title: "Acquisition by source", filters: dateRangeFilters(input.from, input.to), brand: DEFAULT_BRAND },
    };
  },
};

const geographicInput = z.object({}).passthrough();
const geographicReport: ReportRegistration<
  z.infer<typeof geographicInput>,
  { postcode: string; suburb: string; state: string; customers: number; bookings: number; revenue: number }
> = {
  id: "customers.geographic",
  title: "Geographic distribution",
  columns: [
    { key: "postcode", header: "Postcode", width: 10 },
    { key: "suburb", header: "Suburb", width: 20 },
    { key: "state", header: "State", width: 8 },
    { key: "customers", header: "Customers", format: "number", width: 12, footer: "sum" },
    { key: "bookings", header: "Bookings", format: "number", width: 10, footer: "sum" },
    { key: "revenue", header: "Revenue", format: "currency", width: 14, footer: "sum" },
  ],
  inputSchema: geographicInput,
  async fetch() {
    const profiles = await prisma.customerProfile.findMany({
      where: { postcode: { not: null } },
      select: { postcode: true, suburb: true, state: true, totalBookings: true, totalSpend: true },
    });
    const byPc = new Map<string, { postcode: string; suburb: string; state: string; customers: number; bookings: number; revenue: number }>();
    for (const p of profiles) {
      const key = `${p.postcode}-${p.state ?? ""}`;
      const e = byPc.get(key) ?? {
        postcode: p.postcode ?? "",
        suburb: p.suburb ?? "",
        state: p.state ?? "",
        customers: 0,
        bookings: 0,
        revenue: 0,
      };
      e.customers += 1;
      e.bookings += p.totalBookings;
      e.revenue += Number(p.totalSpend);
      byPc.set(key, e);
    }
    return {
      rows: [...byPc.values()].sort((a, b) => b.revenue - a.revenue),
      meta: { title: "Geographic distribution", filters: [], brand: DEFAULT_BRAND },
    };
  },
};

const pnlReport: ReportRegistration<
  z.infer<typeof fromToInput>,
  { depot: string; revenue: number; gst: number; maintenance: number; net: number }
> = {
  id: "financial.pnlByDepot",
  title: "P&L by depot",
  columns: [
    { key: "depot", header: "Depot", width: 20 },
    { key: "revenue", header: "Revenue (inc)", format: "currency", width: 14, footer: "sum" },
    { key: "gst", header: "GST", format: "currency", width: 12, footer: "sum" },
    { key: "maintenance", header: "Maintenance", format: "currency", width: 14, footer: "sum" },
    { key: "net", header: "Net", format: "currency", width: 14, footer: "sum" },
  ],
  inputSchema: fromToInput,
  async fetch(_ctx, input) {
    const [revenueByDepot, maintenanceByDepot, depots] = await Promise.all([
      prisma.booking.groupBy({
        by: ["depotId"],
        where: { createdAt: { gte: input.from, lte: input.to }, status: { notIn: ["CANCELLED", "NO_SHOW"] } },
        _sum: { totalAmount: true, gstAmount: true },
      }),
      prisma.maintenanceWorkOrder.groupBy({
        by: ["depotId"],
        where: { completedAt: { gte: input.from, lte: input.to } },
        _sum: { actualCost: true },
      }),
      prisma.depot.findMany({ select: { id: true, name: true } }),
    ]);
    const nameOf = new Map(depots.map((d) => [d.id, d.name]));
    const maintMap = new Map<string, number>();
    for (const m of maintenanceByDepot) maintMap.set(m.depotId, Number(m._sum.actualCost ?? 0));
    return {
      rows: revenueByDepot.map((r) => {
        const revenue = Number(r._sum.totalAmount ?? 0);
        const gst = Number(r._sum.gstAmount ?? 0);
        const maint = maintMap.get(r.depotId) ?? 0;
        return { depot: nameOf.get(r.depotId) ?? "Unknown", revenue, gst, maintenance: maint, net: revenue - gst - maint };
      }).sort((a, b) => b.net - a.net),
      meta: { title: "P&L by depot", filters: dateRangeFilters(input.from, input.to), brand: DEFAULT_BRAND },
    };
  },
};

const bondCaptureReport: ReportRegistration<
  z.infer<typeof fromToInput>,
  { month: string; held: number; captured: number; released: number; captureRate: number }
> = {
  id: "financial.bondCapture",
  title: "Bond capture",
  columns: [
    { key: "month", header: "Month", width: 10 },
    { key: "held", header: "Held", format: "currency", width: 12, footer: "sum" },
    { key: "captured", header: "Captured", format: "currency", width: 12, footer: "sum" },
    { key: "released", header: "Released", format: "currency", width: 12, footer: "sum" },
    { key: "captureRate", header: "Capture %", format: "percent", width: 10 },
  ],
  inputSchema: fromToInput,
  async fetch(_ctx, input) {
    const bonds = await prisma.bondLedger.findMany({
      where: { createdAt: { gte: input.from, lte: input.to } },
      select: { createdAt: true, heldAmount: true, capturedAmount: true, releasedAmount: true },
    });
    const byMonth = new Map<string, { held: number; captured: number; released: number }>();
    for (const b of bonds) {
      const key = b.createdAt.toISOString().slice(0, 7);
      const e = byMonth.get(key) ?? { held: 0, captured: 0, released: 0 };
      e.held += Number(b.heldAmount);
      e.captured += Number(b.capturedAmount);
      e.released += Number(b.releasedAmount);
      byMonth.set(key, e);
    }
    return {
      rows: [...byMonth.entries()]
        .map(([month, v]) => ({ month, ...v, captureRate: v.held > 0 ? v.captured / v.held : 0 }))
        .sort((a, b) => a.month.localeCompare(b.month)),
      meta: { title: "Bond capture", filters: dateRangeFilters(input.from, input.to), brand: DEFAULT_BRAND },
    };
  },
};

const damageRecoveryReport: ReportRegistration<
  z.infer<typeof fromToInput>,
  { booking: string; customer: string; charged: number; collected: number; status: string; createdAt: Date }
> = {
  id: "financial.damageRecovery",
  title: "Damage recovery",
  columns: [
    { key: "booking", header: "Booking", width: 14 },
    { key: "customer", header: "Customer", width: 22 },
    { key: "charged", header: "Charged", format: "currency", width: 12, footer: "sum" },
    { key: "collected", header: "Collected", format: "currency", width: 12, footer: "sum" },
    { key: "status", header: "Status", width: 12 },
    { key: "createdAt", header: "Date", format: "datetime", width: 16 },
  ],
  inputSchema: fromToInput,
  async fetch(_ctx, input) {
    const damageCharges = await prisma.payment.findMany({
      where: { type: "DAMAGE_CHARGE", createdAt: { gte: input.from, lte: input.to } },
      include: {
        booking: { select: { bookingReference: true } },
        customer: { select: { firstName: true, lastName: true } },
      },
    });
    return {
      rows: damageCharges.map((p) => ({
        booking: p.booking?.bookingReference ?? "",
        customer: p.customer ? `${p.customer.firstName} ${p.customer.lastName}` : "",
        charged: Number(p.amount),
        collected: p.status === "SUCCEEDED" ? Number(p.amount) : 0,
        status: p.status,
        createdAt: p.createdAt,
      })),
      meta: { title: "Damage recovery", filters: dateRangeFilters(input.from, input.to), brand: DEFAULT_BRAND },
    };
  },
};

const infringementsReport: ReportRegistration<
  z.infer<typeof fromToInput>,
  { type: string; count: number; amount: number; recovered: number; recoveryRate: number }
> = {
  id: "operational.infringements",
  title: "Infringement summary",
  columns: [
    { key: "type", header: "Type", width: 18 },
    { key: "count", header: "Count", format: "number", width: 10, footer: "sum" },
    { key: "amount", header: "Total $", format: "currency", width: 12, footer: "sum" },
    { key: "recovered", header: "Recovered", format: "currency", width: 12, footer: "sum" },
    { key: "recoveryRate", header: "Rate", format: "percent", width: 10 },
  ],
  inputSchema: fromToInput,
  async fetch(_ctx, input) {
    const infringements = await prisma.infringement.findMany({
      where: { offenceDate: { gte: input.from, lte: input.to } },
      select: { type: true, status: true, amount: true },
    });
    const byType = new Map<string, { count: number; amount: number; recovered: number }>();
    for (const i of infringements) {
      const e = byType.get(i.type) ?? { count: 0, amount: 0, recovered: 0 };
      e.count += 1;
      e.amount += Number(i.amount);
      if (i.status === "PAID" || i.status === "CUSTOMER_CHARGED") e.recovered += Number(i.amount);
      byType.set(i.type, e);
    }
    return {
      rows: [...byType.entries()]
        .map(([type, v]) => ({ type, ...v, recoveryRate: v.amount > 0 ? v.recovered / v.amount : 0 }))
        .sort((a, b) => b.amount - a.amount),
      meta: { title: "Infringement summary", filters: dateRangeFilters(input.from, input.to), brand: DEFAULT_BRAND },
    };
  },
};

const staffPerfReport: ReportRegistration<
  z.infer<typeof fromToInput>,
  { name: string; checkouts: number; checkins: number; incidentsRaised: number }
> = {
  id: "operational.staffPerformance",
  title: "Staff performance",
  columns: [
    { key: "name", header: "Staff", width: 24 },
    { key: "checkouts", header: "Check-outs", format: "number", width: 12, footer: "sum" },
    { key: "checkins", header: "Check-ins", format: "number", width: 12, footer: "sum" },
    { key: "incidentsRaised", header: "Incidents", format: "number", width: 12, footer: "sum" },
  ],
  inputSchema: fromToInput,
  async fetch(_ctx, input) {
    const [checkouts, checkins, incidentsRaw] = await Promise.all([
      prisma.booking.groupBy({
        by: ["checkedOutById"],
        where: { actualPickupDateTime: { gte: input.from, lte: input.to }, checkedOutById: { not: null } },
        _count: true,
      }),
      prisma.booking.groupBy({
        by: ["checkedInById"],
        where: { actualReturnDateTime: { gte: input.from, lte: input.to }, checkedInById: { not: null } },
        _count: true,
      }),
      prisma.incident.groupBy({
        by: ["reportedById"],
        where: { createdAt: { gte: input.from, lte: input.to }, reportedById: { not: null } },
        _count: true,
      }),
    ]);
    const staffIds = new Set<string>();
    for (const c of checkouts) if (c.checkedOutById) staffIds.add(c.checkedOutById);
    for (const c of checkins) if (c.checkedInById) staffIds.add(c.checkedInById);
    for (const i of incidentsRaw) if (i.reportedById) staffIds.add(i.reportedById);
    const staff = await prisma.user.findMany({ where: { id: { in: [...staffIds] } }, select: { id: true, firstName: true, lastName: true } });
    const nameOf = new Map(staff.map((s) => [s.id, `${s.firstName} ${s.lastName}`]));
    const coMap = new Map(checkouts.filter((c) => c.checkedOutById).map((c) => [c.checkedOutById!, c._count]));
    const ciMap = new Map(checkins.filter((c) => c.checkedInById).map((c) => [c.checkedInById!, c._count]));
    const inMap = new Map(incidentsRaw.filter((i) => i.reportedById).map((i) => [i.reportedById!, i._count]));
    return {
      rows: [...staffIds].map((id) => ({
        name: nameOf.get(id) ?? "Unknown",
        checkouts: coMap.get(id) ?? 0,
        checkins: ciMap.get(id) ?? 0,
        incidentsRaised: inMap.get(id) ?? 0,
      })).sort((a, b) => b.checkouts + b.checkins - (a.checkouts + a.checkins)),
      meta: { title: "Staff performance", filters: dateRangeFilters(input.from, input.to), brand: DEFAULT_BRAND },
    };
  },
};

const checkTimesReport: ReportRegistration<
  z.infer<typeof fromToInput>,
  { depot: string; avgCheckoutMin: number; avgCheckinMin: number; p90CheckoutMin: number; p90CheckinMin: number }
> = {
  id: "operational.checkTimes",
  title: "Check-in / out times",
  columns: [
    { key: "depot", header: "Depot", width: 20 },
    { key: "avgCheckoutMin", header: "Avg CO (min)", format: "number", width: 12 },
    { key: "p90CheckoutMin", header: "P90 CO", format: "number", width: 10 },
    { key: "avgCheckinMin", header: "Avg CI (min)", format: "number", width: 12 },
    { key: "p90CheckinMin", header: "P90 CI", format: "number", width: 10 },
  ],
  inputSchema: fromToInput,
  async fetch(_ctx, input) {
    const bookings = await prisma.booking.findMany({
      where: {
        OR: [
          { actualPickupDateTime: { gte: input.from, lte: input.to } },
          { actualReturnDateTime: { gte: input.from, lte: input.to } },
        ],
      },
      select: {
        pickupDateTime: true,
        actualPickupDateTime: true,
        returnDateTime: true,
        actualReturnDateTime: true,
        pickupDepot: { select: { name: true } },
        returnDepot: { select: { name: true } },
      },
    });
    const byDepot = new Map<string, { co: number[]; ci: number[] }>();
    for (const b of bookings) {
      if (b.actualPickupDateTime) {
        const diff = (b.actualPickupDateTime.getTime() - b.pickupDateTime.getTime()) / 60000;
        const e = byDepot.get(b.pickupDepot.name) ?? { co: [], ci: [] };
        e.co.push(diff);
        byDepot.set(b.pickupDepot.name, e);
      }
      if (b.actualReturnDateTime) {
        const diff = (b.actualReturnDateTime.getTime() - b.returnDateTime.getTime()) / 60000;
        const e = byDepot.get(b.returnDepot.name) ?? { co: [], ci: [] };
        e.ci.push(diff);
        byDepot.set(b.returnDepot.name, e);
      }
    }
    const avg = (a: number[]) => (a.length > 0 ? a.reduce((x, y) => x + y, 0) / a.length : 0);
    const p90 = (a: number[]) => {
      if (a.length === 0) return 0;
      const s = [...a].sort((x, y) => x - y);
      return s[Math.floor(s.length * 0.9)] ?? 0;
    };
    return {
      rows: [...byDepot.entries()]
        .map(([depot, v]) => ({
          depot,
          avgCheckoutMin: Math.round(avg(v.co) * 10) / 10,
          avgCheckinMin: Math.round(avg(v.ci) * 10) / 10,
          p90CheckoutMin: Math.round(p90(v.co) * 10) / 10,
          p90CheckinMin: Math.round(p90(v.ci) * 10) / 10,
        }))
        .sort((a, b) => a.depot.localeCompare(b.depot)),
      meta: { title: "Check-in / out times", filters: dateRangeFilters(input.from, input.to), brand: DEFAULT_BRAND },
    };
  },
};

// ---------------------------------------------------------------------------
// Registry map
// ---------------------------------------------------------------------------

type StaffTaskDurationRow = {
  label: string;
  total: number;
  completed: number;
  superseded: number;
  abandoned: number;
  avgSeconds: number;
  p50Seconds: number;
  p95Seconds: number;
  abandonRate: number;
  supersedeRate: number;
};

const STAFF_TASK_COLUMNS: ColumnDef<StaffTaskDurationRow>[] = [
  { key: "label", header: "Label", width: 28 },
  { key: "total", header: "Total", format: "number", width: 10, footer: "sum" },
  { key: "completed", header: "Completed", format: "number", width: 12, footer: "sum" },
  { key: "superseded", header: "Superseded", format: "number", width: 12, footer: "sum" },
  { key: "abandoned", header: "Abandoned", format: "number", width: 12, footer: "sum" },
  { key: "avgSeconds", header: "Avg (s)", format: "number", width: 10 },
  { key: "p50Seconds", header: "p50 (s)", format: "number", width: 10 },
  { key: "p95Seconds", header: "p95 (s)", format: "number", width: 10 },
  { key: "abandonRate", header: "Abandon %", width: 12 },
  { key: "supersedeRate", header: "Superseded %", width: 14 },
];

const TASK_TYPE_LABEL_FOR_EXPORT: Record<string, string> = {
  BOOKING_PICKUP: "Booking pickup",
  BOOKING_RETURN: "Booking return",
  BOOKING_OVERDUE_CHASE: "Overdue booking",
  INSPECTION_PRE_HIRE: "Pre-hire inspection",
  INSPECTION_POST_HIRE: "Post-hire inspection",
  MAINTENANCE_WORK_ORDER: "Work order",
  RENTAL_AGREEMENT_SIGN: "Rental agreement signature",
  RETURN_ASSESSMENT_FINALISE: "Return assessment finalise",
};

function summariseTaskActivities(
  rows: {
    status: string;
    startedAt: Date;
    completedAt: Date | null;
    taskType: string;
    staffId: string;
    staff: { firstName: string; lastName: string };
  }[],
  groupBy: "task" | "staff",
): StaffTaskDurationRow[] {
  interface Bucket {
    label: string;
    total: number;
    completed: number;
    superseded: number;
    abandoned: number;
    durations: number[];
  }
  const buckets = new Map<string, Bucket>();
  for (const r of rows) {
    const key = groupBy === "task" ? r.taskType : r.staffId;
    const label =
      groupBy === "task"
        ? TASK_TYPE_LABEL_FOR_EXPORT[r.taskType] ?? r.taskType
        : `${r.staff.firstName} ${r.staff.lastName}`;
    const b = buckets.get(key) ?? { label, total: 0, completed: 0, superseded: 0, abandoned: 0, durations: [] };
    b.total += 1;
    const durationSec =
      r.completedAt ? Math.max(0, (r.completedAt.getTime() - r.startedAt.getTime()) / 1000) : 0;
    if (r.status === "COMPLETED") {
      b.completed += 1;
      b.durations.push(durationSec);
    } else if (r.status === "SUPERSEDED") b.superseded += 1;
    else if (r.status === "ABANDONED") b.abandoned += 1;
    buckets.set(key, b);
  }
  const percentile = (sorted: number[], p: number): number => {
    if (sorted.length === 0) return 0;
    const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
    return sorted[idx] ?? 0;
  };
  return [...buckets.values()].map((b) => {
    const sorted = [...b.durations].sort((a, c) => a - c);
    const avg = sorted.length ? sorted.reduce((s, x) => s + x, 0) / sorted.length : 0;
    return {
      label: b.label,
      total: b.total,
      completed: b.completed,
      superseded: b.superseded,
      abandoned: b.abandoned,
      avgSeconds: Math.round(avg),
      p50Seconds: Math.round(percentile(sorted, 0.5)),
      p95Seconds: Math.round(percentile(sorted, 0.95)),
      abandonRate: b.total ? Math.round((b.abandoned / b.total) * 1000) / 10 : 0,
      supersedeRate: b.total ? Math.round((b.superseded / b.total) * 1000) / 10 : 0,
    };
  }).sort((a, b) => b.total - a.total);
}

const staffTasksByStaffReport: ReportRegistration<z.infer<typeof fromToInput>, StaffTaskDurationRow> = {
  id: "operational.staffTasks",
  title: "Staff task performance",
  columns: STAFF_TASK_COLUMNS,
  inputSchema: fromToInput,
  async fetch(_ctx, input) {
    const rows = await prisma.staffTaskActivity.findMany({
      where: { completedAt: { gte: input.from, lte: input.to, not: null } },
      select: {
        status: true,
        startedAt: true,
        completedAt: true,
        taskType: true,
        staffId: true,
        staff: { select: { firstName: true, lastName: true } },
      },
    });
    return {
      rows: summariseTaskActivities(rows, "staff"),
      meta: { title: "Staff task performance", filters: dateRangeFilters(input.from, input.to), brand: DEFAULT_BRAND },
    };
  },
};

const staffTasksByTypeReport: ReportRegistration<z.infer<typeof fromToInput>, StaffTaskDurationRow> = {
  id: "operational.staffTasksByType",
  title: "Staff tasks by type",
  columns: STAFF_TASK_COLUMNS,
  inputSchema: fromToInput,
  async fetch(_ctx, input) {
    const rows = await prisma.staffTaskActivity.findMany({
      where: { completedAt: { gte: input.from, lte: input.to, not: null } },
      select: {
        status: true,
        startedAt: true,
        completedAt: true,
        taskType: true,
        staffId: true,
        staff: { select: { firstName: true, lastName: true } },
      },
    });
    return {
      rows: summariseTaskActivities(rows, "task"),
      meta: { title: "Staff tasks by type", filters: dateRangeFilters(input.from, input.to), brand: DEFAULT_BRAND },
    };
  },
};

const REGISTRATIONS: ReportRegistration[] = [
  financeOverview,
  financeTransactions,
  financeInvoices,
  financeBonds,
  financeGst,
  financeReconciliation,
  bookingsByPeriod,
  bySourceReport,
  cancellationsReport,
  leadTimeReport,
  noShowReport,
  conversionReport,
  fleetUtilReport,
  revenuePerVehicleReport,
  maintCostReport,
  downtimeReport,
  profitReport,
  ageOdometerReport,
  topCustomersReport,
  newVsReturningReport,
  ltvReport,
  acquisitionReport,
  geographicReport,
  agingReport,
  refundsReport,
  pnlReport,
  bondCaptureReport,
  damageRecoveryReport,
  incidentFreqReport,
  infringementsReport,
  staffPerfReport,
  checkTimesReport,
  staffTasksByStaffReport,
  staffTasksByTypeReport,
];

const registry = new Map<string, ReportRegistration>(
  REGISTRATIONS.map((r) => [r.id, r]),
);

export function getReport(id: string): ReportRegistration | undefined {
  return registry.get(id);
}

export function listReports(): ReportRegistration[] {
  return [...registry.values()];
}

export function registerReport(reg: ReportRegistration) {
  registry.set(reg.id, reg);
}
