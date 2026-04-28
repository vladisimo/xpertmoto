import type { StaffTaskTier, StaffTaskType } from "@prisma/client";

export type TargetEntityKind =
  | "Booking"
  | "Inspection"
  | "MaintenanceWorkOrder"
  | "RentalAgreement"
  | "ReturnAssessment"
  | "Vehicle"
  | "Incident"
  | "SupportTicket"
  | "CustomerProfile"
  | "Infringement"
  | "BondLedger"
  | "DamageCharge";

export interface VirtualTask {
  taskType: StaffTaskType;
  targetEntityKind: TargetEntityKind;
  targetEntityId: string;
  tier: StaffTaskTier;
  depotId: string | null;
  title: string;
  subtitle?: string;
  summary?: string;
  referenceCode?: string;
  actionUrl: string;
  actionableSince: Date;
  dueAt?: Date | null;
  metadata?: Record<string, unknown>;
}

export interface TaskListEntry extends VirtualTask {
  composedId: string;
  ageSeconds: number;
  inProgress: {
    activityId: string;
    staffId: string;
    staffName: string;
    startedAt: Date;
    isMine: boolean;
  } | null;
}

export function encodeTaskId(taskType: StaffTaskType, targetEntityId: string): string {
  return `${taskType}:${targetEntityId}`;
}

export function decodeTaskId(composed: string): { taskType: StaffTaskType; targetEntityId: string } {
  const idx = composed.indexOf(":");
  if (idx <= 0) throw new Error(`invalid composed task id: ${composed}`);
  return {
    taskType: composed.slice(0, idx) as StaffTaskType,
    targetEntityId: composed.slice(idx + 1),
  };
}
