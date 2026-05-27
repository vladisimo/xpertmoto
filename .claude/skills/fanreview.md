---
name: fanreview
description: Local multi-agent code review of the current branch — a self-hosted approximation of /ultrareview. Fans out 6 parallel reviewer subagents (security, correctness, tests, CLAUDE.md-compliance, performance, UI/UX) over the branch diff, then deduplicates and ranks findings and verifies the high-severity ones. Use before opening a PR or when the user asks for a "deep review", "full review", "fan out review", or "review this branch". Reports file:line findings with severity. Does NOT replace the cloud /ultrareview (no remote sandbox); it is repo-tuned and free/local.
---

# Fan-out review (local /ultrareview approximation)

You are the **orchestrator** of a multi-agent review of the current branch.
You do not review the code yourself — you compute the diff, fan out six
reviewer subagents in parallel, then synthesize, dedupe, rank, and verify
their findings. This is a local, repo-tuned stand-in for the cloud
`/ultrareview`; be honest that it lacks the remote sandbox and the cloud
verification pipeline.

## 1. Establish the change set

Default to **branch diff vs `main`**. If `$ARGUMENTS` is a number, treat it
as a GitHub PR and use `gh pr diff <n>` / `gh pr checkout <n>` instead.

```bash
git fetch origin main --quiet 2>/dev/null
git diff --stat main...HEAD          # committed changes on the branch
git status --porcelain                # uncommitted/staged work — include it
git diff main...HEAD                  # the full committed diff
git diff                              # unstaged
git diff --cached                     # staged
```

Build a single list of **changed files** (committed + staged + unstaged).
If the list is empty, output `fanreview: no changes vs main. nothing to review.`
and stop. If it is very large (>4000 changed lines), tell the user and offer
to scope to a subdirectory before spending the agents.

## 2. Fan out — six reviewers, in parallel, in ONE message

Spawn all six with the `Agent` tool **in a single message** (multiple tool
calls in one block) so they run concurrently. Use `subagent_type:
"general-purpose"`. Give each the exact changed-file list and this hard rule:

> Read-only. Do NOT edit, write, or run mutating commands. Report findings
> only, as `file:line — SEVERITY — issue — fix`. Severity is one of
> BLOCKER / IMPORTANT / NIT / PRE-EXISTING. Only flag things you can point
> to a concrete line for. No vague "consider refactoring".

The six lenses (tailor each prompt; the repo specifics matter more than the
generic ones):

1. **Security** — authz/authn gaps, IDOR (esp. tenant/customer scoping — see
   the profile-based customer identity rule), injection, secrets in code,
   missing input validation, raw PAN handling, PII leaking to `console.*`
   instead of the redacting `logger`. Mirror the `/security-review` lens.
2. **Correctness / logic** — off-by-one, null/undefined, race conditions,
   error paths, mishandled promises, money math (must use
   `gstFromInclusive()`, never inline `/ 11`; `Decimal`, never `Float`),
   booking invariants (completion → `recordBookingCompletion`, availability
   buffer, pricing cascade, bond/cancellation/late rules in root CLAUDE.md).
3. **Tests / coverage** — every new/changed tRPC procedure needs a happy-path
   + failure-case Vitest test at the mirror path `tests/unit/X/Y.test.ts`;
   every new user-visible mutation needs a Playwright optimistic-UI smoke.
   Flag changed `src/**` files with no corresponding test touched.
4. **CLAUDE.md-compliance** — the per-folder contracts: root + `prisma/` +
   `src/server/trpc/` + `src/components/ui/` + `src/lib/`. Schema edits must
   ship a migration in the same change. tRPC procedure-layer/audit-log rules.
   Branding must read `getBranding()`, never hardcode trading/legal/ABN.
   Brisbane-TZ job gotcha. Out-of-stack deps (flag new `openai` surface).
5. **Performance** — missing cursor pagination on list endpoints, N+1 Prisma
   queries, missing indexes on new FKs/filters, un-memoized heavy client work,
   non-lazy heavy components (calendar/map/PDF), missing `next/image`.
6. **UI/UX** — run the existing `ui-review` checklist against changed
   `src/app/**` and `src/components/**` (skip `src/components/ui/**`): layout
   primitives, semantic tokens vs raw tone pairs/hex, shadcn `<Select>`, table
   dark-header contract, `<StatusBadge>`, spacing scale, role-distinct shells.

Pass each agent the changed-file list verbatim so they don't re-derive it.

## 3. Synthesize

When all six return:
- **Merge** their findings into one list keyed by `file:line`.
- **Dedupe** — if multiple lenses flag the same line, keep one entry and note
  which lenses agreed (agreement raises confidence).
- **Rank** BLOCKER → IMPORTANT → NIT → PRE-EXISTING; within a tier, files with
  multi-lens agreement first.

## 4. Verify the high-severity findings (the cheap approximation)

For every BLOCKER and IMPORTANT, open the actual file at that line yourself
and confirm the finding is real — not a hallucination or a misread of the
diff. Demote or drop anything you can't substantiate. This is the local
stand-in for the cloud's independent-verification step; say so plainly and
do not claim the same confidence level.

## 5. Output format

```
fanreview: N findings (B blocker / I important / X nit / P pre-existing)
across M files · 6 lenses · verified high-severity

BLOCKERS
1. src/server/trpc/router/booking.ts:88
   [security, correctness] Booking guard checks role===CUSTOMER, not CustomerProfile — back-office users with a profile are wrongly blocked.
   Fix: use isCustomer() from src/lib/customer-identity.ts. (verified ✓)

IMPORTANT
2. ...

NITS
...

PRE-EXISTING (not introduced by this branch, noted not blocking)
...
```

If zero findings: `fanreview: 0 findings across the branch. ✓` — but still
say which lenses ran so the user knows the coverage.

## Do not

- Edit or fix code. Report only; the user decides what to act on. (If they
  then say "fix the blockers", that's a separate, in-scope task.)
- Claim parity with the cloud `/ultrareview` — no remote sandbox, no fleet
  scaling, lighter verification. State the difference if asked.
- Propose drive-by refactors outside the changed files (root CLAUDE.md §1).
- Let a reviewer subagent make edits — they are read-only by contract.
- Re-flag `src/components/ui/**` primitives in the UI/UX lens.
