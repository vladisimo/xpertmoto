import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Semantic status tones. All status values across the app map to one of these
 * six tones. Defining them once — here — is the whole point of StatusBadge:
 * a booking's "OVERDUE" and an invoice's "OVERDUE" look identical, and a
 * future domain status just needs to pick a tone rather than hand-roll a
 * `bg-amber-100 text-amber-800` pair.
 */
type Tone = "neutral" | "info" | "progress" | "success" | "warning" | "danger";

// Tones MUST use static palette colours (sky/emerald/red/indigo) rather than
// opacity-tinted design tokens. The XPERT Moto design system has --accent and
// --primary defined as near-greyscale (0 0% 96% and 0 0% 0%), so `bg-accent/10`
// or `bg-primary/10` would render as invisible/colourless pills indistinguishable
// from plain text — see the "Partial refund" regression caught 2026-04.
const TONE_CLASSES: Record<Tone, string> = {
  neutral:  "bg-muted text-muted-foreground ring-1 ring-inset ring-border",
  info:     "bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-600/20 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-400/30",
  progress: "bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-600/20 dark:bg-indigo-500/10 dark:text-indigo-300 dark:ring-indigo-400/30",
  success: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/30",
  warning: "bg-muted text-foreground ring-1 ring-inset ring-border before:mr-1.5 before:inline-block before:h-1.5 before:w-1.5 before:rounded-full before:bg-amber-500 before:content-[''] dark:bg-muted dark:text-foreground dark:ring-border dark:before:bg-amber-400",
  danger:  "bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/20 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-400/30",
};

/**
 * Single source of truth for status-to-tone mapping. If a new status is
 * introduced, add it here — do NOT hand-roll colours in pages.
 */
const STATUS_TONE_MAP = {
  // BookingStatus
  QUOTE:             { tone: "neutral",  label: "Quote" },
  PENDING_PAYMENT:   { tone: "warning",  label: "Pending payment" },
  CONFIRMED:         { tone: "info",     label: "Confirmed" },
  CHECKED_OUT:       { tone: "progress", label: "Checked out" },
  ACTIVE:            { tone: "progress", label: "Active" },
  OVERDUE:           { tone: "danger",   label: "Overdue" },
  RETURNED:          { tone: "info",     label: "Returned" },
  COMPLETED:         { tone: "success",  label: "Completed" },
  CANCELLED:         { tone: "neutral",  label: "Cancelled" },
  NO_SHOW:           { tone: "danger",   label: "No-show" },
  DISPUTED:          { tone: "danger",   label: "Disputed" },
  // UserStatus
  SUSPENDED:         { tone: "warning",  label: "Suspended" },
  BANNED:            { tone: "danger",   label: "Banned" },
  // VehicleStatus — ACTIVE + CANCELLED + COMPLETED + PENDING handled above
  AVAILABLE:         { tone: "success",  label: "Active" },
  RENTED:            { tone: "progress", label: "Rented" },
  RESERVED:          { tone: "info",     label: "Reserved" },
  IN_MAINTENANCE:    { tone: "warning",  label: "In maintenance" },
  ACCIDENT_REPAIRS:  { tone: "danger",   label: "Accident repairs" },
  IN_TRANSIT:        { tone: "info",     label: "In transit" },
  SOLD:              { tone: "neutral",  label: "Sold" },
  END_OF_LIFE:       { tone: "neutral",  label: "End of life" },
  STOLEN:            { tone: "danger",   label: "Stolen" },
  WRITTEN_OFF:       { tone: "danger",   label: "Written off" },
  // PaymentStatus — SUCCEEDED, FAILED, REFUNDED, PARTIALLY_REFUNDED
  PENDING:           { tone: "warning",  label: "Pending" },
  SUCCEEDED:         { tone: "success",  label: "Succeeded" },
  FAILED:            { tone: "danger",   label: "Failed" },
  REFUNDED:          { tone: "info",     label: "Refunded" },
  PARTIALLY_REFUNDED:{ tone: "info",     label: "Partial refund" },
  // InvoiceStatus adds
  DRAFT:             { tone: "neutral",  label: "Draft" },
  SENT:              { tone: "info",     label: "Sent" },
  PAID:              { tone: "success",  label: "Paid" },
  VOID:              { tone: "neutral",  label: "Void" },
  CREDITED:          { tone: "info",     label: "Credited" },
  // AdjustmentNoteStatus (VOID reused above)
  ISSUED:            { tone: "info",     label: "Issued" },
  // WorkOrderStatus
  OPEN:              { tone: "neutral",  label: "Open" },
  ASSIGNED:          { tone: "info",     label: "Assigned" },
  IN_PROGRESS:       { tone: "progress", label: "In progress" },
  AWAITING_PARTS:    { tone: "warning",  label: "Awaiting parts" },
  // IncidentStatus
  REPORTED:          { tone: "warning",  label: "Reported" },
  UNDER_INVESTIGATION:{ tone: "progress",label: "Investigating" },
  ASSESSED:          { tone: "info",     label: "Assessed" },
  RESOLVED:          { tone: "success",  label: "Resolved" },
  CLOSED:            { tone: "neutral",  label: "Closed" },
  INSURANCE_CLAIM:   { tone: "info",     label: "Insurance claim" },
  // IncidentSeverity
  MINOR:             { tone: "warning",  label: "Minor" },
  MODERATE:          { tone: "warning",  label: "Moderate" },
  MAJOR:             { tone: "danger",   label: "Major" },
  TOTAL_LOSS:        { tone: "danger",   label: "Total loss" },
  // InspectionStatus (DRAFT, COMPLETED reused above)
  FLAGGED:           { tone: "danger",   label: "Flagged" },
  // BondStatus
  HELD:              { tone: "info",     label: "Held" },
  FULLY_CAPTURED:    { tone: "warning",  label: "Fully captured" },
  PARTIALLY_CAPTURED:{ tone: "warning",  label: "Partially captured" },
  RELEASED:          { tone: "success",  label: "Released" },
  // InfringementStatus adds
  NOMINATED:         { tone: "info",     label: "Nominated" },
  CUSTOMER_CHARGED:  { tone: "progress", label: "Charged" },
  // BookingBillingStatus (ACTIVE/COMPLETED/CANCELLED reused above)
  PAUSED:            { tone: "warning",  label: "Paused" },
  // AuditStatus
  SUCCESS:           { tone: "success",  label: "Success" },
  FAILURE:           { tone: "danger",   label: "Failure" },
  DENIED:            { tone: "warning",  label: "Denied" },
  // AuditCategory
  AUTH:              { tone: "info",     label: "Auth" },
  PAGE_VIEW:         { tone: "neutral",  label: "Page view" },
  MUTATION:          { tone: "progress", label: "Mutation" },
  QUERY:             { tone: "info",     label: "Query" },
  JOB:               { tone: "neutral",  label: "Job" },
  API:               { tone: "info",     label: "API" },
  WEBHOOK:           { tone: "info",     label: "Webhook" },
  // AgreementStatus / ReturnStatus / ChargeStatus / ChargeResolution
  SIGNED:            { tone: "success",  label: "Signed" },
  SUPERSEDED:        { tone: "neutral",  label: "Superseded" },
  VOIDED:            { tone: "danger",   label: "Voided" },
  FINALISED:         { tone: "success",  label: "Finalised" },
  PROVISIONAL:       { tone: "warning",  label: "Provisional" },
  CAPTURED:          { tone: "success",  label: "Captured" },
  WAIVED:            { tone: "neutral",  label: "Waived" },
  QUOTE_PENDING:     { tone: "warning",  label: "Quote pending" },
  STANDARD:          { tone: "info",     label: "Standard" },
  WARRANTY:          { tone: "info",     label: "Warranty" },
  // TimestampStatus (PENDING and FAILED already covered above for Payment)
  OK:                { tone: "success",  label: "OK" },
  // Campaign + CommunicationLog statuses (SENT, FAILED, CANCELLED, PENDING reused)
  SCHEDULED:         { tone: "info",     label: "Scheduled" },
  SENDING:           { tone: "progress", label: "Sending" },
  DELIVERED:         { tone: "success",  label: "Delivered" },
  BOUNCED:           { tone: "danger",   label: "Bounced" },
  OPT_OUT:           { tone: "neutral",  label: "Opt-out" },
  UNSUBSCRIBED:      { tone: "neutral",  label: "Unsubscribed" },
  READ:              { tone: "info",     label: "Read" },
  // NotificationStatus.SUPPRESSED — the message was intentionally gated by an
  // admin notification setting, not a delivery failure. CommunicationLog rows
  // record this as status FAILED + errorMessage "SUPPRESSED:<reason>"; the
  // comms drawer maps that back to this neutral pill so it doesn't read as red.
  SUPPRESSED:        { tone: "neutral",  label: "Suppressed" },
  // SupportTicketStatus additions (OPEN/ASSIGNED/RESOLVED/CLOSED reused above)
  PENDING_CUSTOMER:  { tone: "warning",  label: "Pending customer" },
  // SupportPriority + StaffTaskTier
  URGENT:            { tone: "danger",   label: "Urgent" },
  HIGH:              { tone: "warning",  label: "High" },
  MEDIUM:            { tone: "info",     label: "Medium" },
  NORMAL:            { tone: "info",     label: "Normal" },
  LOW:               { tone: "neutral",  label: "Low" },
  // SupportCategory
  BREAKDOWN:         { tone: "danger",   label: "Breakdown" },
  ABANDONED_VEHICLE: { tone: "warning",  label: "Abandoned" },
  PAYMENT:           { tone: "info",     label: "Payment" },
  GENERAL:           { tone: "neutral",  label: "General" },
  // Public fleet availability pills (count surfaced via the `label` override)
  STOCK_LOW:         { tone: "warning",  label: "Low availability" },
  // Fleet import row status
  READY:             { tone: "success",  label: "Ready" },
  ERROR:             { tone: "danger",   label: "Error" },
  DUPLICATE:         { tone: "warning",  label: "Duplicate" },
  // VisitorOutcome — BOUNCED is already used for CommunicationLog (danger);
  // we alias visitor bounces to a neutral key to avoid visually equating
  // "visitor left quickly" with "email bounce".
  VISITOR_BOUNCED:   { tone: "neutral",  label: "Bounced" },
  ABANDONED_WIZARD:  { tone: "warning",  label: "Abandoned wizard" },
  CONVERTED:         { tone: "success",  label: "Converted" },
  LEFT:              { tone: "neutral",  label: "Left" },
  // InteractionOutcome — CONVERTED/IN_PROGRESS/RESOLVED shared above.
  NO_RESPONSE:       { tone: "warning",  label: "No response" },
  ABANDONED:         { tone: "neutral",  label: "Abandoned" },
  // Document expiry tones — paired with expiryTone() in fleet/expiry.ts
  EXPIRED:           { tone: "danger",   label: "Expired" },
  EXPIRES_SOON:      { tone: "warning",  label: "Expires soon" },
  VALID:             { tone: "success",  label: "Valid" },
  // BookingSwapStatus — DRAFT / VOIDED reused above
  COMMITTED:             { tone: "success",  label: "Committed" },
  // VehicleCondition — inspection ratings
  EXCELLENT:             { tone: "success",  label: "Excellent" },
  // GOOD is re-labelled for condition context but we only have one entry, so
  // use `label` override at the call site if you need "Good" vs another label.
  // For now: keeping generic tones covers both inspections and health checks.
  GOOD:                  { tone: "success",  label: "Good" },
  FAIR:                  { tone: "warning",  label: "Fair" },
  POOR:                  { tone: "danger",   label: "Poor" },
  // SpecConfidence — VehicleModel enrichment provenance
  OFFICIAL_MANUFACTURER: { tone: "success",  label: "Official" },
  REPUTABLE_SECONDARY:   { tone: "info",     label: "Secondary" },
  UNVERIFIED:            { tone: "neutral",  label: "Unverified" },
  // StripeWebhookEvent.status (FAILED reused from PaymentStatus above)
  RECEIVED:              { tone: "info",     label: "Received" },
  PROCESSING:            { tone: "progress", label: "Processing" },
  PROCESSED:             { tone: "success",  label: "Processed" },
  // E-toll sync run states (TollSyncStatus). SUCCESS / FAILED reused above.
  RUNNING:               { tone: "progress", label: "Running" },
  PARTIAL:               { tone: "warning",  label: "Partial" },
  // Toll matching state (FleetTollsTab unmatched filter)
  UNMATCHED:             { tone: "warning",  label: "Unmatched" },
  // Tag-pill keys — non-Prisma-enum state indicators (live console, notes)
  AT_RISK:               { tone: "danger",   label: "At risk" },
  BEST:                  { tone: "success",  label: "Best" },
  INTERNAL:              { tone: "warning",  label: "Internal" },
  // Document/identity verification. Distinct from `UNVERIFIED` above
  // (which is `neutral` for SpecConfidence) — document state needs warning tone.
  VERIFIED:              { tone: "success",  label: "Verified" },
  UNVERIFIED_DOC:        { tone: "warning",  label: "Unverified" },
  // CustomerRiskRating — distinct from priority/severity since the
  // colour semantics differ (low risk = good, not neutral).
  RISK_LOW:              { tone: "success",  label: "LOW" },
  RISK_MEDIUM:           { tone: "warning",  label: "MEDIUM" },
  RISK_HIGH:             { tone: "danger",   label: "HIGH" },
  // Tax document kinds — used by BookingDocumentsSection and TaxDocumentsSection
  TAX_INVOICE:           { tone: "progress", label: "Tax invoice" },
  ADJUSTMENT_INCREASE:   { tone: "warning",  label: "Adjustment +" },
  ADJUSTMENT_DECREASE:   { tone: "info",     label: "Adjustment −" },
  RECEIPT:               { tone: "neutral",  label: "Receipt" },
  AGREEMENT:             { tone: "info",     label: "Agreement" },
  ASSESSMENT:            { tone: "info",     label: "Assessment" },
  SWAP_AGREEMENT:        { tone: "neutral",  label: "Swap agreement" },
  // Finance reconciliation row states (ReconStatus) — book ↔ Stripe matching.
  MATCHED:               { tone: "success",  label: "Matched" },
  AMOUNT_MISMATCH:       { tone: "danger",   label: "Amount mismatch" },
  MISSING_IN_STRIPE:     { tone: "danger",   label: "Missing in Stripe" },
  MISSING_IN_BOOK:       { tone: "danger",   label: "Missing in book" },
  NON_CASH:              { tone: "neutral",  label: "Non-cash" },
  UNLINKED:              { tone: "info",     label: "Unlinked" },
} as const satisfies Record<string, { tone: Tone; label: string }>;

export type StatusKey = keyof typeof STATUS_TONE_MAP;

export interface StatusBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  status: StatusKey;
  /** Override the default label for this status. Rarely needed. */
  label?: string;
}

export const StatusBadge = React.forwardRef<HTMLSpanElement, StatusBadgeProps>(
  ({ status, label, className, ...props }, ref) => {
    const entry = STATUS_TONE_MAP[status];
    return (
      <span
        ref={ref}
        className={cn(
          "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
          TONE_CLASSES[entry.tone],
          className,
        )}
        {...props}
      >
        {label ?? entry.label}
      </span>
    );
  },
);
StatusBadge.displayName = "StatusBadge";

export { STATUS_TONE_MAP };
