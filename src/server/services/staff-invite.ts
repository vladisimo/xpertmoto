import crypto from "crypto";
import type { PrismaClient, UserRole } from "@prisma/client";
import { sendEmail } from "@/lib/email";
import { getBranding } from "@/lib/branding";
import StaffInviteEmail from "../../../emails/staff-invite";

export const INVITE_PREFIX = "invite:";
export const INVITE_TTL_HOURS = 72;

export function buildInviteIdentifier(email: string): string {
  return `${INVITE_PREFIX}${email.toLowerCase()}`;
}

export function inviteExpiryFromNow(): Date {
  return new Date(Date.now() + INVITE_TTL_HOURS * 60 * 60 * 1000);
}

export function formatRoleLabel(role: UserRole): string {
  return role.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Generate a fresh invite token, persist it (replacing any previous unexpired
 * invite for the same address so a resend invalidates the earlier link), and
 * send the invitation email. Caller is responsible for creating/looking up
 * the User row and deciding when to invoke this.
 */
export async function issueStaffInvite(
  prisma: PrismaClient,
  params: {
    email: string;
    role: UserRole;
    inviterName: string;
  },
): Promise<{ token: string; expiresAt: Date }> {
  const email = params.email.toLowerCase();
  const identifier = buildInviteIdentifier(email);
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = inviteExpiryFromNow();

  await prisma.verificationToken.deleteMany({ where: { identifier } });
  await prisma.verificationToken.create({
    data: { identifier, token, expires: expiresAt },
  });

  const baseUrl =
    process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const url = `${baseUrl}/accept-invite?token=${encodeURIComponent(token)}`;
  const { siteName } = await getBranding();

  await sendEmail({
    to: email,
    subject: `You've been invited to join ${siteName}`,
    react: StaffInviteEmail({
      url,
      email,
      inviterName: params.inviterName,
      roleLabel: formatRoleLabel(params.role),
      expiresInHours: INVITE_TTL_HOURS,
      siteName,
    }),
  });

  return { token, expiresAt };
}
