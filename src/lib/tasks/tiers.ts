import type { StaffTaskTier, StaffTaskType } from "@prisma/client";
import type { VirtualTask } from "./types";

export const TIER_ORDINAL: Record<StaffTaskTier, number> = {
  URGENT: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

export const TIER_LABEL: Record<StaffTaskTier, string> = {
  URGENT: "Urgent",
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
};

export const TASK_TYPE_LABEL: Record<StaffTaskType, string> = {
  BOOKING_PICKUP: "Booking pickup",
  BOOKING_RETURN: "Booking return",
  BOOKING_OVERDUE_CHASE: "Overdue booking",
  INSPECTION_PRE_HIRE: "Pre-hire inspection",
  INSPECTION_POST_HIRE: "Post-hire inspection",
  INSPECTION_FLAGGED_REVIEW: "Flagged inspection review",
  MAINTENANCE_WORK_ORDER: "Work order",
  VEHICLE_REGO_ACTION: "Rego action",
  VEHICLE_CTP_ACTION: "CTP action",
  VEHICLE_INSURANCE_ACTION: "Insurance action",
  VEHICLE_SERVICE_ACTION: "Service due",
  VEHICLE_TYRE_ACTION: "Tyre action",
  INCIDENT_TRIAGE: "Incident triage",
  INCIDENT_INVESTIGATE: "Incident investigation",
  SUPPORT_TICKET_TRIAGE: "Support ticket triage",
  SUPPORT_TICKET_RESPOND: "Support ticket response",
  CUSTOMER_LICENCE_VERIFY: "Licence verification",
  RENTAL_AGREEMENT_SIGN: "Rental agreement signature",
  RETURN_ASSESSMENT_FINALISE: "Return assessment finalise",
  CALENDAR_ALLOCATION: "Calendar allocation",
  DAMAGE_CHARGE_CONFIRM: "Damage charge confirmation",
  INFRINGEMENT_NOMINATE: "Infringement nomination",
  BOND_RELEASE_REVIEW: "Bond release review",
};

/**
 * Task types that are wired with collectors + autoClose in Phase 1.
 * Other enum members are reserved for Phase 2.
 */
export const PHASE_1_TASK_TYPES: readonly StaffTaskType[] = [
  "BOOKING_PICKUP",
  "BOOKING_RETURN",
  "BOOKING_OVERDUE_CHASE",
  "INSPECTION_PRE_HIRE",
  "INSPECTION_POST_HIRE",
  "MAINTENANCE_WORK_ORDER",
  "RENTAL_AGREEMENT_SIGN",
  "RETURN_ASSESSMENT_FINALISE",
  "INCIDENT_INVESTIGATE",
] as const;

export function compareVirtualTasks(a: VirtualTask, b: VirtualTask): number {
  const tierDiff = TIER_ORDINAL[b.tier] - TIER_ORDINAL[a.tier];
  if (tierDiff !== 0) return tierDiff;
  return a.actionableSince.getTime() - b.actionableSince.getTime();
}
