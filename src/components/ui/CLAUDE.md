# src/components/ui/ — UI/UX Contract (MANDATORY)

This file is loaded when Claude reads or edits any component file. It is the **single source of truth** for the UI primitives, tokens, and patterns in this app. The root [CLAUDE.md](../../../CLAUDE.md) covers stack-wide change management; this file owns visual + interaction discipline.

If a change touches `src/app/**` or `src/components/**`, run the `ui-review` skill at [.claude/skills/ui-review.md](../../../.claude/skills/ui-review.md) before marking the work done and fix every flag it reports.

This contract exists because the app's UI was drifting — same feature rendered three different ways across three pages. The primitives below are the single source of truth for their surface.

## Layout primitives — never hand-roll equivalents

- **Every authenticated page** wraps its body in `<PageShell>` (from [page-section.tsx](../layout/page-section.tsx)).
- **Page top** uses `<PageHeader>` (from [page-header.tsx](../layout/page-header.tsx)) with `title`, optional `eyebrow`, `description`, `breadcrumbs`, and `actions`. **No bare `<h1>` at page root.**
- **Each grouped content block** uses `<PageSection>` — provides consistent heading, card surface, and rhythm. Use `flush` for blocks that provide their own surface (e.g. card grids).
- **Lists of records**: use `<DataTable>` (from [data-table.tsx](data-table.tsx)) with typed column defs. Card-per-row is allowed ONLY when each record has fewer than 4 fields (e.g. a dashboard summary). For a ≥4-column list, use `<DataTable>`.

  Reference implementations:
  - [staff customers](../../app/(staff)/staff/customers/page.tsx)
  - [customer bookings](../../app/(customer)/dashboard/bookings/page.tsx)
  - [admin users](../../app/(admin)/admin/users/page.tsx)

- **Forms**: use shadcn `<Form>` + `<FormField>` + `<FormItem>` + `<FormLabel>` + `<FormControl>` + `<FormMessage>` with `react-hook-form` and a `zod` `resolver`. Wrap the field set in `<FormGrid cols={2}>` (from [form-grid.tsx](../forms/form-grid.tsx)) and use `<FormGridRow>` for full-width rows. **Raw `<Input>` with a raw `<Label>` outside `<FormField>` is banned in new code.**
- **Selects**: shadcn `<Select>` from [select.tsx](select.tsx). **Native `<select>` elements are banned.**
- **Status chips**: `<StatusBadge status={...} />` (from [status-badge.tsx](status-badge.tsx)) is the ONLY way to render a domain status enum. Hand-rolling tone pairs (`bg-amber-100 text-amber-800`, `bg-emerald-50 text-emerald-700`, etc.) is banned. Defining a local `STATUS_VARIANT` / `SEVERITY_VARIANT` / `PRIORITY_VARIANT` / `CONDITION_VARIANT` map next to a `<Badge>` import is also banned — add the missing key to `STATUS_TONE_MAP` instead.

  Use the `label?` prop to override displayed text without forking the colour:

  ```tsx
  <StatusBadge status="OVERDUE" label={`Stage ${n}/4`} />
  ```

  The shadcn `<Badge>` primitive is reserved for non-status pills only — counts, `+N more` aggregates, neutral type tags. It must NOT be used for status enums; the `success` and `warning` variants have been removed from `<Badge>` for exactly that reason. Enforced by [scripts/lint-status-badges.sh](../../../scripts/lint-status-badges.sh).

## Tokens — semantic only, never hardcoded

- **Colours**: use semantic tokens: `bg-primary`, `text-foreground`, `bg-muted`, `text-destructive`, `bg-accent`, `border-border`. The legacy `brand-*` classes are DEPRECATED and retained only until the marketing pages migrate; do not introduce new uses.
- **Never** hardcode hex (`#1B6B4A`) or raw Tailwind palette tones (`bg-green-600`, `text-amber-700`) in component className or `style`. If you need an amber warning surface, use the `warning` tone on `StatusBadge` or `bg-destructive/10 text-destructive` for errors.
- **Radii**: `rounded-md` for inputs/cards/rows, `rounded-lg` for outer containers, `rounded-full` for pills, avatars, and badges. No other radii.
- **Spacing (vertical rhythm)**: `space-y-8` at `<PageShell>` root, `space-y-6` inside a `<PageSection>`, `space-y-4` inside a card body, `space-y-2` for label+control pairs. Do not mix scales as direct siblings under the same parent.
- **Typography**: use the semantic classes — `.h-display` (marketing hero), `.h1` (page title, applied by `PageHeader`), `.h2`, `.h3` (section), `.body-text`, `.caption`, `.eyebrow`. Headings automatically use `font-display` (Space Grotesk); body uses `font-sans` (Rubik). Don't apply raw `text-3xl font-bold` to page titles — use `PageHeader` or `.h1`.

## Buttons

- `variant="default"` — the single primary action on a view.
- `variant="secondary"` — outline, for secondary actions and "Cancel".
- `variant="ghost"` — transparent, tertiary / toolbar actions.
- `variant="destructive"` — delete / sign out / refund.
- `variant="link"` — inline text links that look like buttons.
- `variant="cta"` — pill, uppercase, tracked, with depth. **Reserved for public marketing pages.** Never in the back-office or customer portal.

Sizes: `default` (h-10), `sm`, `lg`, `icon`.

## Role-distinct shells

- `/staff/*` uses `<BackOfficeShell accent="staff">` (green accent). Already wired via the staff layout.
- `/admin/*` uses `<BackOfficeShell accent="admin">` (indigo accent + Admin chip). Already wired via the admin layout. Do not copy the staff layout into admin without changing the accent.

## Canonical reference pages

When in doubt, mirror the structure of these already-migrated pages:

- Marketing: [src/app/(public)/page.tsx](../../app/(public)/page.tsx)
- Ops dashboard: [src/app/(staff)/staff/dashboard/page.tsx](../../app/(staff)/staff/dashboard/page.tsx)
- Detail page: [src/app/(staff)/staff/bookings/[id]/page.tsx](../../app/(staff)/staff/bookings/%5Bid%5D/page.tsx)
- Admin list + form: [src/app/(admin)/admin/users/page.tsx](../../app/(admin)/admin/users/page.tsx)

## Stats / dashboard widgets

For mixed stats rows on dashboards, follow the pattern documented in the user's persistent memory entry "Statistics UI pattern" — big-number tile + stacked bar + donut + progress, all rendered with recharts and semantic tokens. Keep widget sizes consistent (h-32 / h-48 / h-64). No hand-rolled SVG; no hardcoded chart colour palettes.

## Branding

Never hardcode "XPERT Moto" or any trading name in a component. Always read via `useBranding()` (client) or `getBranding()` (server). The fallback string in [`branding-provider.tsx`](../shared/branding-provider.tsx) exists only as a typed placeholder — it is not the live answer. See the `feedback_branding_provider_fallback.md` memory for the broader rule.

## Before finishing any UI change

Run the `ui-review` skill. Every flag is a must-fix unless the user has explicitly waived it in the current turn.
