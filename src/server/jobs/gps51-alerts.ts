import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { detectFleetAlerts, type FleetAlertType } from "@/server/services/gps51-alerts";
import { getQueue, monitorCron, registerWorker } from "./queue";

const QUEUE = "gps51-alerts" as const;
const log = logger.child({ job: "gps51-alerts" });

const TITLE: Record<FleetAlertType, string> = {
  TRACKER_OFFLINE: "Tracker offline",
  TRACKER_LOW_BATTERY: "Tracker battery low",
};

/**
 * Every 30 min: raise in-app alerts for trackers that went offline or are
 * reporting a low battery/voltage. Deduped to one notification per vehicle, per
 * condition, per Brisbane day (key in notification `data.key`) so a persistent
 * condition doesn't spam staff every tick. Depot-scoped like maintenance-alert:
 * staff at the vehicle's depot (or with no depot) receive it.
 */
export async function runFleetAlerts(): Promise<number> {
  const now = new Date();
  const alerts = await detectFleetAlerts(prisma, now);
  if (alerts.length === 0) return 0;

  const recipients = await prisma.user.findMany({
    where: { role: { in: ["STAFF", "MANAGER", "ADMIN"] }, status: "ACTIVE" },
    select: { id: true, depotId: true },
  });
  // Brisbane calendar day for the dedup bucket (UTC+10, no DST).
  const day = new Date(now.getTime() + 10 * 3600 * 1000).toISOString().slice(0, 10);

  let created = 0;
  for (const a of alerts) {
    const key = `tracker.${a.type}.${a.vehicleId}.${day}`;
    const exists = await prisma.notification.findFirst({
      where: { type: a.type, data: { path: ["key"], equals: key } },
      select: { id: true },
    });
    if (exists) continue;

    const targets = recipients.filter((r) => r.depotId === a.depotId || r.depotId === null);
    for (const r of targets) {
      await prisma.notification.create({
        data: {
          userId: r.id,
          type: a.type,
          category: "OPERATIONAL",
          channel: "IN_APP",
          title: `${TITLE[a.type]} — ${a.label}`,
          body: a.detail,
          data: { key, vehicleId: a.vehicleId, deviceId: a.deviceId, alert: a.type },
          status: "SENT",
          sentAt: now,
        },
      });
      created++;
    }
  }

  log.info({ alerts: alerts.length, notificationsCreated: created }, "gps51-alerts complete");
  return created;
}

export function startFleetAlertsScheduler() {
  registerWorker(QUEUE, async () => runFleetAlerts());
  monitorCron(QUEUE, "*/30 * * * *", "Australia/Brisbane");
  const q = getQueue(QUEUE);
  if (!q) return;
  q.add(
    "every-30-min",
    {},
    { repeat: { pattern: "*/30 * * * *", tz: "Australia/Brisbane" }, jobId: "repeat-30m-gps-alerts" },
  );
}
