#!/usr/bin/env bash
# UserPromptSubmit: inject lightweight repo state into stdout so Claude
# starts every turn with current git/prisma context. Cap output at 8k chars.
#
# Output goes into the conversation as additional context for this turn.
#
# Pattern source: https://www.eesel.ai/blog/hooks-in-claude-code

set -euo pipefail
source "$(dirname "$0")/../lib/common.sh"

is_skipped "inject-context" && exit 0

cd "$PROJECT_ROOT"

# Only run inside a git repo (the tree might be in a non-git working dir).
in_git_repo || exit 0

out=""

branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
out+="## Repo state (auto-injected)
"
out+="branch: ${branch}
"

# Last 3 commits, oneline
recent="$(git log -3 --oneline 2>/dev/null || true)"
if [ -n "$recent" ]; then
  out+="recent commits:
${recent}
"
fi

# Working tree changes (short-form). Cap to first 30 lines.
status="$(git status -s 2>/dev/null | head -n 30 || true)"
if [ -n "$status" ]; then
  out+="working tree:
${status}
"
else
  out+="working tree: clean
"
fi

# Prisma migrate status — quick check, time out hard so a stuck DB
# doesn't wedge the prompt. Suppress noisy output.
if [ -x node_modules/.bin/prisma ]; then
  pmstatus="$(timeout 4s node_modules/.bin/prisma migrate status 2>/dev/null \
              | grep -Ei '(database schema is|following migration|drift|diverged)' \
              | head -n 5 || true)"
  if [ -n "$pmstatus" ]; then
    out+="prisma migrate: ${pmstatus}
"
  fi
fi

# Top-level *.todo.md files
todos="$(find . -maxdepth 1 -name '*.todo.md' -printf '%f\n' 2>/dev/null | head -n 5 || true)"
if [ -n "$todos" ]; then
  out+="todo files at repo root: $(echo "$todos" | tr '\n' ' ')
"
fi

# Cap to 8k chars to protect context budget
out_capped="$(printf '%s' "$out" | head -c 8192)"

printf '%s\n' "$out_capped"
log INFO "inject-context: emitted $(printf '%s' "$out_capped" | wc -c) chars"
exit 0
