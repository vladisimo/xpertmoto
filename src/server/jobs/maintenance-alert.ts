import { prisma } from "@/lib/prisma";
import { getQueue, registerWorker } from "./queue";

const QUEUE = "maintenance-alert" as const;

type Window = { days: number; label: string };
const WINDOWS: Window[] = [
  { days: 60, label: "60 days" },
  { days: 30, label: "30 days" },
  { days: 14, label: "14 days" },
  { days: 7, label: "7 days" },
];

/**
 * Daily scan: create in-app notifications for managers/staff at the depot
 * when a vehicle has a rego, CTP, insurance or scheduled-service deadline
 * inside an alert window. Dedup via a synthetic key in `data.key` — we
 * skip creating a duplicate notification if one already exists for the
 * same (vehicleId, kind, window) tuple.
 */
export async function runMaintenanceAlerts(): Promise<number> {
  const now = new Date();
  let created = 0;

  const vehicles = await prisma.vehicle.findMany({
    where: { isActive: true, status: { notIn: ["SOLD", "END_OF_LIFE", "WRITTEN_OFF", "STOLEN"] } },
    include: { depot: true, category: true },
  });

  const recipients = await prisma.user.findMany({
    where: { role: { in: ["STAFF", "MANAGER", "ADMIN"] }, status: "ACTIVE" },
    select: { id: true, depotId: true },
  });

  for (const v of vehicles) {
    type Check = { kind: string; date: Date | null; label: string };
    const checks: Check[] = [
      { kind: "rego", date: v.regoExpiry, label: "Registration" },
      { kind: "ctp", date: v.ctpExpiry, label: "CTP / Green Slip" },
      { kind: "insurance", date: v.insuranceExpiry, label: "Insurance" },
      { kind: "service", date: v.nextServiceDueDate, label: "Scheduled service" },
    ];

    for (const c of checks) {
      if (!c.date) continue;
      const daysRemaining = Math.ceil((c.date.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
      if (daysRemaining < 0) continue;
      const window = WINDOWS.find((w) => daysRemaining <= w.days);
      if (!window) continue;
      const key = `vehicle.${v.id}.${c.kind}.${window.days}`;

      const exists = await prisma.notification.findFirst({
        where: {
          type: "VEHICLE_EXPIRY",
          data: { path: ["key"], equals: key },
        },
      });
      if (exists) continue;

      const body = `${c.label} for ${v.internalCode} (${v.make} ${v.model}, ${v.rego}) expires in ${daysRemaining} day${daysRemaining === 1 ? "" : "s"}.`;

      const targets = recipients.filter(
        (r) => r.depotId === v.depotId || r.depotId === null,
      );
      for (const r of targets) {
        await prisma.notification.create({
          data: {
            userId: r.id,
            type: "VEHICLE_EXPIRY",
            category: "OPERATIONAL",
            channel: "IN_APP",
            title: `${c.label} expiring soon — ${v.internalCode}`,
            body,
            data: { key, vehicleId: v.id, kind: c.kind, daysRemaining },
            status: "SENT",
            sentAt: now,
          },
        });
        created++;
      }
    }
  }

  return created;
}

export function startMaintenanceAlertScheduler() {
  registerWorker(QUEUE, async () => runMaintenanceAlerts());
  const q = getQueue(QUEUE);
  if (!q) return;
  q.add(
    "daily",
    {},
    { repeat: { pattern: "0 6 * * *", tz: "Australia/Brisbane" }, jobId: "repeat-daily" },
  );
}
