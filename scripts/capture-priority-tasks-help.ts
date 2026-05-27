/**
 * One-off (NOT wired into CI): capture real screenshots of /staff/tasks
 * (Priority Tasks) for the Help Centre "Priority tasks" article.
 *
 * The dev DB usually has no bookings due today, so the live queue renders
 * empty. To produce a HONEST, representative shot we *temporarily* reshape a
 * few existing CONFIRMED bookings into today's pickup/return/overdue windows,
 * claim one task as a throwaway staff user, and seed a handful of completed
 * history rows — then we restore every booking to its exact prior value and
 * delete everything we created in a `finally`. Nothing is left mutated.
 *
 * Auth follows scripts/capture-dashboard-help.ts: a clearly-labelled THROWAWAY
 * staff user + a minted NextAuth v5 session cookie (AUTH_SECRET), deleted after.
 *
 * Run: npx tsx scripts/capture-priority-tasks-help.ts
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { encode } from "next-auth/jwt";
import { PrismaClient, type Prisma, type BookingStatus } from "@prisma/client";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const COOKIE_NAME = "xpertmoto.session-token"; // src/lib/auth.ts (dev)
const OUT = path.resolve(__dirname, "../public/help/priority-tasks");

function readEnv(key: string): string {
  const raw = fs.readFileSync(path.resolve(__dirname, "../.env"), "utf8");
  const line = raw.split("\n").find((l) => l.startsWith(`${key}=`));
  if (!line) throw new Error(`${key} not found in .env`);
  return line.slice(key.length + 1).replace(/^['"]|['"]$/g, "").trim();
}

type BookingSnap = {
  id: string;
  status: BookingStatus;
  pickupDateTime: Date;
  returnDateTime: Date;
  depotId: string;
  returnDepotId: string;
  overdueStage: number;
};

async function main() {
  const prisma = new PrismaClient();
  const secret = readEnv("AUTH_SECRET");
  fs.mkdirSync(OUT, { recursive: true });

  const depot = await prisma.depot.findFirst({ select: { id: true, name: true } });
  if (!depot) throw new Error("no depot in DB");

  // Three CONFIRMED bookings with a vehicle allocated — our raw material.
  const confirmed = await prisma.booking.findMany({
    where: { status: "CONFIRMED", vehicleId: { not: null } },
    take: 3,
    select: {
      id: true,
      status: true,
      pickupDateTime: true,
      returnDateTime: true,
      depotId: true,
      returnDepotId: true,
      overdueStage: true,
    },
  });
  if (confirmed.length < 3) {
    throw new Error(`need 3 CONFIRMED bookings with a vehicle; found ${confirmed.length}`);
  }
  const snapshots: BookingSnap[] = confirmed.map((b) => ({
    id: b.id,
    status: b.status,
    pickupDateTime: b.pickupDateTime,
    returnDateTime: b.returnDateTime,
    depotId: b.depotId,
    returnDepotId: b.returnDepotId,
    overdueStage: b.overdueStage,
  }));
  const [B1, B2, B3] = snapshots as [BookingSnap, BookingSnap, BookingSnap];

  const now = new Date();
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 30, 0, 0);
  const pickupAt = new Date(Math.min(now.getTime() + 4 * 3_600_000, endOfDay.getTime())); // MEDIUM (later today)
  const returnAt = new Date(now.getTime() + 1 * 3_600_000); // HIGH (within 2h)
  const overdueAt = new Date(now.getTime() - 30 * 3_600_000); // URGENT (>24h overdue)

  // ── throwaway users ────────────────────────────────────────────────────
  const stamp = Date.now();
  const me = await prisma.user.create({
    data: {
      email: `help-screenshot-temp+me-${stamp}@example.invalid`,
      firstName: "Jordan",
      lastName: "Avery",
      role: "STAFF",
      depotId: depot.id,
      totp: { create: { encryptedSecret: "screenshot-temp-not-a-real-secret", enabled: true } },
    },
    select: { id: true, email: true, role: true, depotId: true, firstName: true, lastName: true },
  });
  const mate = await prisma.user.create({
    data: {
      email: `help-screenshot-temp+mate-${stamp}@example.invalid`,
      firstName: "Sam",
      lastName: "Rivera",
      role: "STAFF",
      depotId: depot.id,
    },
    select: { id: true },
  });
  const createdActivityIds: string[] = [];
  console.log("→ temp users", me.id, mate.id, "depot", depot.name);

  try {
    // ── reshape bookings into a varied live queue ──────────────────────────
    await prisma.booking.update({
      where: { id: B1.id },
      data: { status: "CONFIRMED", pickupDateTime: pickupAt, depotId: depot.id, returnDepotId: depot.id },
    });
    await prisma.booking.update({
      where: { id: B2.id },
      data: {
        status: "ACTIVE",
        pickupDateTime: new Date(now.getTime() - 48 * 3_600_000),
        returnDateTime: returnAt,
        depotId: depot.id,
        returnDepotId: depot.id,
      },
    });
    await prisma.booking.update({
      where: { id: B3.id },
      data: {
        status: "ACTIVE",
        pickupDateTime: new Date(now.getTime() - 72 * 3_600_000),
        returnDateTime: overdueAt,
        overdueStage: 3,
        depotId: depot.id,
        returnDepotId: depot.id,
      },
    });

    // Claim the pickup (B1) as "me" so the queue shows a claimed-by-you row and
    // the "You have work in progress" banner renders.
    const claim = await prisma.staffTaskActivity.create({
      data: {
        taskType: "BOOKING_PICKUP",
        targetEntityKind: "Booking",
        targetEntityId: B1.id,
        staffId: me.id,
        depotId: depot.id,
        tierSnapshot: "MEDIUM",
        status: "IN_PROGRESS",
        lastHeartbeatAt: now,
        actionableSinceSnapshot: pickupAt,
      },
      select: { id: true },
    });
    createdActivityIds.push(claim.id);

    // ── seed history rows (completed / abandoned, last few days) ───────────
    const hrs = (h: number) => new Date(now.getTime() - h * 3_600_000);
    const histories: Prisma.StaffTaskActivityCreateManyInput[] = [
      {
        taskType: "BOOKING_RETURN", targetEntityKind: "Booking", targetEntityId: B2.id,
        staffId: me.id, depotId: depot.id, tierSnapshot: "HIGH", status: "COMPLETED",
        startedAt: hrs(3), completedAt: hrs(2.8), actionableSinceSnapshot: hrs(3.4),
        outcome: "closed_by_claimant", outcomeNote: "Returned on time, no damage.",
      },
      {
        taskType: "BOOKING_PICKUP", targetEntityKind: "Booking", targetEntityId: B3.id,
        staffId: mate.id, depotId: depot.id, tierSnapshot: "MEDIUM", status: "COMPLETED",
        startedAt: hrs(20), completedAt: hrs(19.7), actionableSinceSnapshot: hrs(20.5),
        outcome: "manual_complete", outcomeNote: "Handover done; licence verified.",
      },
      {
        taskType: "MAINTENANCE_WORK_ORDER", targetEntityKind: "MaintenanceWorkOrder", targetEntityId: "demo-wo-1",
        staffId: mate.id, depotId: depot.id, tierSnapshot: "LOW", status: "ABANDONED",
        startedAt: hrs(26), completedAt: hrs(25.9), actionableSinceSnapshot: hrs(27),
        outcome: "abandoned_by_claimant", outcomeNote: "Waiting on parts — reassigned.",
      },
      {
        taskType: "INSPECTION_POST_HIRE", targetEntityKind: "Inspection", targetEntityId: "demo-insp-1",
        staffId: me.id, depotId: depot.id, tierSnapshot: "HIGH", status: "SUPERSEDED",
        startedAt: hrs(46), completedAt: hrs(45.6), actionableSinceSnapshot: hrs(47),
        outcome: "closed_by_other", outcomeNote: null,
      },
      {
        taskType: "BOOKING_OVERDUE_CHASE", targetEntityKind: "Booking", targetEntityId: B1.id,
        staffId: me.id, depotId: depot.id, tierSnapshot: "URGENT", status: "COMPLETED",
        startedAt: hrs(50), completedAt: hrs(49.5), actionableSinceSnapshot: hrs(53),
        outcome: "closed_by_claimant", outcomeNote: "Customer called; bike back same day.",
      },
    ];
    const made = await prisma.staffTaskActivity.createManyAndReturn({ data: histories, select: { id: true } });
    createdActivityIds.push(...made.map((r) => r.id));

    // ── auth + capture ─────────────────────────────────────────────────────
    const token = await encode({
      token: { id: me.id, sub: me.id, role: me.role, depotId: me.depotId, name: `${me.firstName} ${me.lastName}`, email: me.email },
      secret,
      salt: COOKIE_NAME,
    });

    const browser = await chromium.launch();
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 1100 },
      deviceScaleFactor: 2,
      locale: "en-AU",
      timezoneId: "Australia/Brisbane",
    });
    await ctx.addCookies([
      { name: COOKIE_NAME, value: token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
    ]);
    const page = await ctx.newPage();

    const shots: { url: string; file: string }[] = [
      { url: `${BASE}/staff/tasks`, file: "queue-overview.png" },
      { url: `${BASE}/staff/tasks?tab=history&range=7d`, file: "history-tab.png" },
    ];
    for (const { url, file } of shots) {
      await page.goto(url, { waitUntil: "networkidle" });
      await page.waitForTimeout(1800); // let the queue/history queries settle
      if (/\/login|\/verify-2fa|\/totp/.test(page.url())) {
        throw new Error(`auth bounced to ${page.url()} — session not accepted`);
      }
      const dest = path.join(OUT, file);
      await page.screenshot({ path: dest, fullPage: true });
      console.log(`  ${file} → ${dest}`);
    }

    await browser.close();
  } finally {
    // restore bookings exactly
    for (const s of snapshots) {
      await prisma.booking.update({
        where: { id: s.id },
        data: {
          status: s.status,
          pickupDateTime: s.pickupDateTime,
          returnDateTime: s.returnDateTime,
          depotId: s.depotId,
          returnDepotId: s.returnDepotId,
          overdueStage: s.overdueStage,
        },
      }).catch((e) => console.error("restore failed for", s.id, e.message));
    }
    if (createdActivityIds.length) {
      await prisma.staffTaskActivity.deleteMany({ where: { id: { in: createdActivityIds } } });
    }
    await prisma.userTotp.deleteMany({ where: { userId: me.id } });
    await prisma.user.deleteMany({ where: { id: { in: [me.id, mate.id] } } });
    console.log("→ restored bookings, deleted temp activities + users");
    await prisma.$disconnect();
  }
  console.log("done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
