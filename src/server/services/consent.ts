import type {
  NotificationCategory,
  NotificationChannel,
  NotificationType,
  PrismaClient,
} from "@prisma/client";

import { prisma as defaultPrisma } from "@/lib/prisma";

export type ConsentGateInput = {
  customerId: string;
  type: NotificationType;
  category: NotificationCategory;
  channel: NotificationChannel;
};

export type ConsentGateResult =
  | { allowed: true }
  | { allowed: false; reason: ConsentDenyReason };

export type ConsentDenyReason =
  | "CUSTOMER_NOT_FOUND"
  | "CUSTOMER_DELETED"
  | "CUSTOMER_SUSPENDED"
  | "NO_EMAIL_ADDRESS"
  | "NO_PHONE_NUMBER"
  | "EMAIL_UNSUBSCRIBED"
  | "SMS_UNSUBSCRIBED"
  | "EMAIL_OPT_OUT"
  | "SMS_OPT_OUT"
  | "CHANNEL_UNSUPPORTED";

const MARKETING: NotificationCategory = "MARKETING";

export async function canSend(
  input: ConsentGateInput,
  prisma: Pick<PrismaClient, "user"> = defaultPrisma,
): Promise<ConsentGateResult> {
  const user = await prisma.user.findUnique({
    where: { id: input.customerId },
    select: {
      id: true,
      email: true,
      phone: true,
      status: true,
      deletedAt: true,
      customerProfile: {
        select: {
          marketingOptIn: true,
          marketingSmsOptIn: true,
          marketingEmailUnsubscribedAt: true,
          marketingSmsUnsubscribedAt: true,
        },
      },
    },
  });

  if (!user) return { allowed: false, reason: "CUSTOMER_NOT_FOUND" };
  if (user.deletedAt) return { allowed: false, reason: "CUSTOMER_DELETED" };
  if (user.status === "BANNED") return { allowed: false, reason: "CUSTOMER_SUSPENDED" };

  switch (input.channel) {
    case "EMAIL":
      if (!user.email) return { allowed: false, reason: "NO_EMAIL_ADDRESS" };
      if (input.category === MARKETING) {
        if (user.customerProfile?.marketingEmailUnsubscribedAt) {
          return { allowed: false, reason: "EMAIL_UNSUBSCRIBED" };
        }
        if (!user.customerProfile?.marketingOptIn) {
          return { allowed: false, reason: "EMAIL_OPT_OUT" };
        }
      }
      return { allowed: true };

    case "SMS":
      if (!user.phone) return { allowed: false, reason: "NO_PHONE_NUMBER" };
      if (input.category === MARKETING) {
        if (user.customerProfile?.marketingSmsUnsubscribedAt) {
          return { allowed: false, reason: "SMS_UNSUBSCRIBED" };
        }
        if (!user.customerProfile?.marketingSmsOptIn) {
          return { allowed: false, reason: "SMS_OPT_OUT" };
        }
      }
      return { allowed: true };

    case "IN_APP":
    case "PUSH":
      return { allowed: true };

    default:
      return { allowed: false, reason: "CHANNEL_UNSUPPORTED" };
  }
}

export function categoryForType(type: NotificationType): NotificationCategory {
  if (type.startsWith("MARKETING_")) return "MARKETING";
  if (type.startsWith("CART_RECOVERY_")) return "MARKETING";
  if (type === "POST_TRIP_REVIEW_REQUEST") return "MARKETING";
  if (type === "EXCESS_UPSELL_OFFER") return "MARKETING";
  if (type === "GIFT_CARD_RECEIVED") return "TRANSACTIONAL";
  if (type === "GIFT_CARD_ISSUED") return "TRANSACTIONAL";
  if (type === "REFERRAL_QUALIFIED") return "ACCOUNT";
  if (type === "LOYALTY_TIER_UPGRADE") return "ACCOUNT";
  if (type === "LOYALTY_POINTS_EARNED") return "ACCOUNT";
  if (type === "SUBSCRIPTION_RENEWED") return "TRANSACTIONAL";
  if (type === "SUBSCRIPTION_PAUSED") return "ACCOUNT";
  if (type === "SUBSCRIPTION_CANCELLED") return "ACCOUNT";
  if (type === "SUBSCRIPTION_OVERAGE") return "TRANSACTIONAL";
  if (type === "PARTNER_BOOKING_ATTRIBUTED") return "OPERATIONAL";
  if (type === "ZONE_BREACH_WARNING") return "TRANSACTIONAL";
  if (type === "FUEL_DELIVERY_DISPATCHED") return "TRANSACTIONAL";
  switch (type) {
    case "PROFILE_UPDATED_SELF":
    case "PROFILE_UPDATED_STAFF":
    case "LICENCE_EXPIRING":
    case "CUSTOMER_WELCOME":
      return "ACCOUNT";
    case "DAILY_OPS_SUMMARY":
    case "WEEKLY_REVENUE_SUMMARY":
    case "NEW_CUSTOMER_REGISTERED":
    case "LOW_FLEET_AVAILABILITY":
    case "VEHICLE_EXPIRY":
    case "REGO_EXPIRING":
    case "WORK_ORDER_ASSIGNED":
    case "BOOKING_OVERDUE_ESCALATION":
      return "OPERATIONAL";
    default:
      return "TRANSACTIONAL";
  }
}
