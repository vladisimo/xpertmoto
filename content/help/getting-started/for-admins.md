# Getting started for admins

Admins configure how the business runs. You have the full Operations portal plus
the **Administration** portal (indigo). This guide is a tour of the setup you're
responsible for.

## First-week checklist

1. **Depots** — confirm your locations, opening hours and depot-specific
   settings are correct. Availability and allocation depend on them.
2. **Users & roles** — invite your team, assign the right role, and confirm 2FA
   is enforced. Keep the number of Super Admins small.
3. **Pricing** — review base rates, duration discounts, seasonal multipliers and
   any depot overrides. See **Pricing** and **GST & the pricing cascade**.
4. **Finance** — check GST settings, bond amounts, invoice numbering and the
   reconciliation view. See **Finance**.
5. **Integrations** — connect payments, ID verification, messaging (email/SMS)
   and accounting. Nothing sends or charges until these are live.
6. **Notification templates** — review the emails and SMS the system sends so
   they match your tone and policies.

## Keep an eye on the business

- **Admin → Dashboard** gives you Overview, Risk, Debt and Support tabs — your
  daily health check.
- **Reports** covers bookings, fleet, customers, financial and operational
  reporting for deeper analysis and exports.
- **Audit Log** is your compliance and security trail: who changed what, auth
  events, webhooks, jobs and any impersonation.

## Money is sensitive — handle with care

Pricing, bonds, refunds and damage charges all flow through the rules described
in the **Policies & concepts** guides. Read those before changing anything that
affects what customers pay. All prices are GST-inclusive and every invoice
carries the {{legalName}} ABN ({{abn}}).

## What needs a Super Admin

Infrastructure (database, storage, observability) and global **System Settings**
(branding, business-rule defaults, feature flags) require the **Super Admin**
role. See **Getting started for super admins**.
