/**
 * Fleet audit — evaluates data-quality and compliance issues on a vehicle.
 *
 * Pure: no I/O, no time source other than the `now` argument. The tRPC
 * handler loads vehicles and passes each one through `evaluateVehicleAudit`;
 * downstream UI turns the returned `AuditIssue[]` into actionable rows.
 *
 * Expiry thresholds mirror the 30-day window already used by
 * `src/server/jobs/maintenance-alert.ts` so the audit panel and the daily
 * notification job never disagree about what "near expiry" means.
 */

export type AuditSeverity = "critical" | "warning" | "info";

/** Which edit-sheet section should open when the user clicks Fix. */
export type AuditRemedy = "identity" | "compliance";

export type AuditCheckKey =
  // critical
  | "REGO_EXPIRED"
  | "CTP_EXPIRED"
  | "INSURANCE_EXPIRED"
  | "MISSING_REGO"
  // warning
  | "REGO_EXPIRING_SOON"
  | "CTP_EXPIRING_SOON"
  | "INSURANCE_EXPIRING_SOON"
  | "SERVICE_OVERDUE_DATE"
  | "SERVICE_OVERDUE_KM"
  | "WARRANTY_EXPIRED"
  // info
  | "MISSING_VIN"
  | "MISSING_ENGINE_NUMBER"
  | "MISSING_ODOMETER"
  | "MISSING_INSURANCE_POLICY"
  | "MISSING_REGO_EXPIRY"
  | "MISSING_CTP_EXPIRY"
  | "MISSING_INSURANCE_EXPIRY"
  | "MISSING_NEXT_SERVICE"
  | "NO_LAST_SERVICE";

export interface AuditCheckMeta {
  key: AuditCheckKey;
  severity: AuditSeverity;
  remedy: AuditRemedy;
  label: string;
  description: string;
}

export const AUDIT_CHECKS: Record<AuditCheckKey, AuditCheckMeta> = {
  REGO_EXPIRED:            { key: "REGO_EXPIRED",            severity: "critical", remedy: "compliance", label: "Registration expired",         description: "The vehicle's registration expiry date is in the past." },
  CTP_EXPIRED:             { key: "CTP_EXPIRED",             severity: "critical", remedy: "compliance", label: "CTP expired",                  description: "The vehicle's CTP / green slip has expired." },
  INSURANCE_EXPIRED:       { key: "INSURANCE_EXPIRED",       severity: "critical", remedy: "compliance", label: "Insurance expired",            description: "The vehicle's insurance policy has expired." },
  MISSING_REGO:            { key: "MISSING_REGO",            severity: "critical", remedy: "identity",   label: "Registration missing",         description: "Rego plate or rego state is blank." },

  REGO_EXPIRING_SOON:      { key: "REGO_EXPIRING_SOON",      severity: "warning",  remedy: "compliance", label: "Registration expiring soon",   description: "Registration expires within 30 days." },
  CTP_EXPIRING_SOON:       { key: "CTP_EXPIRING_SOON",       severity: "warning",  remedy: "compliance", label: "CTP expiring soon",            description: "CTP expires within 30 days." },
  INSURANCE_EXPIRING_SOON: { key: "INSURANCE_EXPIRING_SOON", severity: "warning",  remedy: "compliance", label: "Insurance expiring soon",      description: "Insurance expires within 30 days." },
  SERVICE_OVERDUE_DATE:    { key: "SERVICE_OVERDUE_DATE",    severity: "warning",  remedy: "compliance", label: "Service overdue (date)",       description: "Scheduled service date has passed." },
  SERVICE_OVERDUE_KM:      { key: "SERVICE_OVERDUE_KM",      severity: "warning",  remedy: "compliance", label: "Service overdue (km)",         description: "Odometer has passed the next-service km threshold." },
  WARRANTY_EXPIRED:        { key: "WARRANTY_EXPIRED",        severity: "warning",  remedy: "compliance", label: "Warranty expired",             description: "Manufacturer warranty has ended." },

  MISSING_VIN:             { key: "MISSING_VIN",             severity: "info",     remedy: "identity",   label: "VIN missing",                  description: "No vehicle identification number recorded." },
  MISSING_ENGINE_NUMBER:   { key: "MISSING_ENGINE_NUMBER",   severity: "info",     remedy: "identity",   label: "Engine number missing",        description: "No engine number recorded." },
  MISSING_ODOMETER:        { key: "MISSING_ODOMETER",        severity: "info",     remedy: "identity",   label: "Odometer not set",             description: "Odometer is zero — check and record the current reading." },
  MISSING_INSURANCE_POLICY:{ key: "MISSING_INSURANCE_POLICY",severity: "info",     remedy: "compliance", label: "Insurance policy # missing",   description: "Insurance expiry is set but no policy number recorded." },
  MISSING_REGO_EXPIRY:     { key: "MISSING_REGO_EXPIRY",     severity: "info",     remedy: "compliance", label: "Rego expiry date missing",     description: "No registration expiry date on file." },
  MISSING_CTP_EXPIRY:      { key: "MISSING_CTP_EXPIRY",      severity: "info",     remedy: "compliance", label: "CTP expiry date missing",      description: "No CTP expiry date on file." },
  MISSING_INSURANCE_EXPIRY:{ key: "MISSING_INSURANCE_EXPIRY",severity: "info",     remedy: "compliance", label: "Insurance expiry date missing",description: "No insurance expiry date on file." },
  MISSING_NEXT_SERVICE:    { key: "MISSING_NEXT_SERVICE",    severity: "info",     remedy: "compliance", label: "Next service not scheduled",   description: "Neither next-service date nor km threshold is set." },
  NO_LAST_SERVICE:         { key: "NO_LAST_SERVICE",         severity: "info",     remedy: "compliance", label: "Last service not recorded",    description: "No last-service date on file." },
};

/** Minimum shape required to evaluate audit checks. */
export interface AuditVehicleInput {
  rego: string | null;
  regoState: string | null;
  regoExpiry: Date | null;
  ctpExpiry: Date | null;
  insuranceExpiry: Date | null;
  insurancePolicyNumber: string | null;
  vin: string | null;
  engineNumber: string | null;
  currentOdometerKm: number | null;
  lastServiceDate: Date | null;
  nextServiceDueDate: Date | null;
  nextServiceDueKm: number | null;
  warrantyExpiry: Date | null;
}

export interface AuditIssue {
  checkKey: AuditCheckKey;
  severity: AuditSeverity;
  remedy: AuditRemedy;
  label: string;
  description: string;
  /** Populated when the check is date-based; ISO string of the expiry. */
  detectedAt: string | null;
  /** Days until expiry (negative = expired). Null when not date-based. */
  daysDelta: number | null;
}

export const EXPIRY_WINDOW_DAYS = 30;
const MS_PER_DAY = 86_400_000;

function daysUntil(date: Date, now: Date): number {
  return Math.ceil((date.getTime() - now.getTime()) / MS_PER_DAY);
}

function isBlank(s: string | null | undefined): boolean {
  return s == null || s.trim() === "";
}

function build(meta: AuditCheckMeta, detectedAt: Date | null, daysDelta: number | null): AuditIssue {
  return {
    checkKey: meta.key,
    severity: meta.severity,
    remedy: meta.remedy,
    label: meta.label,
    description: meta.description,
    detectedAt: detectedAt ? detectedAt.toISOString() : null,
    daysDelta,
  };
}

/**
 * Evaluate every audit check against a single vehicle. Pure — pass the
 * current time for determinism.
 */
export function evaluateVehicleAudit(v: AuditVehicleInput, now: Date = new Date()): AuditIssue[] {
  const issues: AuditIssue[] = [];

  if (isBlank(v.rego) || isBlank(v.regoState)) {
    issues.push(build(AUDIT_CHECKS.MISSING_REGO, null, null));
  }

  if (v.regoExpiry) {
    const d = daysUntil(v.regoExpiry, now);
    if (d < 0) issues.push(build(AUDIT_CHECKS.REGO_EXPIRED, v.regoExpiry, d));
    else if (d <= EXPIRY_WINDOW_DAYS) issues.push(build(AUDIT_CHECKS.REGO_EXPIRING_SOON, v.regoExpiry, d));
  } else {
    issues.push(build(AUDIT_CHECKS.MISSING_REGO_EXPIRY, null, null));
  }

  if (v.ctpExpiry) {
    const d = daysUntil(v.ctpExpiry, now);
    if (d < 0) issues.push(build(AUDIT_CHECKS.CTP_EXPIRED, v.ctpExpiry, d));
    else if (d <= EXPIRY_WINDOW_DAYS) issues.push(build(AUDIT_CHECKS.CTP_EXPIRING_SOON, v.ctpExpiry, d));
  } else {
    issues.push(build(AUDIT_CHECKS.MISSING_CTP_EXPIRY, null, null));
  }

  if (v.insuranceExpiry) {
    const d = daysUntil(v.insuranceExpiry, now);
    if (d < 0) issues.push(build(AUDIT_CHECKS.INSURANCE_EXPIRED, v.insuranceExpiry, d));
    else if (d <= EXPIRY_WINDOW_DAYS) issues.push(build(AUDIT_CHECKS.INSURANCE_EXPIRING_SOON, v.insuranceExpiry, d));
    if (isBlank(v.insurancePolicyNumber)) {
      issues.push(build(AUDIT_CHECKS.MISSING_INSURANCE_POLICY, null, null));
    }
  } else {
    issues.push(build(AUDIT_CHECKS.MISSING_INSURANCE_EXPIRY, null, null));
  }

  if (v.warrantyExpiry) {
    const d = daysUntil(v.warrantyExpiry, now);
    if (d < 0) issues.push(build(AUDIT_CHECKS.WARRANTY_EXPIRED, v.warrantyExpiry, d));
  }

  if (v.nextServiceDueDate) {
    const d = daysUntil(v.nextServiceDueDate, now);
    if (d < 0) issues.push(build(AUDIT_CHECKS.SERVICE_OVERDUE_DATE, v.nextServiceDueDate, d));
  }
  if (
    v.nextServiceDueKm != null &&
    v.currentOdometerKm != null &&
    v.currentOdometerKm >= v.nextServiceDueKm
  ) {
    issues.push(build(AUDIT_CHECKS.SERVICE_OVERDUE_KM, null, null));
  }
  if (v.nextServiceDueDate == null && v.nextServiceDueKm == null) {
    issues.push(build(AUDIT_CHECKS.MISSING_NEXT_SERVICE, null, null));
  }

  if (isBlank(v.vin)) issues.push(build(AUDIT_CHECKS.MISSING_VIN, null, null));
  if (isBlank(v.engineNumber)) issues.push(build(AUDIT_CHECKS.MISSING_ENGINE_NUMBER, null, null));
  if (v.currentOdometerKm == null || v.currentOdometerKm <= 0) {
    issues.push(build(AUDIT_CHECKS.MISSING_ODOMETER, null, null));
  }
  if (!v.lastServiceDate) issues.push(build(AUDIT_CHECKS.NO_LAST_SERVICE, null, null));

  return issues;
}

/**
 * Vehicle statuses excluded from the audit. These are terminal dispositions
 * where lapsed rego or missing VINs are expected and not actionable.
 */
export const AUDIT_EXCLUDED_STATUSES = ["SOLD", "END_OF_LIFE", "WRITTEN_OFF", "STOLEN"] as const;
