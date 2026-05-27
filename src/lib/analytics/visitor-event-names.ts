import type { VisitorEventKind } from "@prisma/client";

/**
 * Maps the internal `VisitorEventKind` enum to stable PostHog event names.
 * The `visitor.` prefix keeps these clearly distinct from the `booking.*` /
 * `payment.*` server-lifecycle events and from PostHog's own `$autocapture`
 * names, so the two pipelines never collide in funnels.
 *
 * Every enum value must have an entry — the `Record<VisitorEventKind, …>`
 * type makes a missing kind a compile error when the enum grows.
 */
export const VISITOR_EVENT_NAMES: Record<VisitorEventKind, string> = {
  CLICK: "visitor.click",
  CTA_CLICK: "visitor.cta_click",
  FLEET_VIEW: "visitor.fleet_view",
  FLEET_CLICK: "visitor.fleet_click",
  FORM_FIELD_FOCUS: "visitor.form_field_focus",
  FORM_FIELD_CHANGE: "visitor.form_field_change",
  FORM_FIELD_BLUR: "visitor.form_field_blur",
  SEARCH: "visitor.search",
  DISCOUNT_ATTEMPTED: "visitor.discount_attempted",
  DISCOUNT_APPLIED: "visitor.discount_applied",
  DISCOUNT_REJECTED: "visitor.discount_rejected",
  SCROLL_DEPTH: "visitor.scroll_depth",
  EXIT_INTENT: "visitor.exit_intent",
  RAGE_CLICK: "visitor.rage_click",
  DEAD_CLICK: "visitor.dead_click",
  COPY: "visitor.copy",
  CHAT_OPEN: "visitor.chat_open",
  CHAT_MESSAGE_SENT: "visitor.chat_message_sent",
  WIZARD_STEP_ENTER: "visitor.wizard_step_enter",
  WIZARD_STEP_LEAVE: "visitor.wizard_step_leave",
  WIZARD_SNAPSHOT: "visitor.wizard_snapshot",
  PRICE_VIEWED: "visitor.price_viewed",
  CUSTOM: "visitor.custom",
};
