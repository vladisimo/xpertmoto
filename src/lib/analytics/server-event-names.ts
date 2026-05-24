/**
 * Canonical registry of server-side lifecycle event names sent to PostHog via
 * `trackServer` ([analytics.ts](../analytics.ts)).
 *
 * These are deliberately distinct from the `visitor.*` client-pipeline names
 * ([visitor-event-names.ts](./visitor-event-names.ts)) and from PostHog's own
 * `$autocapture`/`$pageview` names so the pipelines never collide in funnels.
 *
 * Single source of truth: reference `SERVER_EVENTS.x` instead of inlining the
 * string at the capture site, so a rename happens in exactly one place and a
 * typo becomes a compile error. Grouped by domain; values are stable wire
 * names and must not change once data exists for them in PostHog.
 */
export const SERVER_EVENTS = {
  // Booking lifecycle
  bookingCreated: "booking.created",
  bookingConfirmed: "booking.confirmed",
  bookingCancelled: "booking.cancelled",
  bookingCheckedIn: "booking.checked_in",
  bookingCheckedOut: "booking.checked_out",
  bookingReminderSent: "booking.reminder_sent",
  bookingNoShowDetected: "booking.no_show_detected",
  bookingNoShowWarningSent: "booking.no_show_warning_sent",
  bookingOverdue: "booking.overdue",
  bookingSwapConfirmed: "booking.swap_confirmed",

  // Payment lifecycle
  paymentCaptured: "payment.captured",
  paymentFailed: "payment.failed",
  paymentRefunded: "payment.refunded",
  paymentCaptureAttempt: "payment.capture_attempt",

  // Bond (Stripe authorisation hold) lifecycle
  bondCaptured: "bond.captured",
  bondReleased: "bond.released",
  bondHeldUpdated: "bond.held_updated",
  bondAutoReleased: "bond.auto_released",

  // Disputes / chargebacks
  paymentDisputed: "payment.disputed",
  disputeFundsWithdrawn: "dispute.funds_withdrawn",
  disputeFundsReinstated: "dispute.funds_reinstated",
  disputeUpdated: "dispute.updated",
  disputeClosed: "dispute.closed",

  // Abandoned-cart recovery
  cartRecoveryEmailSent: "cart.recovery_email_sent",

  // Dunning ladder
  dunningAdvanced: "dunning.advanced",

  // Incidents
  incidentCreated: "incident.created",
  incidentStatusChanged: "incident.status_changed",
  incidentCustomerCharged: "incident.customer_charged",
  incidentAutoCreated: "incident.auto_created",

  // Maintenance / work orders
  maintenanceCreated: "maintenance.created",
  maintenanceStatusChanged: "maintenance.status_changed",

  // Infringements
  infringementCreated: "infringement.created",
  infringementNominated: "infringement.nominated",

  // Licence / identity verification
  licenceVerified: "licence.verified",
  licenceVerificationStarted: "licence.verification_started",
  licenceVerificationRefreshed: "licence.verification_refreshed",
  identityVerified: "identity.verified",
  identityRequiresInput: "identity.requires_input",

  // Customer lifecycle
  customerRegistered: "customer.registered",

  // Deliverability-critical comms (gated — never `delivered`/`opened`)
  commsSmsFailed: "comms.sms_failed",
  commsEmailBounced: "comms.email_bounced",
  commsEmailComplained: "comms.email_complained",

  // Fleet telemetry (gated — never raw GPS pings)
  vehicleBatteryLow: "vehicle.battery_low",
  vehicleOdometerUpdated: "vehicle.odometer_updated",
  vehicleTripCompleted: "vehicle.trip_completed",

  // Periodic analytics aggregates
  analyticsWeeklyDigest: "analytics.weekly_digest",
  analyticsAlertTriggered: "analytics.alert_triggered",
} as const;

export type ServerEventName = (typeof SERVER_EVENTS)[keyof typeof SERVER_EVENTS];

/** Group type used for depot-scoped analytics. Group key is the depot slug. */
export const DEPOT_GROUP_TYPE = "depot" as const;
