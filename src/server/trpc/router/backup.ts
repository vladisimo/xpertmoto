import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  createTRPCRouter,
  superAdminProcedure,
} from "../trpc";
import { getQueue } from "@/server/jobs/queue";
import { writeAudit } from "@/server/services/audit";
import { getSettingsMap, setSetting, SETTING_DEFAULTS } from "@/lib/settings";

export const backupRouter = createTRPCRouter({
  list: superAdminProcedure
    .input(
      z.object({
        take: z.number().int().min(1).max(100).default(25),
      }),
    )
    .query(async ({ ctx, input }) => {
      const rows = await ctx.prisma.databaseBackup.findMany({
        orderBy: { startedAt: "desc" },
        take: input.take,
      });
      return rows.map((r) => ({
        id: r.id,
        startedAt: r.startedAt,
        completedAt: r.completedAt,
        durationMs: r.completedAt
          ? r.completedAt.getTime() - r.startedAt.getTime()
          : null,
        sizeBytes: r.sizeBytes ? Number(r.sizeBytes) : null,
        status: r.status,
        triggeredBy: r.triggeredBy,
        schemaVersion: r.schemaVersion,
        retentionUntil: r.retentionUntil,
        errorMessage: r.errorMessage,
      }));
    }),

  summary: superAdminProcedure.query(async ({ ctx }) => {
    const lastSuccess = await ctx.prisma.databaseBackup.findFirst({
      where: { status: "SUCCESS" },
      orderBy: { startedAt: "desc" },
      select: { startedAt: true, sizeBytes: true },
    });
    const allAgg = await ctx.prisma.databaseBackup.aggregate({
      where: { status: "SUCCESS" },
      _count: { _all: true },
      _sum: { sizeBytes: true },
    });
    return {
      lastSuccessAt: lastSuccess?.startedAt ?? null,
      lastSuccessSizeBytes: lastSuccess?.sizeBytes ? Number(lastSuccess.sizeBytes) : null,
      totalSuccessCount: allAgg._count._all,
      totalStoredBytes: allAgg._sum.sizeBytes ? Number(allAgg._sum.sizeBytes) : 0,
    };
  }),

  triggerManual: superAdminProcedure.mutation(async ({ ctx }) => {
    const q = getQueue("db-backup");
    if (!q) {
      throw new TRPCError({
        code: "SERVICE_UNAVAILABLE",
        message: "Backup queue not running (Redis unavailable).",
      });
    }
    await q.add(
      "manual",
      { triggeredBy: "MANUAL_ADMIN", triggeredById: ctx.user.id },
      { removeOnComplete: 100, removeOnFail: 100 },
    );
    await writeAudit(ctx.prisma, {
      userId: ctx.user.id,
      category: "MUTATION",
      action: "backup.manual_triggered",
      entity: "DatabaseBackup",
      status: "SUCCESS",
    });
    return { queued: true };
  }),

  getSettings: superAdminProcedure.query(async () => {
    const settings = await getSettingsMap([
      "backup.schedule",
      "backup.retentionDays",
      "backup.alertOnFailure",
    ] as const);
    return {
      schedule: (settings["backup.schedule"] ?? SETTING_DEFAULTS["backup.schedule"]) as string,
      retentionDays: (settings["backup.retentionDays"] ??
        SETTING_DEFAULTS["backup.retentionDays"]) as number,
      alertOnFailure: (settings["backup.alertOnFailure"] ??
        SETTING_DEFAULTS["backup.alertOnFailure"]) as boolean,
    };
  }),

  updateSettings: superAdminProcedure
    .input(
      z.object({
        schedule: z.string().min(9).max(64),
        retentionDays: z.number().int().min(7).max(3650),
        alertOnFailure: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await setSetting("backup.schedule", input.schedule);
      await setSetting("backup.retentionDays", input.retentionDays);
      await setSetting("backup.alertOnFailure", input.alertOnFailure);
      await writeAudit(ctx.prisma, {
        userId: ctx.user.id,
        category: "MUTATION",
        action: "backup.settings_updated",
        entity: "SystemSetting",
        status: "SUCCESS",
        newData: input,
      });
      return { ok: true };
    }),
});
