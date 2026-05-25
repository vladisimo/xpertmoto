/**
 * Back-office Help Centre — content manifest (the single source of truth for
 * article metadata). Prose lives as markdown files under `content/help/`; this
 * file holds only the typed metadata so the client bundle stays small and the
 * ⌘K palette / contextual `?` can search & resolve articles without reading the
 * file system.
 *
 * Audience is a *label only* — every back-office user can read every article
 * (the product decision was "show everything to everyone"); the badge just
 * orients the reader on who a guide is primarily written for.
 *
 * Adding an article = drop a `.md` under `content/help/<category>/` and add one
 * entry here. `tests/unit/lib/help/manifest.test.ts` guards that the file
 * exists, slugs are unique, and every `relatedNav` href is a real route.
 */

export type HelpAudience = "All" | "Staff" | "Manager" | "Admin" | "Super Admin";

export type HelpCategoryId =
  | "getting-started"
  | "operations"
  | "administration"
  | "policies";

export interface HelpCategory {
  id: HelpCategoryId;
  label: string;
  description: string;
  order: number;
}

export interface HelpArticle {
  /** URL slug, unique across all articles. */
  slug: string;
  title: string;
  /** One-line summary shown on cards and in search results. */
  summary: string;
  category: HelpCategoryId;
  /** Display-only label; not an access gate. */
  audience: HelpAudience;
  /** Extra search terms beyond title/summary. */
  keywords: readonly string[];
  /**
   * Real app route prefixes this article documents (e.g. "/staff/fleet").
   * Powers the reader's "Related pages" links and the contextual `?` button
   * (longest-prefix match against the current pathname).
   */
  relatedNav: readonly string[];
  /** Featured on the index "Getting started" rail. */
  featured?: boolean;
  /** Path under `content/help/`, e.g. "operations/fleet.md". */
  file: string;
}

export const HELP_CATEGORIES: readonly HelpCategory[] = [
  {
    id: "getting-started",
    label: "Getting started",
    description: "Orientation guides for each back-office role.",
    order: 0,
  },
  {
    id: "operations",
    label: "Operations",
    description: "The day-to-day staff portal: bookings, fleet, customers, comms.",
    order: 1,
  },
  {
    id: "administration",
    label: "Administration",
    description: "Configuration, users, finance, integrations and platform tools.",
    order: 2,
  },
  {
    id: "policies",
    label: "Policies & concepts",
    description: "The business rules behind pricing, bonds, cancellations and availability.",
    order: 3,
  },
];

export const HELP_ARTICLES: readonly HelpArticle[] = [
  // ── Getting started ────────────────────────────────────────────────────
  {
    slug: "back-office-basics",
    title: "Back-office basics",
    summary: "Navigation, global search, roles and two-factor sign-in — start here.",
    category: "getting-started",
    audience: "All",
    keywords: ["navigation", "sidebar", "search", "command", "2fa", "totp", "roles", "login"],
    relatedNav: ["/staff/dashboard"],
    featured: true,
    file: "getting-started/back-office-basics.md",
  },
  {
    slug: "for-staff",
    title: "Getting started for staff",
    summary: "Your first shift: triage tasks, check vehicles out and in, and help customers.",
    category: "getting-started",
    audience: "Staff",
    keywords: ["onboarding", "first day", "shift", "operations", "front desk"],
    relatedNav: ["/staff/dashboard", "/staff/tasks"],
    featured: true,
    file: "getting-started/for-staff.md",
  },
  {
    slug: "for-managers",
    title: "Getting started for managers",
    summary: "Oversee the depot: AI insights, reports, and team performance.",
    category: "getting-started",
    audience: "Manager",
    keywords: ["onboarding", "manager", "oversight", "team", "insights"],
    relatedNav: ["/staff/ai-insights", "/staff/dashboard"],
    featured: true,
    file: "getting-started/for-managers.md",
  },
  {
    slug: "for-admins",
    title: "Getting started for admins",
    summary: "Configure the business: users, depots, pricing, finance and integrations.",
    category: "getting-started",
    audience: "Admin",
    keywords: ["onboarding", "admin", "configuration", "setup"],
    relatedNav: ["/admin/dashboard", "/admin/users"],
    featured: true,
    file: "getting-started/for-admins.md",
  },
  {
    slug: "for-super-admins",
    title: "Getting started for super admins",
    summary: "Own the platform: system settings, infrastructure, backups and observability.",
    category: "getting-started",
    audience: "Super Admin",
    keywords: ["onboarding", "super admin", "platform", "infrastructure", "settings"],
    relatedNav: ["/admin/platform", "/admin/settings"],
    featured: true,
    file: "getting-started/for-super-admins.md",
  },

  // ── Operations ─────────────────────────────────────────────────────────
  {
    slug: "operations-dashboard",
    title: "Operations dashboard",
    summary: "The today view: pickups, returns, overdue, fleet compliance, mistakes, tyres and support.",
    category: "operations",
    audience: "Staff",
    keywords: ["dashboard", "today", "overdue", "overview", "home", "pickups", "returns", "fleet compliance", "mistakes", "tyres", "support", "escalation", "shift"],
    relatedNav: ["/staff/dashboard"],
    file: "operations/dashboard.md",
  },
  {
    slug: "priority-tasks",
    title: "Priority tasks",
    summary: "The shared work queue: claim, work and close prioritised tasks, with deep links into each job and a history of throughput.",
    category: "operations",
    audience: "Staff",
    keywords: ["tasks", "queue", "todo", "priority", "follow up", "claim", "start", "abandon", "tier", "urgent", "in progress", "history", "deep link", "work in progress"],
    relatedNav: ["/staff/tasks"],
    file: "operations/priority-tasks.md",
  },
  {
    slug: "bookings-calendar",
    title: "Bookings & calendar",
    summary: "Read the calendar, create walk-in bookings, and run a booking through its full lifecycle.",
    category: "operations",
    audience: "Staff",
    keywords: ["bookings", "calendar", "walk-in", "pos", "reservation", "schedule", "pickup", "return", "overdue", "status", "global search", "month view"],
    relatedNav: ["/staff/calendar", "/staff/bookings"],
    file: "operations/bookings-calendar.md",
  },
  {
    slug: "check-out-workflow",
    title: "Checking a vehicle out",
    summary: "The four-step pickup wizard: pre-hire inspection, identity & licence verification, sign the agreement, confirm handover.",
    category: "operations",
    audience: "Staff",
    keywords: ["check-out", "checkout", "pickup", "handover", "inspect", "sign", "allocate", "agreement", "verify", "identity", "eligibility", "active"],
    relatedNav: ["/staff/bookings"],
    file: "operations/check-out-workflow.md",
  },
  {
    slug: "check-in-workflow",
    title: "Checking a vehicle in",
    summary: "The return flow: inspect, assess damage, sign the statement, then settle and close.",
    category: "operations",
    audience: "Staff",
    keywords: ["check-in", "checkin", "return", "inspect", "assess", "settle", "sign", "damage", "late fee", "fuel", "bond"],
    relatedNav: ["/staff/bookings"],
    file: "operations/check-in-workflow.md",
  },
  {
    slug: "extend-swap-cancel",
    title: "Extending, swapping & cancelling",
    summary: "Mid-hire changes: extend a booking, swap the vehicle, or cancel with the right refund.",
    category: "operations",
    audience: "Staff",
    keywords: ["extend", "swap", "cancel", "refund", "change", "amend"],
    relatedNav: ["/staff/bookings"],
    file: "operations/extend-swap-cancel.md",
  },
  {
    slug: "customers",
    title: "Customers",
    summary: "The customer directory: profiles, risk, loyalty, documents and settings.",
    category: "operations",
    audience: "Staff",
    keywords: ["customers", "directory", "profile", "risk", "loyalty", "crm"],
    relatedNav: ["/staff/customers"],
    file: "operations/customers.md",
  },
  {
    slug: "licence-verification",
    title: "Licence verification",
    summary: "Verify customer licence photos before check-out and flag expiries.",
    category: "operations",
    audience: "Staff",
    keywords: ["licence", "license", "verification", "id", "verify", "expired"],
    relatedNav: ["/staff/customers"],
    file: "operations/licence-verification.md",
  },
  {
    slug: "fleet",
    title: "Fleet",
    summary: "The vehicle inventory: statuses, details, telematics and availability.",
    category: "operations",
    audience: "Staff",
    keywords: ["fleet", "vehicles", "inventory", "rego", "bikes", "scooters"],
    relatedNav: ["/staff/fleet"],
    file: "operations/fleet.md",
  },
  {
    slug: "maintenance",
    title: "Maintenance",
    summary: "Schedule and record vehicle servicing and keep bikes off-hire while in the shop.",
    category: "operations",
    audience: "Staff",
    keywords: ["maintenance", "service", "repair", "workshop", "off-hire"],
    relatedNav: ["/staff/maintenance"],
    file: "operations/maintenance.md",
  },
  {
    slug: "inspections",
    title: "Inspections",
    summary: "Record condition inspections with photos and damage marks.",
    category: "operations",
    audience: "Staff",
    keywords: ["inspection", "condition", "photos", "damage", "checklist"],
    relatedNav: ["/staff/inspections"],
    file: "operations/inspections.md",
  },
  {
    slug: "incidents",
    title: "Incidents",
    summary: "Log accidents, theft and damage events and track them to resolution.",
    category: "operations",
    audience: "Staff",
    keywords: ["incident", "accident", "theft", "damage", "claim"],
    relatedNav: ["/staff/incidents"],
    file: "operations/incidents.md",
  },
  {
    slug: "infringements-tolls",
    title: "Infringements & tolls",
    summary: "Match traffic fines and eToLL charges to the responsible booking and on-charge them.",
    category: "operations",
    audience: "Staff",
    keywords: ["infringement", "fine", "toll", "etoll", "penalty", "on-charge"],
    relatedNav: ["/staff/infringements", "/staff/tolls"],
    file: "operations/infringements-tolls.md",
  },
  {
    slug: "communications",
    title: "Communications",
    summary: "The comms log, composer, campaigns, segments, preferences and automations.",
    category: "operations",
    audience: "Staff",
    keywords: ["communications", "email", "sms", "campaign", "segment", "automation", "messaging"],
    relatedNav: ["/staff/communications"],
    file: "operations/communications.md",
  },
  {
    slug: "support-tickets",
    title: "Support tickets",
    summary: "Triage and answer customer support tickets, with AI insights into recurring issues.",
    category: "operations",
    audience: "Staff",
    keywords: ["support", "tickets", "help desk", "customer service", "insights"],
    relatedNav: ["/staff/support"],
    file: "operations/support-tickets.md",
  },
  {
    slug: "live-visitors",
    title: "Live visitors & analytics",
    summary: "Real-time site activity plus sessions, acquisition, conversion and retention analytics.",
    category: "operations",
    audience: "Manager",
    keywords: ["live", "visitors", "analytics", "sessions", "conversion", "posthog", "traffic"],
    relatedNav: ["/staff/live"],
    file: "operations/live-visitors.md",
  },
  {
    slug: "ai-insights",
    title: "AI insights",
    summary: "AI-generated narratives that surface trends, risks and opportunities.",
    category: "operations",
    audience: "Manager",
    keywords: ["ai", "insights", "narrative", "trends", "analysis"],
    relatedNav: ["/staff/ai-insights", "/admin/ai-insights"],
    file: "operations/ai-insights.md",
  },

  // ── Administration ───────────────────────────────────────────────────────
  {
    slug: "admin-dashboard",
    title: "Admin dashboard",
    summary: "Business overview with risk, debt and support tabs.",
    category: "administration",
    audience: "Admin",
    keywords: ["admin", "dashboard", "overview", "risk", "debt", "kpi"],
    relatedNav: ["/admin/dashboard"],
    file: "administration/admin-dashboard.md",
  },
  {
    slug: "users-and-roles",
    title: "Users & roles",
    summary: "Invite team members, assign roles, manage sessions and enforce 2FA.",
    category: "administration",
    audience: "Admin",
    keywords: ["users", "roles", "permissions", "invite", "staff accounts", "sessions", "2fa"],
    relatedNav: ["/admin/users"],
    file: "administration/users-and-roles.md",
  },
  {
    slug: "depots",
    title: "Depots",
    summary: "Configure locations, opening hours and depot-specific settings.",
    category: "administration",
    audience: "Admin",
    keywords: ["depots", "locations", "branches", "sites", "hours"],
    relatedNav: ["/admin/depots"],
    file: "administration/depots.md",
  },
  {
    slug: "finance",
    title: "Finance",
    summary: "Bonds, categories, GST, invoices, reconciliation and transactions.",
    category: "administration",
    audience: "Admin",
    keywords: ["finance", "invoices", "gst", "bonds", "reconciliation", "transactions", "payments"],
    relatedNav: ["/admin/finance"],
    file: "administration/finance.md",
  },
  {
    slug: "pricing",
    title: "Pricing",
    summary: "Set base rates, duration discounts, seasonal multipliers, overrides and discount codes.",
    category: "administration",
    audience: "Admin",
    keywords: ["pricing", "rates", "discount", "seasonal", "yield", "tariff", "codes"],
    relatedNav: ["/admin/pricing", "/admin/finance"],
    file: "administration/pricing.md",
  },
  {
    slug: "reports",
    title: "Reports",
    summary: "Bookings, fleet, customer, financial and operational reporting.",
    category: "administration",
    audience: "Admin",
    keywords: ["reports", "reporting", "export", "financial", "operational", "analytics"],
    relatedNav: ["/admin/reports"],
    file: "administration/reports.md",
  },
  {
    slug: "integrations",
    title: "Integrations",
    summary: "Connect payments, ID, messaging, accounting, tolls and operations services.",
    category: "administration",
    audience: "Admin",
    keywords: ["integrations", "stripe", "twilio", "accounting", "api keys", "connections"],
    relatedNav: ["/admin/integrations"],
    file: "administration/integrations.md",
  },
  {
    slug: "notification-templates",
    title: "Notification templates",
    summary: "Edit the email and SMS templates the system sends to customers.",
    category: "administration",
    audience: "Admin",
    keywords: ["templates", "email", "sms", "notifications", "messages"],
    relatedNav: ["/admin/notification-templates"],
    file: "administration/notification-templates.md",
  },
  {
    slug: "audit-log",
    title: "Audit log",
    summary: "The full security and activity trail: auth, mutations, webhooks, jobs and impersonation.",
    category: "administration",
    audience: "Admin",
    keywords: ["audit", "log", "security", "activity", "compliance", "impersonation"],
    relatedNav: ["/admin/audit-log"],
    file: "administration/audit-log.md",
  },
  {
    slug: "damage-tariff",
    title: "Damage tariff",
    summary: "Maintain the priced list of damage items used to settle returns.",
    category: "administration",
    audience: "Admin",
    keywords: ["damage", "tariff", "charges", "repair costs", "settlement"],
    relatedNav: ["/admin/damage-tariff"],
    file: "administration/damage-tariff.md",
  },
  {
    slug: "webhooks",
    title: "Webhooks",
    summary: "Inspect and replay inbound webhooks from Stripe, Twilio and other providers.",
    category: "administration",
    audience: "Admin",
    keywords: ["webhooks", "stripe", "twilio", "events", "replay", "callbacks"],
    relatedNav: ["/admin/webhooks", "/admin/finance"],
    file: "administration/webhooks.md",
  },
  {
    slug: "platform",
    title: "Platform",
    summary: "Super-admin system view: database, server, storage, LLM, email, SMS, payments, observability.",
    category: "administration",
    audience: "Super Admin",
    keywords: ["platform", "infrastructure", "database", "storage", "observability", "system"],
    relatedNav: ["/admin/platform"],
    file: "administration/platform.md",
  },
  {
    slug: "system-settings",
    title: "System settings",
    summary: "Super-admin configuration: branding, policies, business rules and feature flags.",
    category: "administration",
    audience: "Super Admin",
    keywords: ["settings", "configuration", "branding", "policy", "feature flags", "business rules"],
    relatedNav: ["/admin/settings"],
    file: "administration/system-settings.md",
  },
  {
    slug: "backups",
    title: "Backups",
    summary: "Review data backups and restore points.",
    category: "administration",
    audience: "Super Admin",
    keywords: ["backups", "restore", "snapshot", "disaster recovery"],
    relatedNav: ["/admin/backups"],
    file: "administration/backups.md",
  },

  // ── Policies & concepts ──────────────────────────────────────────────────
  {
    slug: "gst-and-pricing-cascade",
    title: "GST & the pricing cascade",
    summary: "How GST-inclusive pricing works and the order rates, discounts and overrides apply.",
    category: "policies",
    audience: "All",
    keywords: ["gst", "tax", "pricing", "cascade", "rates", "discount", "abn"],
    relatedNav: ["/admin/pricing", "/admin/finance"],
    file: "policies/gst-and-pricing-cascade.md",
  },
  {
    slug: "bonds-and-deposits",
    title: "Bonds & deposits",
    summary: "How the security bond is authorised, held and released after return.",
    category: "policies",
    audience: "All",
    keywords: ["bond", "deposit", "security", "authorisation", "hold", "release"],
    relatedNav: ["/admin/finance", "/staff/bookings"],
    file: "policies/bonds-and-deposits.md",
  },
  {
    slug: "cancellation-and-no-show",
    title: "Cancellation & no-show policy",
    summary: "Refund tiers by notice period, the admin fee, and no-show charges.",
    category: "policies",
    audience: "All",
    keywords: ["cancellation", "refund", "no-show", "policy", "fee"],
    relatedNav: ["/admin/settings", "/staff/bookings"],
    file: "policies/cancellation-and-no-show.md",
  },
  {
    slug: "late-returns-and-overdue",
    title: "Late returns & overdue",
    summary: "The grace period, hourly late-fee maths, and how OVERDUE status is set automatically.",
    category: "policies",
    audience: "All",
    keywords: ["late", "overdue", "grace period", "hourly", "fee", "return"],
    relatedNav: ["/staff/bookings", "/staff/dashboard"],
    file: "policies/late-returns-and-overdue.md",
  },
  {
    slug: "availability-and-allocation",
    title: "Availability & allocation",
    summary: "How the system decides a vehicle is bookable and when units are allocated.",
    category: "policies",
    audience: "All",
    keywords: ["availability", "allocation", "cleaning buffer", "overlap", "booking rules"],
    relatedNav: ["/staff/fleet", "/staff/calendar"],
    file: "policies/availability-and-allocation.md",
  },
];

export function getArticle(slug: string): HelpArticle | undefined {
  return HELP_ARTICLES.find((a) => a.slug === slug);
}

export function getCategory(id: HelpCategoryId): HelpCategory | undefined {
  return HELP_CATEGORIES.find((c) => c.id === id);
}

export function articlesByCategory(id: HelpCategoryId): HelpArticle[] {
  return HELP_ARTICLES.filter((a) => a.category === id);
}

export function featuredArticles(): HelpArticle[] {
  return HELP_ARTICLES.filter((a) => a.featured);
}
