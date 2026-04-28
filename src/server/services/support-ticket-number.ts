/**
 * Human-readable ticket numbers: SUP-YYYYMMDD-XXXX. XXXX is a daily
 * counter derived from the day's existing count so it reads naturally
 * in emails and back-office lists. Collisions are unlikely at hire-scale
 * volumes; a retry-on-conflict loop handles the rare race.
 */
import type { PrismaClient } from "@prisma/client";

export async function generateTicketNumber(prisma: PrismaClient): Promise<string> {
  const today = new Date();
  const ymd = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
  const startOfDay = new Date(today);
  startOfDay.setHours(0, 0, 0, 0);

  for (let attempt = 0; attempt < 5; attempt++) {
    const countToday = await prisma.supportTicket.count({
      where: { createdAt: { gte: startOfDay } },
    });
    const candidate = `SUP-${ymd}-${String(countToday + 1 + attempt).padStart(4, "0")}`;
    const exists = await prisma.supportTicket.findUnique({
      where: { ticketNumber: candidate },
      select: { id: true },
    });
    if (!exists) return candidate;
  }
  return `SUP-${ymd}-${Date.now().toString().slice(-4)}`;
}
