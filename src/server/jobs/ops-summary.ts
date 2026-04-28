import { prisma } from "@/lib/prisma";
import { formatCurrency } from "@/lib/utils";
import { sendNotification } from "@/server/services/notification-sender";
import { getBranding } from "@/lib/branding";
import { getQueue, registerWorker } from "./queue";

const DAILY_QUEUE = "ops-summary" as const;
const WEEKLY_QUEUE = "revenue-summary" as const;

/**
 * Daily 07:00 — email managers a summary of their depot for the previous
 * 24h: pickups, returns, new bookings, incidents, overdue count.
 */
export async function runDailyOpsSummary(): Promise<number> {
  const depots = await prisma.depot.findMany({ where: { isActive: true } });
  const managers = await prisma.user.findMany({
    where: { role: { in: ["MANAGER", "ADMIN"] }, status: "ACTIVE" },
  });
  if (managers.length === 0) return 0;

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  let sent = 0;

  for (const depot of depots) {
    const [pickups, returns, newBookings, overdue, incidents] = await Promise.all([
      prisma.booking.count({
        where: { pickupDepotId: depot.id, actualPickupDateTime: { gte: since } },
      }),
      prisma.booking.count({
        where: { returnDepotId: depot.id, actualReturnDateTime: { gte: since } },
      }),
      prisma.booking.count({
        where: { pickupDepotId: depot.id, createdAt: { gte: since } },
      }),
      prisma.booking.count({
        where: { pickupDepotId: depot.id, status: "OVERDUE" },
      }),
      prisma.incident.count({
        where: { vehicle: { depotId: depot.id }, createdAt: { gte: since } },
      }),
    ]);

    const subject = `Daily ops — ${depot.name}`;
    const html = `<h2>${depot.name} · last 24h</h2>
<ul>
<li><strong>Pickups:</strong> ${pickups}</li>
<li><strong>Returns:</strong> ${returns}</li>
<li><strong>New bookings:</strong> ${newBookings}</li>
<li><strong>Currently overdue:</strong> ${overdue}</li>
<li><strong>Incidents reported:</strong> ${incidents}</li>
</ul>`;

    for (const m of managers.filter((m) => m.depotId === null || m.depotId === depot.id)) {
      await sendNotification({
        userId: m.id,
        type: "DAILY_OPS_SUMMARY",
        category: "OPERATIONAL",
        channels: ["EMAIL"],
        subject,
        title: subject,
        html,
        body: `${depot.name} · last 24h: ${pickups} pickups, ${returns} returns, ${newBookings} new bookings, ${overdue} overdue, ${incidents} incidents.`,
        data: { depotId: depot.id, pickups, returns, newBookings, overdue, incidents },
      });
      sent++;
    }
  }
  return sent;
}

/**
 * Weekly Monday 08:00 — revenue recap for admins covering the previous
 * completed week. Pulls totals from Booking rows whose status is
 * CHECKED_OUT, ACTIVE, RETURNED or COMPLETED during the window.
 */
export async function runWeeklyRevenueSummary(): Promise<number> {
  const admins = await prisma.user.findMany({
    where: { role: { in: ["ADMIN", "SUPER_ADMIN"] }, status: "ACTIVE" },
  });
  if (admins.length === 0) return 0;

  const now = new Date();
  const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const agg = await prisma.booking.aggregate({
    where: {
      createdAt: { gte: start, lt: now },
      status: { in: ["CHECKED_OUT", "ACTIVE", "RETURNED", "COMPLETED"] },
    },
    _sum: { totalAmount: true, gstAmount: true },
    _count: { id: true },
  });

  const total = Number(agg._sum.totalAmount ?? 0);
  const gst = Number(agg._sum.gstAmount ?? 0);
  const count = agg._count.id;
  const avg = count > 0 ? total / count : 0;

  const html = `<h2>Weekly revenue — ${start.toLocaleDateString("en-AU")} to ${now.toLocaleDateString("en-AU")}</h2>
<ul>
<li><strong>Bookings:</strong> ${count}</li>
<li><strong>Gross revenue:</strong> ${formatCurrency(total)}</li>
<li><strong>GST collected:</strong> ${formatCurrency(gst)}</li>
<li><strong>Avg booking value:</strong> ${formatCurrency(avg)}</li>
</ul>`;

  const { siteName } = await getBranding();
  for (const a of admins) {
    await sendNotification({
      userId: a.id,
      type: "WEEKLY_REVENUE_SUMMARY",
      category: "OPERATIONAL",
      channels: ["EMAIL"],
      subject: `${siteName} — weekly revenue summary`,
      title: "Weekly revenue summary",
      html,
      body: `Weekly revenue: ${count} bookings, ${formatCurrency(total)} gross, ${formatCurrency(gst)} GST, ${formatCurrency(avg)} avg.`,
      data: { count, total, gst, avg, from: start.toISOString(), to: now.toISOString() },
    });
  }
  return admins.length;
}

export function startOpsSummaryScheduler() {
  registerWorker(DAILY_QUEUE, async () => runDailyOpsSummary());
  const daily = getQueue(DAILY_QUEUE);
  if (daily) {
    daily.add(
      "daily",
      {},
      { repeat: { pattern: "0 7 * * *", tz: "Australia/Brisbane" }, jobId: "repeat-daily" },
    );
  }

  registerWorker(WEEKLY_QUEUE, async () => runWeeklyRevenueSummary());
  const weekly = getQueue(WEEKLY_QUEUE);
  if (weekly) {
    weekly.add(
      "weekly",
      {},
      { repeat: { pattern: "0 8 * * 1", tz: "Australia/Brisbane" }, jobId: "repeat-weekly" },
    );
  }
}
