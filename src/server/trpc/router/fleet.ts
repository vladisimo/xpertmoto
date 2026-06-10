import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Prisma } from "@prisma/client";
import { createTRPCRouter, staffProcedure, managerProcedure } from "../trpc";
import { calcDepreciation } from "@/server/services/depreciation";
import {
  AUDIT_CHECKS,
  AUDIT_EXCLUDED_STATUSES,
  evaluateVehicleAudit,
  type AuditCheckKey,
  type AuditSeverity,
} from "@/server/services/fleet-audit";
import { reassignFutureBookings } from "@/server/services/fleet-reassign";
import { sendNotification } from "@/server/services/notification-sender";
import { recordIncidentForCustomer } from "@/server/services/revenue-aggregator";
import { autoCloseByTarget } from "@/server/services/staff-tasks";
import { generateWorkOrderNumber, generateIncidentNumber, withUniqueRetry } from "@/lib/id-gen";
import { capturePaymentIntent } from "@/lib/stripe";
import { trackServer } from "@/lib/analytics";
import { SERVER_EVENTS } from "@/lib/analytics/server-event-names";

// Statuses that a human (import or UI) is allowed to set directly.
// Operational statuses (RENTED / RESERVED / IN_TRANSIT) are driven by
// the booking and transfer flows, never by onboarding.
export const ADMIN_SETTABLE_VEHICLE_STATUSES = [
  "AVAILABLE",
  "PENDING",
  "IN_MAINTENANCE",
  "ACCIDENT_REPAIRS",
  "SOLD",
  "END_OF_LIFE",
  "STOLEN",
  "WRITTEN_OFF",
] as const;
export type AdminSettableVehicleStatus = (typeof ADMIN_SETTABLE_VEHICLE_STATUSES)[number];

// Disposition statuses (soft-delete on import, same as live UI).
export const DISPOSITION_STATUSES = ["SOLD", "END_OF_LIFE", "STOLEN", "WRITTEN_OFF"] as const;
export type DispositionStatus = (typeof DISPOSITION_STATUSES)[number];

const vehicleCreate = z.object({
  internalCode: z.string().min(1),
  rego: z.string().min(1),
  regoState: z.string().min(2),
  regoExpiry: z.coerce.date().optional(),
  vin: z.string().optional(),
  engineNumber: z.string().optional(),
  make: z.string().min(1),
  model: z.string().min(1),
  year: z.number().int(),
  colour: z.string().min(1),
  categoryId: z.string(),
  depotId: z.string(),
  currentOdometerKm: z.number().int().min(0).default(0),
  fuelType: z.string().optional(),
  status: z.enum(ADMIN_SETTABLE_VEHICLE_STATUSES).optional(),
  condition: z.enum(["EXCELLENT", "GOOD", "FAIR", "POOR"]).optional(),
  notes: z.string().optional(),
  purchaseDate: z.coerce.date().optional(),
  purchasePrice: z.number().optional(),
  depreciationMethod: z.enum(["STRAIGHT_LINE", "DIMINISHING_VALUE"]).optional(),
  depreciationRate: z.number().optional(),
  insurancePolicyNumber: z.string().optional(),
  insuranceExpiry: z.coerce.date().optional(),
  ctpExpiry: z.coerce.date().optional(),
  warrantyExpiry: z.coerce.date().optional(),
  supplierName: z.string().optional(),
  supplierContact: z.string().optional(),
  financeType: z.string().optional(),
  financeProvider: z.string().optional(),
  financeRef: z.string().optional(),
  ownerId: z.string().optional(),
  images: z
    .array(z.object({ url: z.string().min(1), caption: z.string().optional(), checksum: z.string().optional() }))
    .optional(),
  documents: z.array(z.object({
    type: z.enum(["REGO_CERT", "INSURANCE", "CTP", "PURCHASE_RECEIPT", "OTHER"]),
    fileUrl: z.string().min(1),
    expiryDate: z.coerce.date().optional(),
    notes: z.string().optional(),
  })).optional(),
});

// addVehicleDocument: type → required fields.
// Expiry types bump Vehicle.<field>Expiry; cost types auto-create a
// COMPLETED MaintenanceWorkOrder; INFRINGEMENT creates an Infringement.
const EXPIRY_DOC_TYPES = ["CTP", "REGO_CERT", "INSURANCE", "WARRANTY"] as const;
const COST_WO_DOC_TYPES = [
  "REPAIR_BILL",
  "PARTS_PURCHASE",
  "SERVICE_FEE",
  "TYRE_REPLACEMENT",
] as const;
type ExpiryDocType = (typeof EXPIRY_DOC_TYPES)[number];
type CostWorkOrderDocType = (typeof COST_WO_DOC_TYPES)[number];

const EXPIRY_FIELD: Record<ExpiryDocType, "ctpExpiry" | "regoExpiry" | "insuranceExpiry" | "warrantyExpiry"> = {
  CTP: "ctpExpiry",
  REGO_CERT: "regoExpiry",
  INSURANCE: "insuranceExpiry",
  WARRANTY: "warrantyExpiry",
};

const WO_TYPE_MAP: Record<CostWorkOrderDocType, "ROUTINE_SERVICE" | "TYRE_REPLACEMENT" | "CUSTOM"> = {
  REPAIR_BILL: "CUSTOM",
  PARTS_PURCHASE: "CUSTOM",
  SERVICE_FEE: "ROUTINE_SERVICE",
  TYRE_REPLACEMENT: "TYRE_REPLACEMENT",
};

const WO_TITLE: Record<CostWorkOrderDocType, string> = {
  REPAIR_BILL: "Repair bill",
  PARTS_PURCHASE: "Parts purchase",
  SERVICE_FEE: "Service",
  TYRE_REPLACEMENT: "Tyre replacement",
};

type AddVehicleDocExpiryInput = Extract<z.infer<typeof addVehicleDocumentInput>, { type: ExpiryDocType }>;
type AddVehicleDocCostInput = Extract<z.infer<typeof addVehicleDocumentInput>, { type: CostWorkOrderDocType }>;

function isExpiryInput(i: z.infer<typeof addVehicleDocumentInput>): i is AddVehicleDocExpiryInput {
  return (EXPIRY_DOC_TYPES as readonly string[]).includes(i.type);
}
function isCostWorkOrderInput(i: z.infer<typeof addVehicleDocumentInput>): i is AddVehicleDocCostInput {
  return (COST_WO_DOC_TYPES as readonly string[]).includes(i.type);
}

const addVehicleDocumentInput = z.discriminatedUnion("type", [
  // Compliance expiry docs
  z.object({
    type: z.enum(EXPIRY_DOC_TYPES),
    vehicleId: z.string(),
    fileUrl: z.string().min(1),
    thumbnailUrl: z.string().min(1).optional(),
    expiryDate: z.coerce.date(),
    issueDate: z.coerce.date().optional(),
    referenceNumber: z.string().optional(),
    notes: z.string().optional(),
  }),
  // Cost docs → COMPLETED work order
  z.object({
    type: z.enum(COST_WO_DOC_TYPES),
    vehicleId: z.string(),
    fileUrl: z.string().min(1),
    thumbnailUrl: z.string().min(1).optional(),
    cost: z.number().positive(),
    issueDate: z.coerce.date().optional(),
    supplier: z.string().optional(),
    description: z.string().optional(),
    odometerAtService: z.number().int().nonnegative().optional(),
    referenceNumber: z.string().optional(),
    notes: z.string().optional(),
  }),
  // Infringement
  z.object({
    type: z.literal("INFRINGEMENT"),
    vehicleId: z.string(),
    fileUrl: z.string().min(1),
    thumbnailUrl: z.string().min(1).optional(),
    infringementType: z.enum(["SPEEDING", "PARKING", "TOLL", "RED_LIGHT", "OTHER"]),
    issuer: z.string().min(1),
    referenceNumber: z.string().min(1),
    offenceDate: z.coerce.date(),
    amount: z.number().positive(),
    dueDate: z.coerce.date().optional(),
    notes: z.string().optional(),
  }),
  // Purchase receipt
  z.object({
    type: z.literal("PURCHASE_RECEIPT"),
    vehicleId: z.string(),
    fileUrl: z.string().min(1),
    thumbnailUrl: z.string().min(1).optional(),
    cost: z.number().positive().optional(),
    issueDate: z.coerce.date().optional(),
    referenceNumber: z.string().optional(),
    notes: z.string().optional(),
  }),
  // Catch-all
  z.object({
    type: z.literal("OTHER"),
    vehicleId: z.string(),
    fileUrl: z.string().min(1),
    thumbnailUrl: z.string().min(1).optional(),
    issueDate: z.coerce.date().optional(),
    referenceNumber: z.string().optional(),
    notes: z.string().optional(),
  }),
]);
export type AddVehicleDocumentInput = z.infer<typeof addVehicleDocumentInput>;

export const fleetRouter = createTRPCRouter({
  dashboard: staffProcedure.query(async ({ ctx }) => {
    const now = new Date();
    const in30 = new Date(now.getTime() + 30 * 86400000);
    const in14 = new Date(now.getTime() + 14 * 86400000);

    const [total, byStatus, byDepot, byCategory, attention, avgAge, bookValueSum] = await Promise.all([
      ctx.prisma.vehicle.count({ where: { isActive: true } }),
      ctx.prisma.vehicle.groupBy({ by: ["status"], where: { isActive: true }, _count: true }),
      ctx.prisma.vehicle.groupBy({ by: ["depotId"], where: { isActive: true }, _count: true }),
      ctx.prisma.vehicle.groupBy({ by: ["categoryId"], where: { isActive: true }, _count: true }),
      ctx.prisma.vehicle.findMany({
        where: {
          isActive: true,
          OR: [
            { regoExpiry: { lt: in30 } },
            { ctpExpiry: { lt: in30 } },
            { insuranceExpiry: { lt: in30 } },
            { nextServiceDueDate: { lt: in14 } },
          ],
        },
        include: { category: true, depot: true },
        take: 30,
      }),
      ctx.prisma.vehicle.aggregate({ where: { isActive: true, purchaseDate: { not: null } }, _min: { purchaseDate: true }, _max: { purchaseDate: true } }),
      ctx.prisma.vehicle.aggregate({ where: { isActive: true }, _sum: { currentBookValue: true } }),
    ]);

    const rentedCount = byStatus.find((s) => s.status === "RENTED")?._count ?? 0;
    const availableCount = byStatus.find((s) => s.status === "AVAILABLE")?._count ?? 0;
    const utilisation = total ? Math.round((rentedCount / total) * 100) : 0;

    const depotIds = byDepot.map((x) => x.depotId);
    const categoryIds = byCategory.map((x) => x.categoryId);
    const [names, categoryNames] = await Promise.all([
      depotIds.length
        ? ctx.prisma.depot.findMany({
            where: { id: { in: depotIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([] as Array<{ id: string; name: string }>),
      categoryIds.length
        ? ctx.prisma.vehicleCategory.findMany({
            where: { id: { in: categoryIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([] as Array<{ id: string; name: string }>),
    ]);

    return {
      total,
      availableCount,
      rentedCount,
      utilisation,
      byStatus: byStatus.map((s) => ({ status: s.status, count: s._count })),
      byDepot: byDepot.map((d) => ({ depotId: d.depotId, name: names.find((x) => x.id === d.depotId)?.name ?? "—", count: d._count })),
      byCategory: byCategory.map((c) => ({ categoryId: c.categoryId, name: categoryNames.find((x) => x.id === c.categoryId)?.name ?? "—", count: c._count })),
      attention,
      fleetBookValue: Number(bookValueSum._sum.currentBookValue ?? 0),
      oldestPurchaseDate: avgAge._min.purchaseDate,
      newestPurchaseDate: avgAge._max.purchaseDate,
    };
  }),

  attentionList: staffProcedure
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(5).max(200).default(25),
        sortBy: z.enum(["dueDate", "internalCode", "issue"]).default("dueDate"),
        sortDir: z.enum(["asc", "desc"]).default("asc"),
      }),
    )
    .query(async ({ ctx, input }) => {
      const now = new Date();
      const in30 = new Date(now.getTime() + 30 * 86400000);
      const in14 = new Date(now.getTime() + 14 * 86400000);

      const vehicles = await ctx.prisma.vehicle.findMany({
        where: {
          isActive: true,
          OR: [
            { regoExpiry: { lt: in30 } },
            { ctpExpiry: { lt: in30 } },
            { insuranceExpiry: { lt: in30 } },
            { nextServiceDueDate: { lt: in14 } },
          ],
        },
        include: {
          category: { select: { name: true } },
          depot: { select: { name: true } },
        },
      });

      const rows: Array<{
        id: string;
        vehicleId: string;
        internalCode: string;
        categoryName: string;
        depotName: string;
        issue: "REGO" | "CTP" | "INSURANCE" | "SERVICE";
        issueLabel: string;
        dueDate: Date;
      }> = [];

      for (const v of vehicles) {
        if (v.regoExpiry && v.regoExpiry < in30) {
          rows.push({
            id: `${v.id}:REGO`,
            vehicleId: v.id,
            internalCode: v.internalCode,
            categoryName: v.category.name,
            depotName: v.depot.name,
            issue: "REGO",
            issueLabel: "Rego",
            dueDate: v.regoExpiry,
          });
        }
        if (v.ctpExpiry && v.ctpExpiry < in30) {
          rows.push({
            id: `${v.id}:CTP`,
            vehicleId: v.id,
            internalCode: v.internalCode,
            categoryName: v.category.name,
            depotName: v.depot.name,
            issue: "CTP",
            issueLabel: "CTP",
            dueDate: v.ctpExpiry,
          });
        }
        if (v.insuranceExpiry && v.insuranceExpiry < in30) {
          rows.push({
            id: `${v.id}:INSURANCE`,
            vehicleId: v.id,
            internalCode: v.internalCode,
            categoryName: v.category.name,
            depotName: v.depot.name,
            issue: "INSURANCE",
            issueLabel: "Insurance",
            dueDate: v.insuranceExpiry,
          });
        }
        if (v.nextServiceDueDate && v.nextServiceDueDate < in14) {
          rows.push({
            id: `${v.id}:SERVICE`,
            vehicleId: v.id,
            internalCode: v.internalCode,
            categoryName: v.category.name,
            depotName: v.depot.name,
            issue: "SERVICE",
            issueLabel: "Service",
            dueDate: v.nextServiceDueDate,
          });
        }
      }

      const dir = input.sortDir === "asc" ? 1 : -1;
      rows.sort((a, b) => {
        if (input.sortBy === "internalCode") {
          return a.internalCode.localeCompare(b.internalCode) * dir;
        }
        if (input.sortBy === "issue") {
          return a.issueLabel.localeCompare(b.issueLabel) * dir;
        }
        return (a.dueDate.getTime() - b.dueDate.getTime()) * dir;
      });

      const totalCount = rows.length;
      const pageCount = Math.max(1, Math.ceil(totalCount / input.pageSize));
      const items = rows.slice((input.page - 1) * input.pageSize, input.page * input.pageSize);

      return { items, totalCount, pageCount, page: input.page, pageSize: input.pageSize };
    }),

  listVehicles: staffProcedure
    .input(
      z.object({
        depotId: z.string().optional(),
        status: z.string().optional(),
        search: z.string().optional(),
      }).optional(),
    )
    .query(({ ctx, input }) =>
      ctx.prisma.vehicle.findMany({
        where: {
          isActive: true,
          ...(input?.depotId ? { depotId: input.depotId } : {}),
          ...(input?.status ? { status: input.status as never } : {}),
          ...(input?.search
            ? {
                OR: [
                  { internalCode: { contains: input.search, mode: "insensitive" } },
                  { rego: { contains: input.search, mode: "insensitive" } },
                  { make: { contains: input.search, mode: "insensitive" } },
                  { model: { contains: input.search, mode: "insensitive" } },
                ],
              }
            : {}),
        },
        include: { category: true, depot: true },
        orderBy: { internalCode: "asc" },
      }),
    ),

  /**
   * Fleet audit — scans every active vehicle for compliance / data-quality
   * issues (expired rego, missing VIN, overdue service, etc.). Pure
   * in-memory evaluation via `evaluateVehicleAudit`; no per-issue
   * round-trip.
   *
   * Filters are applied server-side so the depot-scoped filter also
   * respects the RBAC boundary (managers assigned to a depot see only
   * their depot's rows when a depot filter is active).
   */
  auditVehicles: staffProcedure
    .input(
      z
        .object({
          depotId: z.string().optional(),
          severity: z.enum(["critical", "warning", "info"]).optional(),
          checkKey: z.string().optional(),
          search: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const vehicles = await ctx.prisma.vehicle.findMany({
        where: {
          isActive: true,
          status: { notIn: [...AUDIT_EXCLUDED_STATUSES] },
          ...(input?.depotId ? { depotId: input.depotId } : {}),
          ...(input?.search
            ? {
                OR: [
                  { internalCode: { contains: input.search, mode: "insensitive" } },
                  { rego: { contains: input.search, mode: "insensitive" } },
                  { make: { contains: input.search, mode: "insensitive" } },
                  { model: { contains: input.search, mode: "insensitive" } },
                ],
              }
            : {}),
        },
        include: { category: { select: { name: true } }, depot: { select: { id: true, name: true } } },
        orderBy: { internalCode: "asc" },
      });

      type Row = {
        vehicleId: string;
        internalCode: string;
        rego: string;
        regoState: string;
        make: string;
        model: string;
        year: number;
        categoryName: string;
        depotId: string;
        depotName: string;
        checkKey: AuditCheckKey;
        severity: AuditSeverity;
        remedy: "identity" | "compliance";
        label: string;
        description: string;
        detectedAt: string | null;
        daysDelta: number | null;
      };

      const now = new Date();
      const rows: Row[] = [];
      const vehiclesWithIssues = new Set<string>();

      for (const v of vehicles) {
        const issues = evaluateVehicleAudit(v, now);
        if (issues.length === 0) continue;
        vehiclesWithIssues.add(v.id);
        for (const issue of issues) {
          if (input?.severity && issue.severity !== input.severity) continue;
          if (input?.checkKey && issue.checkKey !== input.checkKey) continue;
          rows.push({
            vehicleId: v.id,
            internalCode: v.internalCode,
            rego: v.rego,
            regoState: v.regoState,
            make: v.make,
            model: v.model,
            year: v.year,
            categoryName: v.category.name,
            depotId: v.depotId,
            depotName: v.depot.name,
            checkKey: issue.checkKey,
            severity: issue.severity,
            remedy: issue.remedy,
            label: issue.label,
            description: issue.description,
            detectedAt: issue.detectedAt,
            daysDelta: issue.daysDelta,
          });
        }
      }

      const summary = {
        totalActive: vehicles.length,
        vehiclesWithIssues: vehiclesWithIssues.size,
        critical: rows.filter((r) => r.severity === "critical").length,
        warning: rows.filter((r) => r.severity === "warning").length,
        info: rows.filter((r) => r.severity === "info").length,
      };

      return { summary, issues: rows, checks: AUDIT_CHECKS };
    }),

  vehicleDetail: staffProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    // Super-admins see the full audit trail including soft-deleted
    // documents — staff/manager/admin only see live ones. Files are
    // never hard-deleted so the record is always recoverable.
    const canSeeDeletedDocs = ctx.user.role === "SUPER_ADMIN";

    const vehicle = await ctx.prisma.vehicle.findUnique({
      where: { id: input.id },
      include: {
        category: true,
        depot: true,
        images: true,
        documents: {
          where: canSeeDeletedDocs ? undefined : { deletedAt: null },
          orderBy: { createdAt: "desc" },
          include: {
            uploadedBy: { select: { id: true, firstName: true, lastName: true } },
            relatedWorkOrder: { select: { id: true, workOrderNumber: true, type: true } },
            relatedInfringement: { select: { id: true, referenceNumber: true, type: true } },
          },
        },
        statusLog: { orderBy: { timestamp: "desc" }, take: 50 },
        bookings: {
          include: { customer: true, category: true },
          orderBy: { pickupDateTime: "desc" },
          take: 20,
        },
        inspections: { orderBy: { dateTime: "desc" }, take: 20 },
        workOrders: { orderBy: { createdAt: "desc" }, take: 20 },
        incidents: { orderBy: { dateTime: "desc" }, take: 20 },
        maintenanceSchedules: true,
        catalogueModel: {
          include: {
            documents: { orderBy: { fetchedAt: "desc" } },
          },
        },
      },
    });
    if (!vehicle) throw new TRPCError({ code: "NOT_FOUND" });

    let depreciation = null;
    if (vehicle.purchasePrice && vehicle.purchaseDate && vehicle.depreciationRate) {
      depreciation = calcDepreciation({
        purchasePrice: Number(vehicle.purchasePrice),
        purchaseDate: vehicle.purchaseDate,
        method: (vehicle.depreciationMethod as "STRAIGHT_LINE" | "DIMINISHING_VALUE") ?? "STRAIGHT_LINE",
        rate: Number(vehicle.depreciationRate),
      });
    }

    // Revenue + maintenance totals
    const revenueAgg = await ctx.prisma.booking.aggregate({
      where: { vehicleId: vehicle.id, status: { in: ["COMPLETED", "ACTIVE", "RETURNED"] } },
      _sum: { totalAmount: true },
      _count: true,
    });
    const maintenanceAgg = await ctx.prisma.maintenanceWorkOrder.aggregate({
      where: { vehicleId: vehicle.id, status: "COMPLETED" },
      _sum: { actualCost: true },
    });

    // Merged change history: status-log transitions + per-field edits
    // + document lifecycle events, all persisted via AuditLog with
    // entity=Vehicle so they merge into a single chronological feed.
    const fieldEdits = await ctx.prisma.auditLog.findMany({
      where: {
        entity: "Vehicle",
        entityId: vehicle.id,
        action: { in: ["VEHICLE_UPDATED", "VEHICLE_DOCUMENT_UPLOADED", "VEHICLE_DOCUMENT_DELETED"] },
      },
      orderBy: { timestamp: "desc" },
      take: 200,
    });

    const actorIds = Array.from(
      new Set(
        [
          ...vehicle.statusLog.map((s) => s.changedById).filter((x): x is string => !!x),
          ...fieldEdits.map((a) => a.userId).filter((x): x is string => !!x),
        ],
      ),
    );
    const actors = actorIds.length
      ? await ctx.prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, firstName: true, lastName: true },
        })
      : [];
    const actorById = new Map(actors.map((u) => [u.id, u]));

    type ChangeEntry =
      | {
          kind: "status";
          id: string;
          timestamp: Date;
          actorName: string | null;
          previousStatus: string | null;
          newStatus: string;
          reason: string | null;
        }
      | {
          kind: "field";
          id: string;
          timestamp: Date;
          actorName: string | null;
          previousData: Record<string, unknown>;
          newData: Record<string, unknown>;
        }
      | {
          kind: "document";
          id: string;
          timestamp: Date;
          actorName: string | null;
          action: "UPLOADED" | "DELETED";
          documentType: string;
          documentId: string | null;
          fileUrl: string | null;
          referenceNumber: string | null;
        };

    const nameOf = (id: string | null): string | null => {
      if (!id) return null;
      const u = actorById.get(id);
      if (!u) return null;
      return [u.firstName, u.lastName].filter(Boolean).join(" ") || null;
    };

    const changeLog: ChangeEntry[] = [
      ...vehicle.statusLog.map<ChangeEntry>((s) => ({
        kind: "status",
        id: `status:${s.id}`,
        timestamp: s.timestamp,
        actorName: nameOf(s.changedById),
        previousStatus: s.previousStatus,
        newStatus: s.newStatus,
        reason: s.reason,
      })),
      ...fieldEdits.map<ChangeEntry>((a) => {
        if (a.action === "VEHICLE_DOCUMENT_UPLOADED" || a.action === "VEHICLE_DOCUMENT_DELETED") {
          const payload = (a.action === "VEHICLE_DOCUMENT_UPLOADED" ? a.newData : a.previousData) as
            | Record<string, unknown>
            | null;
          return {
            kind: "document",
            id: `audit:${a.id}`,
            timestamp: a.timestamp,
            actorName: nameOf(a.userId),
            action: a.action === "VEHICLE_DOCUMENT_UPLOADED" ? "UPLOADED" : "DELETED",
            documentType: String(payload?.type ?? "—"),
            documentId: (payload?.documentId as string | undefined) ?? null,
            fileUrl: (payload?.fileUrl as string | undefined) ?? null,
            referenceNumber: (payload?.referenceNumber as string | undefined) ?? null,
          };
        }
        return {
          kind: "field",
          id: `audit:${a.id}`,
          timestamp: a.timestamp,
          actorName: nameOf(a.userId),
          previousData: (a.previousData ?? {}) as Record<string, unknown>,
          newData: (a.newData ?? {}) as Record<string, unknown>,
        };
      }),
    ].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    const canManageCatalogue =
      ctx.user.role === "ADMIN" || ctx.user.role === "SUPER_ADMIN";

    return {
      vehicle,
      depreciation,
      totalRevenue: Number(revenueAgg._sum.totalAmount ?? 0),
      totalBookings: revenueAgg._count,
      totalMaintenanceCost: Number(maintenanceAgg._sum.actualCost ?? 0),
      changeLog,
      canManageCatalogue,
    };
  }),

  createVehicle: managerProcedure.input(vehicleCreate).mutation(async ({ ctx, input }) => {
    const existing = await ctx.prisma.vehicle.findUnique({ where: { internalCode: input.internalCode } });
    if (existing) throw new TRPCError({ code: "CONFLICT", message: "Internal code already exists" });

    const { images, documents, status, ...vehicleData } = input;
    const initialStatus = status ?? "AVAILABLE";
    const isDisposed = (DISPOSITION_STATUSES as readonly string[]).includes(initialStatus);

    return ctx.prisma.$transaction(async (tx) => {
      const vehicle = await tx.vehicle.create({
        data: {
          ...vehicleData,
          currentBookValue: vehicleData.purchasePrice,
          status: initialStatus,
          isActive: !isDisposed,
          deletedAt: isDisposed ? new Date() : null,
          statusLog: { create: { newStatus: initialStatus, changedById: ctx.user.id, reason: "Onboarded" } },
        },
      });

      if (images && images.length > 0) {
        await tx.vehicleImage.createMany({
          data: images.map((img, i) => ({
            vehicleId: vehicle.id,
            url: img.url,
            caption: img.caption,
            checksum: img.checksum,
            isPrimary: i === 0,
            displayOrder: i,
          })),
        });
      }

      if (documents && documents.length > 0) {
        await tx.vehicleDocument.createMany({
          data: documents.map((doc) => ({
            vehicleId: vehicle.id,
            type: doc.type,
            fileUrl: doc.fileUrl,
            expiryDate: doc.expiryDate,
            notes: doc.notes,
          })),
        });
      }

      return vehicle;
    });
  }),

  bulkCreateVehicles: managerProcedure
    .input(
      z.object({
        vehicles: z.array(vehicleCreate.omit({ images: true, documents: true })).min(1).max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const internalCodes = input.vehicles.map((v) => v.internalCode);
      const regoPairs = input.vehicles.map((v) => ({ rego: v.rego, regoState: v.regoState }));

      const conflicting = await ctx.prisma.vehicle.findMany({
        where: {
          OR: [
            { internalCode: { in: internalCodes } },
            {
              OR: regoPairs.map((p) => ({
                AND: [{ rego: p.rego }, { regoState: p.regoState }],
              })),
            },
          ],
        },
        select: { internalCode: true, rego: true, regoState: true },
      });
      if (conflicting.length > 0) {
        const codes = conflicting.map((c) => c.internalCode).join(", ");
        throw new TRPCError({
          code: "CONFLICT",
          message: `Conflict with existing vehicles: ${codes}. Re-run validation.`,
        });
      }

      const result = await ctx.prisma.$transaction(async (tx) => {
        const ids: string[] = [];
        for (const raw of input.vehicles) {
          const { status, ...data } = raw;
          const initialStatus = status ?? "AVAILABLE";
          const isDisposed = (DISPOSITION_STATUSES as readonly string[]).includes(initialStatus);
          const v = await tx.vehicle.create({
            data: {
              ...data,
              currentBookValue: data.purchasePrice,
              status: initialStatus,
              isActive: !isDisposed,
              deletedAt: isDisposed ? new Date() : null,
              statusLog: {
                create: {
                  newStatus: initialStatus,
                  changedById: ctx.user.id,
                  reason: "Bulk import",
                },
              },
            },
            select: { id: true },
          });
          ids.push(v.id);
        }
        return ids;
      });

      return { created: result.length, vehicleIds: result };
    }),

  addVehicleImage: staffProcedure
    .input(z.object({
      vehicleId: z.string(),
      url: z.string().min(1),
      caption: z.string().optional(),
      checksum: z.string().optional(),
      isPrimary: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.vehicle.findUniqueOrThrow({ where: { id: input.vehicleId } });
      const existingCount = await ctx.prisma.vehicleImage.count({ where: { vehicleId: input.vehicleId } });
      const makePrimary = input.isPrimary ?? existingCount === 0;
      if (makePrimary) {
        await ctx.prisma.vehicleImage.updateMany({
          where: { vehicleId: input.vehicleId, isPrimary: true },
          data: { isPrimary: false },
        });
      }
      return ctx.prisma.vehicleImage.create({
        data: {
          vehicleId: input.vehicleId,
          url: input.url,
          caption: input.caption,
          checksum: input.checksum,
          isPrimary: makePrimary,
          displayOrder: existingCount,
        },
      });
    }),

  deleteVehicleImage: staffProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const img = await ctx.prisma.vehicleImage.findUniqueOrThrow({ where: { id: input.id } });
      await ctx.prisma.vehicleImage.delete({ where: { id: img.id } });
      if (img.isPrimary) {
        const next = await ctx.prisma.vehicleImage.findFirst({
          where: { vehicleId: img.vehicleId },
          orderBy: { displayOrder: "asc" },
        });
        if (next) {
          await ctx.prisma.vehicleImage.update({ where: { id: next.id }, data: { isPrimary: true } });
        }
      }
      return { ok: true };
    }),

  setPrimaryVehicleImage: staffProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const img = await ctx.prisma.vehicleImage.findUniqueOrThrow({ where: { id: input.id } });
      await ctx.prisma.vehicleImage.updateMany({
        where: { vehicleId: img.vehicleId, isPrimary: true },
        data: { isPrimary: false },
      });
      return ctx.prisma.vehicleImage.update({ where: { id: img.id }, data: { isPrimary: true } });
    }),

  listVehicleImages: staffProcedure
    .input(z.object({ vehicleId: z.string() }))
    .query(({ ctx, input }) =>
      ctx.prisma.vehicleImage.findMany({
        where: { vehicleId: input.vehicleId },
        orderBy: [{ isPrimary: "desc" }, { displayOrder: "asc" }],
      }),
    ),

  updateVehicleStatus: staffProcedure
    .input(
      z.object({
        vehicleId: z.string(),
        // Admin-settable statuses only. RENTED/RESERVED/IN_TRANSIT are
        // driven by the booking/transfer flow — callers must go through
        // those flows to enter or leave those states.
        status: z.enum([
          "AVAILABLE",
          "PENDING",
          "IN_MAINTENANCE",
          "ACCIDENT_REPAIRS",
          "STOLEN",
          "WRITTEN_OFF",
        ]),
        reason: z.string().min(1, "Reason is required"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const v = await ctx.prisma.vehicle.findUniqueOrThrow({ where: { id: input.vehicleId } });

      // Guardrail: never let staff flip a currently-rented vehicle out
      // of RENTED through this procedure — the check-in flow is the only
      // legitimate exit. STOLEN/WRITTEN_OFF remain available for the rare
      // real-world case where a live rental is lost.
      const isHardLoss = input.status === "STOLEN" || input.status === "WRITTEN_OFF";
      if (v.status === "RENTED" && !isHardLoss) {
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "This vehicle is currently rented — complete the check-in before changing its status. Use the check-in flow rather than this dialog.",
        });
      }

      return ctx.prisma.$transaction(async (tx) => {
        const vehicle = await tx.vehicle.update({
          where: { id: v.id },
          data: {
            status: input.status,
            statusLog: {
              create: { previousStatus: v.status, newStatus: input.status, changedById: ctx.user.id, reason: input.reason },
            },
          },
        });
        let reassignment = null;
        if (isHardLoss) {
          reassignment = await reassignFutureBookings(
            tx,
            v.id,
            ctx.user.id,
            `Vehicle ${v.internalCode} → ${input.status}`,
          );
        }
        return { vehicle, reassignment };
      });
    }),

  updateVehicle: managerProcedure
    .input(
      z.object({
        id: z.string(),
        // Identity
        internalCode: z.string().min(1).optional(),
        rego: z.string().min(1).optional(),
        regoState: z.string().min(2).optional(),
        vin: z.string().nullable().optional(),
        engineNumber: z.string().nullable().optional(),
        make: z.string().min(1).optional(),
        model: z.string().min(1).optional(),
        year: z.number().int().min(1900).max(2100).optional(),
        colour: z.string().min(1).optional(),
        fuelType: z.string().nullable().optional(),
        currentOdometerKm: z.number().int().min(0).optional(),
        // Compliance
        regoExpiry: z.coerce.date().nullable().optional(),
        ctpExpiry: z.coerce.date().nullable().optional(),
        insuranceExpiry: z.coerce.date().nullable().optional(),
        insurancePolicyNumber: z.string().nullable().optional(),
        lastServiceDate: z.coerce.date().nullable().optional(),
        lastServiceKm: z.number().int().min(0).nullable().optional(),
        nextServiceDueDate: z.coerce.date().nullable().optional(),
        nextServiceDueKm: z.number().int().min(0).nullable().optional(),
        warrantyExpiry: z.coerce.date().nullable().optional(),
        // Assignment
        categoryId: z.string().optional(),
        depotId: z.string().optional(),
        condition: z.enum(["EXCELLENT", "GOOD", "FAIR", "POOR"]).optional(),
        // Financial
        purchasePrice: z.number().nonnegative().nullable().optional(),
        purchaseDate: z.coerce.date().nullable().optional(),
        depreciationMethod: z.enum(["STRAIGHT_LINE", "DIMINISHING_VALUE"]).nullable().optional(),
        depreciationRate: z.number().nonnegative().nullable().optional(),
        // Pricing — per-vehicle overrides of the per-model defaults.
        // Set null to clear an override and re-inherit from the model.
        baseRateOverride: z.number().nonnegative().nullable().optional(),
        basePeriodHoursOverride: z.enum(["H24", "H48"]).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...patch } = input;
      const existing = await ctx.prisma.vehicle.findUnique({ where: { id } });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });

      if (patch.internalCode && patch.internalCode !== existing.internalCode) {
        const dup = await ctx.prisma.vehicle.findUnique({ where: { internalCode: patch.internalCode } });
        if (dup) throw new TRPCError({ code: "CONFLICT", message: "Internal code already in use" });
      }
      if (patch.categoryId && patch.categoryId !== existing.categoryId) {
        const cat = await ctx.prisma.vehicleCategory.findUnique({ where: { id: patch.categoryId } });
        if (!cat) throw new TRPCError({ code: "BAD_REQUEST", message: "Category not found" });
      }
      if (patch.depotId && patch.depotId !== existing.depotId) {
        const d = await ctx.prisma.depot.findUnique({ where: { id: patch.depotId } });
        if (!d) throw new TRPCError({ code: "BAD_REQUEST", message: "Depot not found" });
      }

      const previousData: Record<string, unknown> = {};
      const newData: Record<string, unknown> = {};
      for (const [key, next] of Object.entries(patch)) {
        if (next === undefined) continue;
        const prev = (existing as Record<string, unknown>)[key];
        const prevSerial = prev instanceof Date ? prev.toISOString() : prev;
        const nextSerial = next instanceof Date ? next.toISOString() : next;
        if (prevSerial === nextSerial) continue;
        if (prev == null && next == null) continue;
        // Prisma Decimal compare — toString normalises scale.
        if (
          prev != null &&
          typeof prev === "object" &&
          "toString" in prev &&
          String(prev) === String(next)
        ) continue;
        previousData[key] = prevSerial ?? null;
        newData[key] = nextSerial ?? null;
      }

      if (Object.keys(newData).length === 0) {
        return existing;
      }

      // Keep the cached currentBookValue aligned with purchasePrice on edit,
      // matching the onboarding flow — precise depreciated values come from
      // calcDepreciation at read time.
      const data: Prisma.VehicleUpdateInput = { ...(patch as Prisma.VehicleUpdateInput) };
      if (patch.purchasePrice !== undefined) {
        data.currentBookValue = patch.purchasePrice;
      }

      return ctx.prisma.$transaction(async (tx) => {
        const updated = await tx.vehicle.update({ where: { id }, data });
        await tx.auditLog.create({
          data: {
            userId: ctx.user.id,
            action: "VEHICLE_UPDATED",
            entity: "Vehicle",
            entityId: id,
            category: "MUTATION",
            status: "SUCCESS",
            depotId: updated.depotId,
            previousData: previousData as Prisma.InputJsonValue,
            newData: newData as Prisma.InputJsonValue,
          },
        });
        return updated;
      });
    }),

  decommission: managerProcedure
    .input(
      z.object({
        vehicleId: z.string(),
        reason: z.enum(["SOLD", "WRITTEN_OFF", "END_OF_LIFE", "STOLEN"]),
        salePrice: z.number().optional(),
        /** D1: set true for unexpected events (STOLEN / WRITTEN_OFF) so
         *  future bookings are auto-reassigned rather than blocking. For
         *  planned decommissions (SOLD / END_OF_LIFE) leave false — staff
         *  should resolve bookings manually before selling the vehicle. */
        force: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const hardLoss = input.reason === "STOLEN" || input.reason === "WRITTEN_OFF";
      const shouldForce = input.force || hardLoss;

      if (!shouldForce) {
        const active = await ctx.prisma.booking.count({
          where: {
            vehicleId: input.vehicleId,
            status: { in: ["CONFIRMED", "ACTIVE", "CHECKED_OUT", "OVERDUE"] },
          },
        });
        if (active > 0) {
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "Vehicle has active or future bookings. Resolve them first, or pass force=true to auto-reassign future bookings.",
          });
        }
      }

      // Active rentals (CHECKED_OUT / ACTIVE / OVERDUE) are physically
      // out — we can't reassign them. Flag them separately rather than
      // blocking, so staff still get the vehicle marked correctly.
      const activeRentals = await ctx.prisma.booking.findMany({
        where: {
          vehicleId: input.vehicleId,
          status: { in: ["ACTIVE", "CHECKED_OUT", "OVERDUE"] },
        },
        select: { id: true, bookingReference: true, status: true },
      });

      // Each decommission reason now maps 1:1 to a terminal status. The
      // legacy `DECOMMISSIONED` bucket has been split into `SOLD` and
      // `END_OF_LIFE` so the fleet list makes disposal legible.
      const newStatus = input.reason; // reason enum matches status enum exactly

      return ctx.prisma.$transaction(async (tx) => {
        const previousStatus = (await tx.vehicle.findUniqueOrThrow({ where: { id: input.vehicleId }, select: { status: true } })).status;
        const vehicle = await tx.vehicle.update({
          where: { id: input.vehicleId },
          data: {
            status: newStatus,
            isActive: false,
            deletedAt: new Date(),
            notes: input.salePrice
              ? `Decommissioned via ${input.reason}, sale price A$${input.salePrice}`
              : `Decommissioned: ${input.reason}`,
            statusLog: {
              create: { previousStatus, newStatus, changedById: ctx.user.id, reason: input.reason },
            },
          },
        });
        const reassignment = await reassignFutureBookings(
          tx,
          input.vehicleId,
          ctx.user.id,
          `Vehicle ${vehicle.internalCode} → ${input.reason}`,
        );
        return { vehicle, reassignment, activeRentals };
      });
    }),

  // Work orders
  createWorkOrder: staffProcedure
    .input(
      z.object({
        vehicleId: z.string(),
        type: z.enum(["ROUTINE_SERVICE", "TYRE_REPLACEMENT", "BRAKE_SERVICE", "BATTERY", "REGO_RENEWAL", "CTP_RENEWAL", "INSURANCE_RENEWAL", "CUSTOM"]),
        priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
        title: z.string().min(1),
        description: z.string().optional(),
        estimatedHours: z.number().optional(),
        estimatedCost: z.number().optional(),
        assignedToId: z.string().optional(),
        // A5: schedule the service window up front so availability can
        // keep the vehicle out of the booking pool for that time.
        scheduledStartAt: z.coerce.date().optional(),
        scheduledEndAt: z.coerce.date().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.scheduledStartAt && input.scheduledEndAt && input.scheduledEndAt <= input.scheduledStartAt) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Scheduled end must be after scheduled start.",
        });
      }
      const vehicle = await ctx.prisma.vehicle.findUniqueOrThrow({ where: { id: input.vehicleId } });
      const wo = await withUniqueRetry(
        () =>
          ctx.prisma.maintenanceWorkOrder.create({
            data: {
              workOrderNumber: generateWorkOrderNumber(),
              vehicleId: input.vehicleId,
              depotId: vehicle.depotId,
              type: input.type,
              priority: input.priority,
              title: input.title,
              description: input.description,
              estimatedHours: input.estimatedHours,
              estimatedCost: input.estimatedCost,
              reportedById: ctx.user.id,
              assignedToId: input.assignedToId,
              scheduledStartAt: input.scheduledStartAt,
              scheduledEndAt: input.scheduledEndAt,
              logs: { create: { action: "OPEN", performedById: ctx.user.id, notes: "Work order created" } },
            },
          }),
        { constraintFields: ["workOrderNumber"] },
      );

      if (input.assignedToId) {
        await sendNotification({
          userId: input.assignedToId,
          type: "WORK_ORDER_ASSIGNED",
          category: "OPERATIONAL",
          channels: ["IN_APP", "EMAIL"],
          subject: `Work order ${wo.workOrderNumber} assigned to you`,
          title: `Work order ${wo.workOrderNumber}`,
          body: `${input.title}\n\nPriority: ${input.priority}\nVehicle: ${vehicle.internalCode}\n${input.description}`,
          data: { workOrderId: wo.id, vehicleId: input.vehicleId, priority: input.priority },
          sentById: ctx.user.id,
        });
      }

      await trackServer({
        event: SERVER_EVENTS.maintenanceCreated,
        distinctId: ctx.user.id,
        properties: {
          workOrderId: wo.id,
          workOrderNumber: wo.workOrderNumber,
          vehicleId: input.vehicleId,
          type: input.type,
          priority: input.priority,
          scheduledStartAt: input.scheduledStartAt?.toISOString() ?? null,
          scheduledEndAt: input.scheduledEndAt?.toISOString() ?? null,
          assigned: !!input.assignedToId,
        },
      });

      return wo;
    }),

  updateWorkOrderStatus: staffProcedure
    .input(
      z.object({
        id: z.string(),
        status: z.enum(["OPEN", "ASSIGNED", "IN_PROGRESS", "AWAITING_PARTS", "COMPLETED", "CANCELLED"]),
        actualCost: z.number().optional(),
        actualHours: z.number().optional(),
        notes: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const wo = await ctx.prisma.maintenanceWorkOrder.findUniqueOrThrow({
        where: { id: input.id },
        include: { vehicle: { include: { depot: { select: { slug: true } } } } },
      });
      const data: Record<string, unknown> = { status: input.status };
      if (input.status === "IN_PROGRESS" && !wo.startedAt) data.startedAt = new Date();
      if (input.status === "COMPLETED") {
        data.completedAt = new Date();
        if (input.actualCost != null) data.actualCost = input.actualCost;
        if (input.actualHours != null) data.actualHours = input.actualHours;
      }
      const updated = await ctx.prisma.maintenanceWorkOrder.update({
        where: { id: wo.id },
        data: {
          ...data,
          logs: { create: { action: input.status, performedById: ctx.user.id, notes: input.notes } },
        },
      });
      // Bring vehicle back to available when WO completes
      if (input.status === "COMPLETED" && wo.vehicle.status === "IN_MAINTENANCE") {
        await ctx.prisma.vehicle.update({
          where: { id: wo.vehicleId },
          data: {
            status: "AVAILABLE",
            lastServiceDate: new Date(),
            lastServiceKm: wo.vehicle.currentOdometerKm,
            statusLog: { create: { previousStatus: "IN_MAINTENANCE", newStatus: "AVAILABLE", changedById: ctx.user.id, reason: `WO ${wo.workOrderNumber} complete` } },
          },
        });
      }
      if (input.status === "IN_PROGRESS" && wo.vehicle.status !== "IN_MAINTENANCE") {
        await ctx.prisma.vehicle.update({
          where: { id: wo.vehicleId },
          data: {
            status: "IN_MAINTENANCE",
            statusLog: { create: { previousStatus: wo.vehicle.status, newStatus: "IN_MAINTENANCE", changedById: ctx.user.id, reason: `WO ${wo.workOrderNumber} started` } },
          },
        });
      }
      if (input.status === "COMPLETED" || input.status === "CANCELLED") {
        await autoCloseByTarget(ctx.prisma, "MaintenanceWorkOrder", wo.id, {
          types: ["MAINTENANCE_WORK_ORDER"],
          reason: input.status === "COMPLETED" ? "completed" : "cancelled",
          closingUserId: ctx.user.id,
        });
      }

      await trackServer({
        event: SERVER_EVENTS.maintenanceStatusChanged,
        distinctId: ctx.user.id,
        properties: {
          workOrderId: wo.id,
          workOrderNumber: wo.workOrderNumber,
          vehicleId: wo.vehicleId,
          status: input.status,
          actualCostAud: input.actualCost ?? null,
        },
        ...(wo.vehicle.depot?.slug ? { groups: { depot: wo.vehicle.depot.slug } } : {}),
      });

      return updated;
    }),

  workOrderDetail: staffProcedure.input(z.object({ id: z.string() })).query(({ ctx, input }) =>
    ctx.prisma.maintenanceWorkOrder.findUnique({
      where: { id: input.id },
      include: { vehicle: { include: { category: true } }, assignedTo: true, reportedBy: true, parts: true, logs: { orderBy: { timestamp: "desc" } } },
    }),
  ),

  // Incidents
  createIncident: staffProcedure
    .input(
      z.object({
        vehicleId: z.string(),
        bookingId: z.string().optional(),
        customerId: z.string().optional(),
        type: z.enum(["ACCIDENT", "THEFT", "VANDALISM", "BREAKDOWN", "CUSTOMER_DAMAGE", "WEATHER", "INFRINGEMENT", "OTHER"]),
        severity: z.enum(["MINOR", "MODERATE", "MAJOR", "TOTAL_LOSS"]),
        dateTime: z.coerce.date(),
        location: z.string().optional(),
        description: z.string().min(1),
        estimatedDamageCost: z.number().optional(),
        customerLiable: z.boolean().default(false),
        customerChargeAmount: z.number().optional(),
      }),
    )
    .meta({ audit: { customerIdPath: "customerId" } })
    .mutation(async ({ ctx, input }) => {
      const incident = await withUniqueRetry(
        () =>
          ctx.prisma.$transaction(async (tx) => {
            const inc = await tx.incident.create({
              data: {
                incidentNumber: generateIncidentNumber(),
                ...input,
                reportedById: ctx.user.id,
              },
            });
            await recordIncidentForCustomer(tx, input.customerId);
            return inc;
          }),
        { constraintFields: ["incidentNumber"] },
      );

      // Notify managers at the depot (operational).
      const vehicle = await ctx.prisma.vehicle.findUnique({
        where: { id: input.vehicleId },
        select: { depotId: true, internalCode: true },
      });
      const managers = await ctx.prisma.user.findMany({
        where: {
          role: { in: ["MANAGER", "ADMIN"] },
          deletedAt: null,
          OR: [{ depotId: vehicle?.depotId ?? undefined }, { depotId: null }],
        },
        select: { id: true },
      });
      for (const m of managers) {
        await sendNotification({
          userId: m.id,
          type: "INCIDENT_REPORTED",
          category: "OPERATIONAL",
          channels: ["IN_APP", "EMAIL"],
          subject: `Incident ${incident.incidentNumber} — ${input.severity} ${input.type}`,
          title: `Incident ${incident.incidentNumber}`,
          body: `A new ${input.severity} ${input.type} incident was reported on ${vehicle?.internalCode ?? "vehicle"}.\n\n${input.description}`,
          data: { incidentId: incident.id, vehicleId: input.vehicleId, severity: input.severity, type: input.type },
          sentById: ctx.user.id,
        });
      }

      await trackServer({
        event: SERVER_EVENTS.incidentCreated,
        distinctId: input.customerId ?? ctx.user.id,
        properties: {
          incidentId: incident.id,
          incidentNumber: incident.incidentNumber,
          type: input.type,
          severity: input.severity,
          vehicleId: input.vehicleId,
          bookingId: input.bookingId ?? null,
          customerLiable: input.customerLiable,
          estimatedDamageAud: input.estimatedDamageCost ?? null,
          actorUserId: ctx.user.id,
        },
      });

      return incident;
    }),

  listIncidents: staffProcedure.query(({ ctx }) =>
    ctx.prisma.incident.findMany({
      include: { vehicle: true, booking: true },
      orderBy: { dateTime: "desc" },
      take: 100,
    }),
  ),

  incidentDetail: staffProcedure.input(z.object({ id: z.string() })).query(({ ctx, input }) =>
    ctx.prisma.incident.findUnique({
      where: { id: input.id },
      include: {
        vehicle: { include: { category: true } },
        booking: { include: { customer: true } },
        reportedBy: true,
        assignedTo: true,
        photos: true,
        notes: { include: { user: true }, orderBy: { createdAt: "desc" } },
      },
    }),
  ),

  /**
   * D2: one-click "charge customer" on an incident. Creates the damage
   * charge payment(s), captures from the bond ledger when there's still
   * an active hold, and transitions the incident to RESOLVED. Idempotent
   * via the `chargeReference` check: running it twice won't double-charge.
   *
   * Behaviour depends on the state of the bond at the time of the charge:
   *   - Bond still HELD → capture up to the damage amount from the bond;
   *     any excess creates a second PENDING payment for card-on-file
   *     follow-up.
   *   - Bond already RELEASED / FULLY_CAPTURED → create a PENDING card
   *     charge for the whole amount. Staff processes it through the
   *     normal payment flow.
   */
  chargeCustomerForIncident: managerProcedure
    .input(
      z.object({
        incidentId: z.string(),
        /** Optional override — if not provided, uses the incident's
         *  recorded `customerChargeAmount`. */
        amount: z.number().positive().optional(),
        notes: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const incident = await ctx.prisma.incident.findUniqueOrThrow({
        where: { id: input.incidentId },
        include: {
          booking: {
            include: { bondLedger: true, pickupDepot: { select: { slug: true } } },
          },
        },
      });
      if (!incident.booking) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Incident must be linked to a booking before charging." });
      }
      if (!incident.customerLiable) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Incident must be marked customerLiable before charging." });
      }
      const amount = input.amount ?? Number(incident.customerChargeAmount ?? 0);
      if (amount <= 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No charge amount set on incident." });
      }
      const bookingId = incident.booking.id;
      const customerId = incident.booking.customerId;

      // Idempotency: if a DAMAGE_CHARGE payment already references this
      // incident, abort — the charge has already been applied.
      const chargeReference = `INC-${incident.incidentNumber}`;
      const existing = await ctx.prisma.payment.findFirst({
        where: { reference: chargeReference },
        select: { id: true },
      });
      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "Customer has already been charged for this incident." });
      }

      const bond = incident.booking!.bondLedger;
      const bondHeld =
        bond && bond.status === "HELD" ? Number(bond.heldAmount) - Number(bond.capturedAmount) : 0;
      const fromBond = Math.min(bondHeld, amount);
      const fromCard = Math.round((amount - fromBond) * 100) / 100;

      // Capture the bond hold at Stripe BEFORE the DB transaction — never hold
      // a Postgres transaction open across a Stripe round-trip. A manual hold
      // is single-capture, so this consumes the hold (Stripe releases the
      // rest); any excess is billed to the card as a PENDING follow-up below.
      let bondChargeId: string | null = null;
      if (fromBond > 0 && bond) {
        try {
          const capture = await capturePaymentIntent(bond.stripePaymentIntentId, {
            amountToCaptureCents: Math.round(fromBond * 100),
            idempotencyKey: `bond-capture-incident-${incident.id}`,
          });
          bondChargeId = capture.latestChargeId;
        } catch (err) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Stripe could not capture the bond hold: ${
              err instanceof Error ? err.message : "unknown error"
            }. No charge was applied.`,
          });
        }
      }

      const result = await ctx.prisma.$transaction(async (tx) => {
        const payments: { id: string; amount: number; source: "BOND" | "CARD" }[] = [];

        if (fromBond > 0 && bond) {
          const bondPayment = await tx.payment.create({
            data: {
              reference: chargeReference,
              bookingId,
              customerId,
              type: "DAMAGE_CHARGE",
              method: "STRIPE",
              amount: fromBond,
              status: "SUCCEEDED",
              // Link the Stripe ids so reconcile matches this to the charge.
              stripePaymentIntentId: bond.stripePaymentIntentId,
              stripeChargeId: bondChargeId,
              notes: input.notes ?? `Damage charge captured from bond for incident ${incident.incidentNumber}`,
              processedById: ctx.user.id,
              processedAt: new Date(),
            },
          });
          const newCaptured = Number(bond.capturedAmount) + fromBond;
          const newReleased = Math.max(0, Number(bond.heldAmount) - newCaptured);
          const prior = Array.isArray(bond.deductions) ? (bond.deductions as unknown[]) : [];
          await tx.bondLedger.update({
            where: { bookingId },
            data: {
              capturedAmount: newCaptured,
              releasedAmount: newReleased,
              // Single-capture: the hold is finalised once captured (Stripe
              // released the remainder), so always land terminal.
              status: "FULLY_CAPTURED",
              deductions: [
                ...prior,
                { reason: `Incident ${incident.incidentNumber}`, amount: fromBond },
              ] as Prisma.InputJsonValue,
            },
          });
          payments.push({ id: bondPayment.id, amount: fromBond, source: "BOND" });
        }

        if (fromCard > 0) {
          const cardPayment = await tx.payment.create({
            data: {
              reference: `${chargeReference}-CARD`,
              bookingId,
              customerId,
              type: "DAMAGE_CHARGE",
              method: "STRIPE",
              amount: fromCard,
              status: "PENDING",
              notes:
                input.notes ??
                `Damage charge remainder for incident ${incident.incidentNumber} — bond insufficient, follow-up card charge required`,
              processedById: ctx.user.id,
            },
          });
          payments.push({ id: cardPayment.id, amount: fromCard, source: "CARD" });
        }

        const updatedIncident = await tx.incident.update({
          where: { id: incident.id },
          data: {
            status: "RESOLVED",
            resolvedAt: incident.resolvedAt ?? new Date(),
            actualDamageCost: incident.actualDamageCost ?? amount,
            customerChargeAmount: amount,
          },
        });

        return { incident: updatedIncident, payments, fromBond, fromCard };
      });

      // Issue an ATO §29-75 adjustment note for the damage charge. Each
      // payment row (bond capture and / or card capture) gets a
      // separate adjustment so the audit trail mirrors the cash flow.
      try {
        const { tryIssueAdjustmentForBooking } = await import(
          "@/server/services/invoice-lifecycle"
        );
        for (const p of result.payments) {
          await tryIssueAdjustmentForBooking({
            bookingId,
            type: "INCREASE",
            reason: "DAMAGE",
            description: `Damage charge — incident ${incident.incidentNumber}${
              p.source === "BOND" ? " (captured from bond)" : ""
            }`,
            lineItems: [
              {
                description: `Damage to vehicle (incident ${incident.incidentNumber})`,
                detail:
                  input.notes ??
                  (p.source === "BOND"
                    ? "Captured from security bond hold"
                    : "Charged to card on file"),
                quantity: 1,
                unitPrice: p.amount,
                totalPrice: p.amount,
                gstIncluded: true,
              },
            ],
            paymentId: p.id,
            issuedById: ctx.user.id,
          });
        }
      } catch {
        // tryIssueAdjustmentForBooking already logs internal failures.
      }

      await trackServer({
        event: SERVER_EVENTS.incidentCustomerCharged,
        distinctId: customerId,
        properties: {
          incidentId: incident.id,
          incidentNumber: incident.incidentNumber,
          bookingId,
          amountAud: amount,
          fromBondAud: result.fromBond,
          fromCardAud: result.fromCard,
          actorUserId: ctx.user.id,
        },
        ...(incident.booking?.pickupDepot?.slug
          ? { groups: { depot: incident.booking.pickupDepot.slug } }
          : {}),
      });

      return result;
    }),

  /**
   * D3: same shape as D2 for infringements. Creates an
   * INFRINGEMENT_RECOVERY Payment, advances status to CUSTOMER_CHARGED.
   * Infringements are rarer than damage and typically charged to the
   * card on file (not the bond) because they surface after the rental
   * is closed. Bond capture is not attempted here.
   */
  chargeCustomerForInfringement: staffProcedure
    .input(
      z.object({
        infringementId: z.string(),
        amount: z.number().positive().optional(),
        notes: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const inf = await ctx.prisma.infringement.findUniqueOrThrow({
        where: { id: input.infringementId },
      });
      if (!inf.customerId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Infringement must be nominated to a customer first." });
      }
      if (inf.status !== "NOMINATED" && inf.status !== "CUSTOMER_CHARGED") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Infringement must be NOMINATED before charging (currently ${inf.status}).`,
        });
      }
      // Honourable lever: infringement admin-fee markup. A flat fee is
      // added on top of the issuer amount when we pass through to the
      // customer. Configurable via the `infringement.adminFee` system
      // setting; default A$55. Stored on the Infringement so the
      // breakdown appears correctly on receipts and statements.
      const issuerAmount = input.amount ?? Number(inf.amount);
      if (issuerAmount <= 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Infringement has no positive amount." });
      }
      const adminFeeSetting = await ctx.prisma.systemSetting.findUnique({
        where: { key: "infringement.adminFee" },
      });
      const adminFee =
        Number(inf.adminFee) > 0
          ? Number(inf.adminFee)
          : typeof adminFeeSetting?.value === "number"
            ? Number(adminFeeSetting.value)
            : 55;
      const amount = issuerAmount + adminFee;

      const chargeReference = `INFR-${inf.referenceNumber}`;
      const existing = await ctx.prisma.payment.findFirst({
        where: { reference: chargeReference },
        select: { id: true },
      });
      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "Customer has already been charged for this infringement." });
      }

      const result = await ctx.prisma.$transaction(async (tx) => {
        const payment = await tx.payment.create({
          data: {
            reference: chargeReference,
            bookingId: inf.bookingId,
            customerId: inf.customerId!,
            type: "INFRINGEMENT_RECOVERY",
            method: "STRIPE",
            amount,
            status: "PENDING",
            notes:
              input.notes ??
              `Infringement ${inf.referenceNumber} (${inf.type}) — issuer A$${issuerAmount.toFixed(2)} + admin fee A$${adminFee.toFixed(2)}`,
            processedById: ctx.user.id,
          },
        });
        const updatedInf = await tx.infringement.update({
          where: { id: inf.id },
          data: {
            status: "CUSTOMER_CHARGED",
            adminFee,
            customerNotifiedAt: inf.customerNotifiedAt ?? new Date(),
          },
        });
        // Reflect the new charge in the booking's running balance so
        // the staff Payments console and the customer portal both
        // surface the outstanding amount. Mirrors the canonical
        // pattern in bookingSettlement.addManualCharge.
        if (inf.bookingId) {
          const booking = await tx.booking.findUnique({
            where: { id: inf.bookingId },
            select: { balanceDue: true },
          });
          if (booking) {
            await tx.booking.update({
              where: { id: inf.bookingId },
              data: {
                balanceDue:
                  Math.round((Number(booking.balanceDue) + amount) * 100) /
                  100,
              },
            });
          }
        }
        return { infringement: updatedInf, payment };
      });

      if (inf.bookingId) {
        try {
          const { tryIssueAdjustmentForBooking } = await import(
            "@/server/services/invoice-lifecycle"
          );
          await tryIssueAdjustmentForBooking({
            bookingId: inf.bookingId,
            type: "INCREASE",
            reason: "INFRINGEMENT",
            description: `Infringement recovery — ${inf.type} ${inf.referenceNumber}`,
            lineItems: [
              {
                description: `Issuer fine — ${inf.issuer} ${inf.referenceNumber}`,
                quantity: 1,
                unitPrice: issuerAmount,
                totalPrice: issuerAmount,
                gstIncluded: true,
              },
              ...(adminFee > 0
                ? [
                    {
                      description: "Administration fee",
                      quantity: 1,
                      unitPrice: adminFee,
                      totalPrice: adminFee,
                      gstIncluded: true,
                    },
                  ]
                : []),
            ],
            paymentId: result.payment.id,
            issuedById: ctx.user.id,
          });
        } catch {
          // tryIssueAdjustmentForBooking already logs.
        }
      }

      return result;
    }),

  updateIncidentStatus: staffProcedure
    .input(z.object({
      id: z.string(),
      status: z.enum(["REPORTED", "UNDER_INVESTIGATION", "ASSESSED", "RESOLVED", "CLOSED", "INSURANCE_CLAIM"]),
      resolution: z.string().optional(),
      actualDamageCost: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const updated = await ctx.prisma.incident.update({
        where: { id: input.id },
        data: {
          status: input.status,
          resolution: input.resolution,
          actualDamageCost: input.actualDamageCost,
          ...(input.status === "RESOLVED" || input.status === "CLOSED" ? { resolvedAt: new Date() } : {}),
        },
      });
      await trackServer({
        event: SERVER_EVENTS.incidentStatusChanged,
        distinctId: updated.customerId ?? ctx.user.id,
        properties: {
          incidentId: updated.id,
          incidentNumber: updated.incidentNumber,
          status: input.status,
          bookingId: updated.bookingId,
          actorUserId: ctx.user.id,
        },
      });
      return updated;
    }),

  // Infringements
  createInfringement: staffProcedure
    .input(
      z.object({
        vehicleId: z.string(),
        bookingId: z.string().optional(),
        customerId: z.string().optional(),
        type: z.enum(["SPEEDING", "PARKING", "TOLL", "RED_LIGHT", "OTHER"]),
        issuer: z.string(),
        referenceNumber: z.string(),
        offenceDate: z.coerce.date(),
        amount: z.number(),
        dueDate: z.coerce.date().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const inf = await ctx.prisma.infringement.create({ data: input });
      await trackServer({
        event: SERVER_EVENTS.infringementCreated,
        distinctId: input.customerId ?? ctx.user.id,
        properties: {
          infringementId: inf.id,
          referenceNumber: inf.referenceNumber,
          type: input.type,
          issuer: input.issuer,
          amountAud: input.amount,
          vehicleId: input.vehicleId,
          bookingId: input.bookingId ?? null,
          actorUserId: ctx.user.id,
        },
      });
      return inf;
    }),

  listInfringements: staffProcedure.query(({ ctx }) =>
    ctx.prisma.infringement.findMany({
      include: { vehicle: true, booking: { include: { customer: true } } },
      orderBy: { offenceDate: "desc" },
      take: 100,
    }),
  ),

  nominateInfringement: staffProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const inf = await ctx.prisma.infringement.findUniqueOrThrow({
        where: { id: input.id },
        include: {
          booking: { include: { customer: { select: { firstName: true } } } },
        },
      });
      if (!inf.booking) throw new TRPCError({ code: "BAD_REQUEST", message: "No booking linked" });
      const updated = await ctx.prisma.infringement.update({
        where: { id: inf.id },
        data: {
          status: "NOMINATED",
          customerId: inf.booking.customerId,
          nominatedAt: new Date(),
          customerNotifiedAt: new Date(),
        },
      });

      const { default: InfringementNominatedEmail } = await import(
        "../../../../emails/infringement-nominated"
      );
      const { render: renderEmail } = await import("@react-email/render");
      const { createElement } = await import("react");
      const { getBranding } = await import("@/lib/branding");
      const { siteName } = await getBranding();
      const { formatCurrency } = await import("@/lib/utils");
      const portalUrl = `${
        process.env.AUTH_URL ??
        process.env.APP_URL ??
        process.env.NEXTAUTH_URL ??
        "http://localhost:3000"
      }/dashboard/bookings/${inf.bookingId}`;
      const formattedOffenceDate = inf.offenceDate.toLocaleDateString("en-AU", {
        dateStyle: "medium",
      });
      const amountLabel = formatCurrency(Number(inf.amount));
      const dueDateLabel = inf.dueDate
        ? new Date(inf.dueDate).toLocaleDateString("en-AU", { dateStyle: "medium" })
        : null;
      const html = await renderEmail(
        createElement(InfringementNominatedEmail, {
          customerName: inf.booking.customer?.firstName ?? "there",
          bookingReference: inf.booking.bookingReference,
          referenceNumber: inf.referenceNumber,
          type: inf.type.replace(/_/g, " ").toLowerCase(),
          issuer: inf.issuer,
          offenceDate: formattedOffenceDate,
          amount: amountLabel,
          dueDate: dueDateLabel,
          portalUrl,
          siteName,
        }),
      );

      await sendNotification({
        userId: inf.booking.customerId,
        type: "INFRINGEMENT_NOMINATED",
        channels: ["EMAIL"],
        subject: `Action required: ${inf.type.toLowerCase().replace(/_/g, " ")} infringement ${inf.referenceNumber}`,
        title: "Infringement nominated",
        body:
          `${inf.issuer} issued a ${inf.type.toLowerCase().replace(/_/g, " ")} infringement (${inf.referenceNumber}) on ${formattedOffenceDate} during your hire on booking ${inf.booking.bookingReference}. ` +
          `Amount: ${amountLabel}.${dueDateLabel ? ` Due by ${dueDateLabel}.` : ""} ` +
          `Pay via your customer portal: ${portalUrl}`,
        html,
        templateKey: "infringement-nominated",
        bookingId: inf.bookingId ?? undefined,
        data: {
          referenceNumber: inf.referenceNumber,
          offenceDate: inf.offenceDate.toISOString(),
          amount: Number(inf.amount),
        },
        sentById: ctx.user.id,
      });

      await trackServer({
        event: SERVER_EVENTS.infringementNominated,
        distinctId: inf.booking.customerId,
        properties: {
          infringementId: inf.id,
          referenceNumber: inf.referenceNumber,
          type: inf.type,
          amountAud: Number(inf.amount),
          bookingId: inf.bookingId ?? null,
          actorUserId: ctx.user.id,
        },
      });

      return updated;
    }),

  // Vehicle owners
  createVehicleOwner: managerProcedure
    .input(z.object({
      ownerType: z.enum(["INDIVIDUAL", "COMPANY"]).default("INDIVIDUAL"),
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      companyName: z.string().optional(),
      abn: z.string().optional(),
      acn: z.string().optional(),
      email: z.string().optional(),
      phone: z.string().optional(),
      addressLine1: z.string().optional(),
      addressLine2: z.string().optional(),
      suburb: z.string().optional(),
      state: z.string().optional(),
      postcode: z.string().optional(),
      arrangementType: z.string().optional(),
      agreementRef: z.string().optional(),
      agreementExpiry: z.coerce.date().optional(),
      notes: z.string().optional(),
    }))
    .mutation(({ ctx, input }) => ctx.prisma.vehicleOwner.create({ data: input })),

  listVehicleOwners: staffProcedure
    .input(z.object({ search: z.string().optional() }).optional())
    .query(({ ctx, input }) =>
      ctx.prisma.vehicleOwner.findMany({
        where: input?.search
          ? {
              OR: [
                { firstName: { contains: input.search, mode: "insensitive" } },
                { lastName: { contains: input.search, mode: "insensitive" } },
                { companyName: { contains: input.search, mode: "insensitive" } },
                { abn: { contains: input.search, mode: "insensitive" } },
              ],
            }
          : undefined,
        include: { _count: { select: { vehicles: true } } },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
    ),

  // Vehicle documents
  addVehicleDocument: staffProcedure
    .input(addVehicleDocumentInput)
    .mutation(async ({ ctx, input }) => {
      const vehicle = await ctx.prisma.vehicle.findUnique({ where: { id: input.vehicleId } });
      if (!vehicle) throw new TRPCError({ code: "NOT_FOUND" });

      return ctx.prisma.$transaction(async (tx) => {
        const now = new Date();
        const uploadedById = ctx.session?.user?.id ?? null;

        let relatedWorkOrderId: string | null = null;
        let relatedInfringementId: string | null = null;

        // Derive the VehicleDocument row up-front — per-branch logic
        // mutates it with the type-specific fields before we persist.
        const docData: Prisma.VehicleDocumentUncheckedCreateInput = {
          vehicleId: vehicle.id,
          type: input.type,
          fileUrl: input.fileUrl,
          thumbnailUrl: input.thumbnailUrl ?? null,
          notes: input.notes ?? null,
          uploadedById,
          expiryDate: null,
          issueDate: null,
          cost: null,
          referenceNumber: null,
          relatedWorkOrderId: null,
          relatedInfringementId: null,
        };

        if (isExpiryInput(input)) {
          // Compliance doc — bump the vehicle's matching field only when
          // the new doc carries a later expiry. Never regress a stored
          // expiry from a stale re-scan.
          const field = EXPIRY_FIELD[input.type];
          const current = vehicle[field];
          if (!current || input.expiryDate > current) {
            await tx.vehicle.update({
              where: { id: vehicle.id },
              data: { [field]: input.expiryDate },
            });
          }
          docData.expiryDate = input.expiryDate;
          docData.issueDate = input.issueDate ?? null;
          docData.referenceNumber = input.referenceNumber ?? null;
        } else if (isCostWorkOrderInput(input)) {
          // Cost-bearing — auto-create a COMPLETED maintenance work order
          // so the vehicle has a single ledger for running costs.
          const wo = await withUniqueRetry(
            () =>
              tx.maintenanceWorkOrder.create({
                data: {
                  workOrderNumber: generateWorkOrderNumber(),
                  vehicleId: vehicle.id,
                  depotId: vehicle.depotId,
                  type: WO_TYPE_MAP[input.type],
                  status: "COMPLETED",
                  priority: "MEDIUM",
                  title: WO_TITLE[input.type],
                  description: input.description ?? null,
                  attachments: [input.fileUrl],
                  actualCost: input.cost,
                  partsCost: input.type === "PARTS_PURCHASE" ? input.cost : null,
                  externalSupplier: input.supplier ?? null,
                  odometerAtService: input.odometerAtService ?? null,
                  reportedById: uploadedById,
                  completedAt: now,
                  startedAt: now,
                },
              }),
            { constraintFields: ["workOrderNumber"] },
          );
          relatedWorkOrderId = wo.id;

          if (input.type === "SERVICE_FEE") {
            await tx.vehicle.update({
              where: { id: vehicle.id },
              data: {
                lastServiceDate: now,
                ...(input.odometerAtService != null
                  ? { lastServiceKm: input.odometerAtService }
                  : {}),
              },
            });
          }

          docData.cost = input.cost;
          docData.issueDate = input.issueDate ?? null;
          docData.referenceNumber = input.referenceNumber ?? null;
          docData.relatedWorkOrderId = relatedWorkOrderId;
        } else if (input.type === "INFRINGEMENT") {
          const infringement = await tx.infringement.create({
            data: {
              vehicleId: vehicle.id,
              type: input.infringementType,
              issuer: input.issuer,
              referenceNumber: input.referenceNumber,
              offenceDate: input.offenceDate,
              amount: input.amount,
              dueDate: input.dueDate ?? null,
              documentUrl: input.fileUrl,
              status: "RECEIVED",
            },
          });
          relatedInfringementId = infringement.id;

          docData.cost = input.amount;
          docData.issueDate = input.offenceDate;
          docData.referenceNumber = input.referenceNumber;
          docData.relatedInfringementId = relatedInfringementId;
        } else if (input.type === "PURCHASE_RECEIPT") {
          docData.cost = input.cost ?? null;
          docData.issueDate = input.issueDate ?? null;
          docData.referenceNumber = input.referenceNumber ?? null;
        } else {
          // OTHER
          docData.issueDate = input.issueDate ?? null;
          docData.referenceNumber = input.referenceNumber ?? null;
        }

        const created = await tx.vehicleDocument.create({ data: docData });

        // Audit trail — entity=Vehicle, entityId=vehicle.id so the
        // vehicleDetail changeLog picks it up on the Status Log tab.
        await tx.auditLog.create({
          data: {
            userId: uploadedById,
            action: "VEHICLE_DOCUMENT_UPLOADED",
            entity: "Vehicle",
            entityId: vehicle.id,
            category: "MUTATION",
            status: "SUCCESS",
            depotId: vehicle.depotId,
            newData: {
              documentId: created.id,
              type: created.type,
              fileUrl: created.fileUrl,
              expiryDate: created.expiryDate?.toISOString() ?? null,
              cost: created.cost ? Number(created.cost) : null,
              referenceNumber: created.referenceNumber,
              relatedWorkOrderId: created.relatedWorkOrderId,
              relatedInfringementId: created.relatedInfringementId,
            } as Prisma.InputJsonValue,
          },
        });

        return created;
      });
    }),

  deleteVehicleDocument: staffProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const doc = await ctx.prisma.vehicleDocument.findUnique({ where: { id: input.id } });
      if (!doc || doc.deletedAt) throw new TRPCError({ code: "NOT_FOUND" });

      const vehicle = await ctx.prisma.vehicle.findUnique({
        where: { id: doc.vehicleId },
        select: { depotId: true },
      });

      return ctx.prisma.$transaction(async (tx) => {
        await tx.vehicleDocument.update({
          where: { id: input.id },
          data: { deletedAt: new Date() },
        });
        await tx.auditLog.create({
          data: {
            userId: ctx.user.id,
            action: "VEHICLE_DOCUMENT_DELETED",
            entity: "Vehicle",
            entityId: doc.vehicleId,
            category: "MUTATION",
            status: "SUCCESS",
            depotId: vehicle?.depotId ?? null,
            previousData: {
              documentId: doc.id,
              type: doc.type,
              fileUrl: doc.fileUrl,
              expiryDate: doc.expiryDate?.toISOString() ?? null,
              cost: doc.cost ? Number(doc.cost) : null,
              referenceNumber: doc.referenceNumber,
              relatedWorkOrderId: doc.relatedWorkOrderId,
              relatedInfringementId: doc.relatedInfringementId,
            } as Prisma.InputJsonValue,
          },
        });
        return { id: input.id };
      });
    }),

  // Image reordering
  reorderVehicleImages: staffProcedure
    .input(z.object({
      vehicleId: z.string(),
      imageIds: z.array(z.string()).min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.vehicle.findUniqueOrThrow({ where: { id: input.vehicleId } });
      await ctx.prisma.$transaction(
        input.imageIds.map((id, i) =>
          ctx.prisma.vehicleImage.update({
            where: { id },
            data: { displayOrder: i, isPrimary: i === 0 },
          }),
        ),
      );
      return { ok: true };
    }),
});
