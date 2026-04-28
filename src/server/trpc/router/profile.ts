import { TRPCError } from "@trpc/server";
import bcrypt from "bcryptjs";
import { z } from "zod";

import { sendNotification } from "@/server/services/notification-sender";
import { strongPasswordField } from "@/lib/validators/auth";
import { skipAutoAudit, writeAuditAsync } from "@/server/services/audit";
import { computeFieldDiff } from "@/server/services/profile-diff";

import { createTRPCRouter, protectedProcedure, trpcRateLimit } from "../trpc";

const selfAudit = {
  audit: {
    customerIdPath: (_: unknown, ctx: unknown) =>
      (ctx as { session?: { user?: { id?: string } } }).session?.user?.id,
  },
} as const;

const phoneSchema = z
  .string()
  .trim()
  .max(40, "Phone number is too long")
  .regex(/^[\d+()\-\s]*$/u, "Phone may only contain digits, spaces, and + ( ) -")
  .optional();

/**
 * Self-serve "My Profile" router. Works for every authenticated user
 * regardless of role — customers, staff, managers, admins. Handles the
 * bits of User that the signed-in account may freely edit: display name,
 * contact phone, avatar, and password rotation.
 *
 * NOT handled here:
 *   - Email: changing the primary email requires a verification flow
 *     (TODO — separate procedure) so it's left read-only.
 *   - Role / depot / status: controlled by admins via `admin.user.*`.
 *   - Licence / passport / marketing opt-ins: customer-specific fields
 *     live on the customer router.
 */
export const profileRouter = createTRPCRouter({
  me: protectedProcedure.query(({ ctx }) =>
    ctx.prisma.user.findUnique({
      where: { id: ctx.user.id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        avatarUrl: true,
        role: true,
        passwordHash: true,
        depot: { select: { id: true, name: true } },
      },
    }).then((row) => {
      if (!row) return null;
      const { passwordHash, ...rest } = row;
      return { ...rest, hasPassword: !!passwordHash };
    }),
  ),

  updateBasics: protectedProcedure
    .input(
      z.object({
        firstName: z.string().trim().min(1, "First name is required").max(100),
        lastName: z.string().trim().min(1, "Last name is required").max(100),
        phone: phoneSchema,
      }),
    )
    .meta(selfAudit)
    .mutation(async ({ ctx, input }) => {
      const phone =
        input.phone === undefined || input.phone === "" ? null : input.phone;

      const before = await ctx.prisma.user.findUnique({
        where: { id: ctx.user.id },
        select: { firstName: true, lastName: true, phone: true },
      });

      await ctx.prisma.user.update({
        where: { id: ctx.user.id },
        data: {
          firstName: input.firstName,
          lastName: input.lastName,
          phone,
        },
      });

      const diff = computeFieldDiff(
        {
          firstName: before?.firstName ?? null,
          lastName: before?.lastName ?? null,
          phone: before?.phone ?? null,
        },
        { firstName: input.firstName, lastName: input.lastName, phone },
      );
      if (diff) {
        skipAutoAudit(ctx);
        writeAuditAsync(ctx.prisma, {
          userId: ctx.user.id,
          impersonatorId: ctx.session?.impersonatorId ?? null,
          category: "MUTATION",
          action: "profile.updateBasics",
          entity: "User",
          entityId: ctx.user.id,
          method: "tRPC",
          path: "profile.updateBasics",
          status: "SUCCESS",
          depotId: ctx.session?.user?.depotId ?? null,
          reqId: ctx.reqId,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          previousData: diff.previousData,
          newData: diff.newData,
        });
      }
      return { ok: true };
    }),

  /** Persist the avatar URL produced by /api/upload/avatar. The upload
   *  route has already validated the file (mime, size, malware scan). */
  setAvatar: protectedProcedure
    .input(z.object({ url: z.string().url().max(2048) }))
    .meta(selfAudit)
    .mutation(async ({ ctx, input }) => {
      const before = await ctx.prisma.user.findUnique({
        where: { id: ctx.user.id },
        select: { avatarUrl: true },
      });
      await ctx.prisma.user.update({
        where: { id: ctx.user.id },
        data: { avatarUrl: input.url },
      });
      if ((before?.avatarUrl ?? null) !== input.url) {
        skipAutoAudit(ctx);
        writeAuditAsync(ctx.prisma, {
          userId: ctx.user.id,
          impersonatorId: ctx.session?.impersonatorId ?? null,
          category: "MUTATION",
          action: "profile.setAvatar",
          entity: "User",
          entityId: ctx.user.id,
          method: "tRPC",
          path: "profile.setAvatar",
          status: "SUCCESS",
          depotId: ctx.session?.user?.depotId ?? null,
          reqId: ctx.reqId,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          previousData: { avatarUrl: before?.avatarUrl ?? null },
          newData: { avatarUrl: input.url },
        });
      }
      return { ok: true };
    }),

  removeAvatar: protectedProcedure
    .meta(selfAudit)
    .mutation(async ({ ctx }) => {
      const before = await ctx.prisma.user.findUnique({
        where: { id: ctx.user.id },
        select: { avatarUrl: true },
      });
      await ctx.prisma.user.update({
        where: { id: ctx.user.id },
        data: { avatarUrl: null },
      });
      if (before?.avatarUrl) {
        skipAutoAudit(ctx);
        writeAuditAsync(ctx.prisma, {
          userId: ctx.user.id,
          impersonatorId: ctx.session?.impersonatorId ?? null,
          category: "MUTATION",
          action: "profile.removeAvatar",
          entity: "User",
          entityId: ctx.user.id,
          method: "tRPC",
          path: "profile.removeAvatar",
          status: "SUCCESS",
          depotId: ctx.session?.user?.depotId ?? null,
          reqId: ctx.reqId,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          previousData: { avatarUrl: before.avatarUrl },
          newData: { avatarUrl: null },
        });
      }
      return { ok: true };
    }),

  /**
   * Rotate the signed-in user's password. Requires the current password
   * so a hijacked session can't silently lock the real owner out. For
   * first-time password creation (e.g. OAuth-only accounts), use
   * `auth.setPassword` instead.
   */
  changePassword: protectedProcedure
    .use(
      trpcRateLimit<unknown>({
        bucket: "profile:changePassword",
        limit: 10,
        windowSec: 15 * 60,
        identifier: (ctx) => ctx.session?.user?.id,
      }),
    )
    .input(
      z.object({
        currentPassword: z.string().min(1, "Current password is required"),
        newPassword: strongPasswordField,
      }),
    )
    .meta(selfAudit)
    .mutation(async ({ ctx, input }) => {
      const user = await ctx.prisma.user.findUnique({
        where: { id: ctx.user.id },
        select: { passwordHash: true, email: true },
      });
      if (!user) throw new TRPCError({ code: "NOT_FOUND" });
      if (!user.passwordHash) {
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "No password is set on this account. Use 'Set a password' to create one first.",
        });
      }
      const ok = await bcrypt.compare(input.currentPassword, user.passwordHash);
      if (!ok) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Current password is incorrect.",
        });
      }
      if (input.currentPassword === input.newPassword) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "New password must differ from the current one.",
        });
      }

      const passwordHash = await bcrypt.hash(input.newPassword, 10);
      await ctx.prisma.user.update({
        where: { id: ctx.user.id },
        data: { passwordHash },
      });

      // Replace the auto-audit row (which would have carried the hashed
      // input payload) with an explicit row that records only that the
      // password was rotated.
      skipAutoAudit(ctx);
      writeAuditAsync(ctx.prisma, {
        userId: ctx.user.id,
        impersonatorId: ctx.session?.impersonatorId ?? null,
        category: "MUTATION",
        action: "profile.passwordChanged",
        entity: "User",
        entityId: ctx.user.id,
        method: "tRPC",
        path: "profile.changePassword",
        status: "SUCCESS",
        depotId: ctx.session?.user?.depotId ?? null,
        reqId: ctx.reqId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      });

      const { getBranding } = await import("@/lib/branding");
      const { siteName } = await getBranding();
      const { default: ProfileUpdatedEmail } = await import(
        "../../../../emails/profile-updated"
      );
      const { render: renderEmail } = await import("@react-email/render");
      const { createElement } = await import("react");
      const { buildProfileChangeRows } = await import("@/lib/profile-change-display");
      const customer = await ctx.prisma.user.findUnique({
        where: { id: ctx.user.id },
        select: { firstName: true },
      });
      // Password value is intentionally never sent — the formatter renders
      // "(updated)" for the secret-fields list.
      const changes = buildProfileChangeRows({
        previousData: { password: "(updated)" },
        newData: { password: "(updated)" },
        changedFields: ["password"],
      });
      const html = await renderEmail(
        createElement(ProfileUpdatedEmail, {
          customerName: customer?.firstName ?? "there",
          actor: "you",
          staffName: null,
          changes,
          siteName,
        }),
      );
      await sendNotification({
        userId: ctx.user.id,
        type: "PROFILE_UPDATED_SELF",
        channels: ["EMAIL"],
        subject: `Your ${siteName} password was changed`,
        title: "Password changed",
        body: "Your account password was just changed. If this wasn't you, reset your password immediately and contact support.",
        html,
        templateKey: "profile-updated",
        data: { fields: ["password"] },
        sentById: ctx.user.id,
      });

      return { ok: true };
    }),
});
