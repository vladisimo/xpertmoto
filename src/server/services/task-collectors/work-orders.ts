import type { PrismaLike } from "@/server/services/staff-ops-signals";
import type { VirtualTask } from "@/lib/tasks/types";
import type { CollectorOpts } from "./bookings";

/**
 * Open maintenance work orders (OPEN, ASSIGNED, IN_PROGRESS, AWAITING_PARTS).
 * Tier derived from WorkOrderPriority: URGENT→URGENT, HIGH→HIGH, MEDIUM→MEDIUM,
 * LOW→LOW. AWAITING_PARTS rows drop a tier since they're blocked.
 */
export async function collectWorkOrderTasks(
  db: PrismaLike,
  opts: CollectorOpts = {},
): Promise<VirtualTask[]> {
  const limit = opts.limit ?? 50;
  const depotFilter = opts.depotId ? { depotId: opts.depotId } : {};

  const rows = await db.maintenanceWorkOrder.findMany({
    where: {
      status: { in: ["OPEN", "ASSIGNED", "IN_PROGRESS", "AWAITING_PARTS"] },
      ...depotFilter,
    },
    select: {
      id: true,
      workOrderNumber: true,
      title: true,
      priority: true,
      status: true,
      depotId: true,
      scheduledStartAt: true,
      createdAt: true,
      type: true,
      vehicle: { select: { id: true, internalCode: true, rego: true } },
      assignedTo: { select: { firstName: true, lastName: true } },
    },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    take: limit,
  });

  return rows.map((wo) => {
    let tier: VirtualTask["tier"] =
      wo.priority === "URGENT"
        ? "URGENT"
        : wo.priority === "HIGH"
          ? "HIGH"
          : wo.priority === "MEDIUM"
            ? "MEDIUM"
            : "LOW";
    if (wo.status === "AWAITING_PARTS" && tier !== "URGENT") {
      tier = downshift(tier);
    }
    const assignee = wo.assignedTo
      ? `${wo.assignedTo.firstName} ${wo.assignedTo.lastName}`
      : "Unassigned";
    return {
      taskType: "MAINTENANCE_WORK_ORDER",
      targetEntityKind: "MaintenanceWorkOrder" as const,
      targetEntityId: wo.id,
      tier,
      depotId: wo.depotId,
      referenceCode: wo.workOrderNumber,
      title: wo.title,
      subtitle: `${wo.vehicle.internalCode} · ${wo.vehicle.rego}`,
      summary: `${wo.status.replace("_", " ").toLowerCase()} · ${assignee}`,
      actionUrl: `/staff/maintenance/${wo.id}`,
      actionableSince: wo.scheduledStartAt ?? wo.createdAt,
      dueAt: wo.scheduledStartAt ?? null,
      metadata: { workOrderStatus: wo.status, workOrderType: wo.type },
      links: { vehicleId: wo.vehicle.id },
    };
  });
}

function downshift(t: VirtualTask["tier"]): VirtualTask["tier"] {
  if (t === "HIGH") return "MEDIUM";
  if (t === "MEDIUM") return "LOW";
  return t;
}
