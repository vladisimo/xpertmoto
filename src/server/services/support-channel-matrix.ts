/**
 * Resolves which notification channels fire for a given ticket. Kept
 * table-driven so product can tweak the matrix without touching routing
 * logic. Reads:
 *   category × priority × (in-hours | out-of-hours)
 * Writes: a set of NotificationChannels to send to each recipient class.
 *
 * Business rules reference (see plan):
 * - BREAKDOWN/ABANDONED_VEHICLE at URGENT always SMS-pages on-call user.
 * - PAYMENT tickets never SMS — not time-sensitive.
 * - Customer-facing staff replies always EMAIL + IN_APP; SMS only fires
 *   for URGENT status changes to keep SMS spend controlled.
 */

import type { NotificationChannel, SupportCategory, SupportPriority } from "@prisma/client";

export type ChannelPlan = {
  toAssignee: NotificationChannel[];
  toOnCall: NotificationChannel[];
  toAdminPool: NotificationChannel[];
};

export function resolveChannels(args: {
  category: SupportCategory;
  priority: SupportPriority;
  outsideHours: boolean;
}): ChannelPlan {
  const { category, priority, outsideHours } = args;

  if (category === "PAYMENT") {
    return {
      toAssignee: [],
      toOnCall: [],
      toAdminPool: ["EMAIL", "IN_APP"],
    };
  }

  if (category === "GENERAL") {
    return { toAssignee: ["IN_APP"], toOnCall: [], toAdminPool: [] };
  }

  // BREAKDOWN / ABANDONED_VEHICLE
  if (priority === "URGENT") {
    return {
      toAssignee: ["SMS", "EMAIL", "IN_APP"],
      toOnCall: outsideHours ? ["SMS", "EMAIL"] : ["SMS"],
      toAdminPool: [],
    };
  }
  if (priority === "HIGH") {
    return {
      toAssignee: outsideHours ? ["SMS", "EMAIL", "IN_APP"] : ["EMAIL", "IN_APP"],
      toOnCall: [],
      toAdminPool: [],
    };
  }
  return {
    toAssignee: outsideHours ? ["SMS", "EMAIL", "IN_APP"] : ["EMAIL", "IN_APP"],
    toOnCall: [],
    toAdminPool: [],
  };
}

/**
 * Customer-direction channel plan (staff reply → customer, ticket
 * resolved → customer, urgent status changes).
 */
export function resolveCustomerChannels(event: {
  kind: "staff_reply" | "resolved" | "urgent_status";
  priority: SupportPriority;
}): NotificationChannel[] {
  if (event.kind === "urgent_status" && event.priority === "URGENT") {
    return ["SMS", "EMAIL", "IN_APP"];
  }
  return ["EMAIL", "IN_APP"];
}
