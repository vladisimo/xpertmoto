---
name: ui-review
description: Audit UI changes in the XPERT Moto app against the UI/UX Contract in CLAUDE.md. Run after editing any file under src/app/** or src/components/** before marking the work done. Reports file:line violations and the contract-compliant replacement.
---

# UI Review

You are auditing the files that were edited in this session against the
XPERT Moto UI/UX Contract. Your output must be a concrete list of violations
with file:line references and the fix. Do not be vague.

## Files to audit

Scan every file you edited (or created) under:
- `src/app/**/*.tsx`
- `src/components/**/*.tsx`

Skip `src/components/ui/**` primitives themselves — they are exempt from the
"use the primitive" rules because they ARE the primitives.

## Checklist — flag any match

Run these checks with Grep and report each hit. For each hit, propose the
contract-compliant replacement.

1. **Bare `<h1>` or `<h2>` at page root** (not inside `<PageHeader>` or
   `<PageSection>`).
   Fix: wrap the page body in `<PageShell>` + `<PageHeader title=...>`; use
   `<PageSection title=...>` for each content block.

2. **Raw tone-pair classes outside `status-badge.tsx`**:
   `bg-amber-100 text-amber-800`, `bg-emerald-100 text-emerald-800`,
   `bg-red-100 text-red-800`, `bg-sky-100 text-sky-800`, etc.
   Fix: use `<StatusBadge status={...} />`. If the status isn't in
   `STATUS_TONE_MAP`, add it there — do not inline.

3. **Native `<select>` elements** in `src/app/**` or any form component.
   Fix: shadcn `<Select>` + `<SelectTrigger>` + `<SelectValue>` +
   `<SelectContent>` + `<SelectItem>`.

4. **`<Input>` or raw `<input>` without a `<FormField>` wrapper**, in any
   page outside `/login`, `/register`, `/forgot-password`. Filter inputs
   (search boxes) are allowed.
   Fix: react-hook-form + zod resolver + `<Form>` + `<FormField>` pattern —
   see [src/app/(admin)/admin/users/page.tsx](../../src/app/(admin)/admin/users/page.tsx).

5. **`brand-green|brand-orange|brand-blue|brand-amber|brand-ink|brand-soft|brand-bg`
   classes in newly edited code.**
   Fix: replace with semantic tokens — `bg-primary`, `text-foreground`,
   `bg-muted`, `bg-accent`, `bg-secondary`, `bg-background`.

6. **Hardcoded hex colours in className/style** (`#1B6B4A`, `#F59E0B`,
   `rgb(...)`, inline style colours).
   Fix: use `hsl(var(--primary))` in CSS, or semantic token Tailwind classes.

7. **Mixed `space-y-*` values as direct siblings of the same parent**.
   Fix: use the spacing scale — `space-y-8` at `PageShell`, `space-y-6`
   inside `PageSection`, `space-y-4` in card body, `space-y-2` label+control.

8. **Card-per-row list with 4+ fields per record**. Fix: replace with
   `<DataTable>` from `src/components/ui/data-table.tsx`. See
   `src/components/staff/customers-table.tsx` for the client-wrapper pattern
   when data is fetched on the server.

9. **`<Button>` with `className` that re-adds `rounded-full`,
   `uppercase`, or `tracking-wide`** (attempting to restore the old default).
   Fix: if it's a marketing CTA use `variant="cta"`; otherwise accept the
   new default styling.

10. **Raw `text-3xl font-bold` / `text-4xl font-bold` on page title** instead
    of using `PageHeader` or the `.h1` / `.h-display` class.
    Fix: switch to `PageHeader` or the typography utility class.

11. **Staff and admin pages with hardcoded sidebar colours** (e.g.
    `bg-slate-900` re-inlined). The accent must come from `accent="staff"`
    or `accent="admin"` on the shell, not the page.

12. **Tables with light-surface headers, non-white row bodies, or the
    wrong outer radius.** All tables render with a dark header
    (`bg-primary text-primary-foreground`), a white row body (`bg-card`),
    and a `rounded-md` outer wrapper — matching the default `<Button>`
    radius. `rounded-lg` on a table wrapper is a miss. Flag any of:
    - Hand-rolled `<thead>` in `src/app/**` or `src/components/**` (outside
      `src/components/ui/**`) using `bg-muted`, `bg-background`,
      `bg-muted/50`, or similar light surfaces.
    - `<TableHeader className="bg-muted …">` or any caller override that
      replaces the dark header with a light one.
    - `<tbody>` or row `className` that sets `bg-muted`, `bg-accent`, or a
      non-white surface on body rows.
    Fix: prefer `<DataTable>` / `<Table>` + `<TableHeader>` primitives
    unchanged. If a custom `<table>` is unavoidable (e.g. a scroll-locked
    table with sticky header), the outer wrapper is
    `rounded-md border overflow-hidden bg-card`; use
    `bg-primary text-primary-foreground` on the `<thead>` and `bg-card` on
    the `<tbody>`. Header `<th>` cells use `text-xs font-semibold uppercase
    tracking-wide text-primary-foreground/80`.

## Output format

```
ui-review: N violations across M files

1. src/app/foo/page.tsx:42
   Violation: raw <select> element
   Fix: replace with shadcn <Select>; see src/app/(admin)/admin/users/page.tsx

2. src/app/foo/page.tsx:67
   Violation: bg-amber-100 text-amber-800 tone pair
   Fix: <StatusBadge status="WARNING" /> or add a new status to STATUS_TONE_MAP
```

If zero violations, output `ui-review: 0 violations. ✓ compliant.`

## Do not

- Propose drive-by refactors outside the edited files.
- Flag patterns inside `src/components/ui/**` primitives.
- Change code yourself — report only. The caller decides whether to fix or
  waive each flag.
