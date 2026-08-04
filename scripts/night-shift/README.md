# Night shift — autonomous 00:05–04:55 runner

Unattended overnight agents work through a curated task queue, one task at a
time, each in an isolated git worktree → branch → **pull request**. Nothing
ever merges autonomously; you review the PRs in the morning.

Adapted from the onlyplans factory (`/home/vlad/onlyplans/.factory/`), with
the merge step replaced by push + PR and repo-specific safety rails.

## Anatomy of one task

1. `git worktree add night/YYYYMMDD-<id>` off **origin/main** (never local
   state); gitignored `.env*` copied in; `node_modules` hardlink-seeded
   (`.prisma`/`@prisma/client` real-copied — Prisma writes through hardlinks).
2. Baseline sanity: `lint-status-badges.sh` must be green on the base —
   it's not in cloud CI, so a red baseline aborts the night rather than
   burning the task.
3. Headless build session (`claude -p --model opus`) with the task prompt =
   contract preamble (scope globs, no deps, no schema, mirror-rule tests,
   diff cap) + the task body. Project hooks still fire; `typecheck-changed`,
   `definition-of-done` and `git-sync-reminder` are skipped via
   `CLAUDE_SKIP_HOOKS` (replaced by the explicit gate below + a bounded
   one-shot Stop nudge). `night-settings.json` adds a PreToolUse tripwire:
   writes fenced to the worktree, canonical checkout read-only, no
   `git push`/`gh`/dep installs/destructive DB/docker commands.
4. Hard gates on the staged diff: schema/deps/guardrail files, scope globs,
   diff-size cap (default 1500 changed lines). Any failure → task fails,
   work is bundled, **nothing ships**.
5. DoD gate: typecheck + lint + `lint-status-badges` + **full vitest**
   (`+build`/e2e by task opt-in). Red → one 20-minute repair session → one
   re-gate. Still red → fail + bundle.
6. Commit, then a read-only **critic** session (sonnet) reviews
   `git diff origin/main...HEAD` through correctness/contract/test lenses →
   JSON verdict. `approve`/`concerns` → push + PR (verdict + findings in the
   PR body). `block` → branch pushed, **no PR**, task marked failed.
7. Morning report: `~/xpertmoto-night/reports/night-YYYYMMDD.md` — outcomes,
   PR links, DoD table, critic findings, wall-clocks, rate-limit events.

## Controls

```
scripts/night-shift/nightctl status     # lanes, timer, current task
scripts/night-shift/nightctl plan       # queued tasks in run order
scripts/night-shift/nightctl stop       # STOP file + kill in-flight run
scripts/night-shift/nightctl resume     # clear STOP
scripts/night-shift/nightctl report     # latest morning report
scripts/night-shift/nightctl dry-run NT-0XX   # full flow, no push/PR
scripts/night-shift/nightctl enable|disable   # the 00:05 systemd timer
```

State lives in `~/xpertmoto-night/` (queue/running/done/failed/skipped,
logs, reports, bundles of unshipped work). Task format:
`scripts/night-shift/tasks/TEMPLATE.md`.

## Invariants

- Preflight aborts the whole night (with a report) on: STOP file, dirty
  canonical tree, red main CI, low disk, unreachable origin, missing
  services for queued e2e tasks.
- Max 3 tasks/night, sequential; no new task after 03:30; SIGTERM 04:55.
- One rate-limit retry per task (15 min backoff); 2 events/night → stop.
- Schema is locked three ways in week 1 (curation + staged-file gate +
  protect-schema.sh); `allow_schema: true` in a task's front-matter unlocks
  all three deliberately.
- Failed work is never lost: bundles in `~/xpertmoto-night/bundles/`
  (`git bundle` — fetchable: `git fetch <bundle> <branch>`).
- **Never edit these scripts while a night is running** — bash reads
  scripts incrementally; edit between runs only.
