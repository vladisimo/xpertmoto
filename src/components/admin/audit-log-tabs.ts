import {
  Activity,
  Gauge,
  KeyRound,
  ListOrdered,
  Pencil,
  ShieldAlert,
  UserCheck,
  Webhook,
  type LucideIcon,
} from "lucide-react";

export interface AuditLogTabDef {
  value: string;
  label: string;
  icon: LucideIcon;
}

export const AUDIT_LOG_TABS = [
  { value: "overview", label: "Overview", icon: Gauge },
  { value: "security", label: "Security", icon: ShieldAlert },
  { value: "authentication", label: "Authentication", icon: KeyRound },
  { value: "mutations", label: "Mutations", icon: Pencil },
  { value: "webhooks", label: "Webhooks & Jobs", icon: Webhook },
  { value: "impersonation", label: "Impersonation", icon: UserCheck },
  { value: "activity", label: "Activity", icon: Activity },
  { value: "all", label: "All events", icon: ListOrdered },
] as const satisfies readonly AuditLogTabDef[];

export type AuditLogTabValue = (typeof AUDIT_LOG_TABS)[number]["value"];
