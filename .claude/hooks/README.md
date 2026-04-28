# Scootering — Claude Code hooks

Project-scoped hooks that run on every Claude Code session in this repo. They enforce the change-management rules in [CLAUDE.md](../../CLAUDE.md) § "Change Management for Claude Code Sessions" and give fast feedback so scope creep and regressions are caught before they compound.

All hooks are wired through [.claude/settings.json](../settings.json).

## Hook inventory

### PreToolUse (may block)
| Script | Triggers on | Behaviour |
|---|---|---|
| [pre/protect-schema.sh](pre/protect-schema.sh) | `Write`/`Edit` to `prisma/schema.prisma` | **Blocks** unless the current user turn mentions `migration` or `schema change`. |
| [pre/guard-package-json.sh](pre/guard-package-json.sh) | `Write`/`Edit` to `package.json` | Non-blocking. Diffs against `HEAD` and prints added/removed deps so every dep change is audited in transcript. |
| [pre/guard-claude-md.sh](pre/guard-claude-md.sh) | `Write`/`Edit` to `CLAUDE.md` | Non-blocking reminder that CLAUDE.md is authoritative and edits must be user-requested. |
| [pre/guard-middleware.sh](pre/guard-middleware.sh) | `Write`/`Edit` to `src/middleware.{ts,js}` | **Blocks** — Next.js 16 deprecated `middleware.ts` in favour of `proxy.ts`. Having both triggers a fatal dev-server error. |
| [pre/guard-bash.sh](pre/guard-bash.sh) | `Bash` tool calls | **Blocks** dangerous commands: `rm -rf` against `/`/`~`/project-critical paths; `prisma db push` against non-localhost DBs; `git push --force` to `main`/`master`. Warns on `git reset --hard` and unpinned `npm install`. |

### PostToolUse (feedback-only; may exit non-zero on failure)
| Script | Triggers on | Behaviour |
|---|---|---|
| [post/lint-changed.sh](post/lint-changed.sh) | Edits to `*.ts`/`*.tsx`/`*.js`/`*.jsx` | Runs `eslint --fix` on the single file. Autofix lands back on disk. |
| [post/typecheck-changed.sh](post/typecheck-changed.sh) | Edits to `*.ts`/`*.tsx` | Runs `tsc --noEmit -p tsconfig.json` project-wide. Debounced (5s) via `.typecheck.stamp`. |
| [post/test-affected.sh](post/test-affected.sh) | Edits to `src/server/**/*.ts` | Runs the matching `tests/unit/<stem>.test.ts` via Vitest if both exist. Silent if Vitest isn't installed yet. |
| [post/prisma-migrate-check.sh](post/prisma-migrate-check.sh) | `Write` to `prisma/schema.prisma` | Reminds Claude to run `npm run db:migrate` and commit the migration. |

### UserPromptSubmit
| Script | Behaviour |
|---|---|
| [pre/inject-context.sh](pre/inject-context.sh) | Injects current branch, last 3 commits, `git status -s`, `prisma migrate status` summary, and any top-level `*.todo.md` filenames into the conversation as context for the new turn. Capped at 8 KB. Eliminates "what state is the repo in" round-trips. |

### Stop
| Script | Behaviour |
|---|---|
| [stop/definition-of-done.sh](stop/definition-of-done.sh) | Runs `npm run typecheck`, `npm run lint`, and `scripts/lint-status-badges.sh`. **Blocks Stop** with the failure summary if any are red, so Claude can't claim "done" on a broken state. Honours `stop_hook_active` to avoid loops. Skip with `CLAUDE_SKIP_DOD=1` or `CLAUDE_SKIP_HOOKS=definition-of-done`. |

### PreCompact
| Script | Behaviour |
|---|---|
| [pre-compact/transcript-backup.sh](pre-compact/transcript-backup.sh) | Copies the live transcript into `.claude/transcripts/<timestamp>-<sessionId>-<trigger>.jsonl` before Claude Code compacts it. Keeps the last 30 backups. Recovery aid for lost reasoning. |

### SessionStart
| Script | Behaviour |
|---|---|
| [session/on-start.sh](session/on-start.sh) | Prints the first unchecked item from the CLAUDE.md BUILD ORDER so every session opens with a clear focus. |
| [session/check-db-seed.sh](session/check-db-seed.sh) | Warns on stderr if the dev DB is reachable but has 0 users / 0 vehicles — prevents wasted turns diagnosing "why can't I log in" when the real answer is an empty DB. Silent when the DB is unreachable or populated. |

## Conventions

- **Exit codes**: `0` continue, `1` warn (visible but non-blocking), `2` block (PreToolUse only).
- **stdin**: every hook receives the tool-call payload as JSON. Parse with `jq` via the helpers in [lib/common.sh](lib/common.sh).
- **Side effects**: hooks are observers. The one exception is `lint-changed.sh` which only rewrites the file that was just edited (autofix).
- **Resilience**: hooks tolerate a missing git repo, missing `node_modules`, and empty payloads. A broken hook must never wedge the session.
- **Logging**: every run appends a line to [.log](.log) (gitignored) for post-hoc debugging.

## Disabling a hook temporarily

Set `CLAUDE_SKIP_HOOKS` in the session environment. It accepts a comma-separated list of hook names, or `all`:

```bash
CLAUDE_SKIP_HOOKS=typecheck-changed,lint-changed claude
CLAUDE_SKIP_HOOKS=all claude
```

Hook names are the filename without `.sh`, e.g. `protect-schema`, `typecheck-changed`.

## Adding a new hook

1. Drop a new `*.sh` into the right lifecycle directory (`pre/`, `post/`, `stop/`, `pre-compact/`, or `session/`).
2. Start with:
   ```bash
   #!/usr/bin/env bash
   set -euo pipefail
   source "$(dirname "$0")/../lib/common.sh"
   is_skipped "my-hook-name" && exit 0
   payload="$(read_stdin_json)"
   file_path="$(jq_field "$payload" '.tool_input.file_path')"
   # ... your logic ...
   ```
3. `chmod +x` the file.
4. Register it in [../settings.json](../settings.json).
5. Document it in the table above.

Keep each hook under ~200 LOC and fast (<2s typical). If a hook needs to be slow (e.g. a full test suite), move the heavy work behind an explicit command rather than a hook.
