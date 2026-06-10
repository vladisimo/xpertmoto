#!/usr/bin/env bash
# Stop: surface un-synced git work so changes don't silently pile up locally
# and force a later reconciliation. Feedback-only — exits 1 (visible warning)
# when there is uncommitted tracked work or unpushed commits, exits 0 when the
# tree is clean and in sync. NEVER blocks (that's exit 2, reserved for the
# definition-of-done gate); this only nudges.
#
# What it checks (read-only, no fetch, no writes):
#   - tracked files with uncommitted changes (staged or modified)
#   - commits on HEAD that aren't on any remote-tracking ref (unpushed)
#
# When it nudges, it points at the /ship skill which does commit -> push -> PR.
#
# Skip via CLAUDE_SKIP_HOOKS=git-sync-reminder for one-off cases.

set -euo pipefail
source "$(dirname "$0")/../lib/common.sh"

is_skipped "git-sync-reminder" && exit 0

# Resilience: never wedge a session over a missing repo.
in_git_repo || exit 0
cd "$PROJECT_ROOT"

# Detached HEAD or a fresh repo with no commits: nothing useful to say.
branch="$(git symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
[ -z "$branch" ] && exit 0
git rev-parse HEAD >/dev/null 2>&1 || exit 0

# Tracked, uncommitted changes (ignore untracked noise like *.lock scratch).
dirty="$(git status --porcelain --untracked-files=no 2>/dev/null | wc -l | tr -d ' ')"

# Commits reachable from HEAD but absent from every remote-tracking ref.
# Uses local refs only (no network) — may be slightly stale, which is fine
# for a reminder.
unpushed="$(git rev-list --count HEAD --not --remotes 2>/dev/null || echo 0)"

# All in sync: stay quiet.
if [ "$dirty" -eq 0 ] && [ "$unpushed" -eq 0 ]; then
  log INFO "git-sync-reminder: clean & in sync on $branch"
  exit 0
fi

{
  echo "git-sync reminder — work on '$branch' isn't fully in git yet:"
  [ "$dirty" -gt 0 ]    && echo "  • $dirty tracked file(s) with uncommitted changes"
  [ "$unpushed" -gt 0 ] && echo "  • $unpushed commit(s) not pushed to any remote"
  echo
  if [ "$branch" = "main" ] || [ "$branch" = "master" ]; then
    echo "  You're on $branch. Move this onto a feature branch before pushing"
    echo "  (direct pushes to $branch bypass PR review). Run /ship to do that."
  else
    echo "  Run /ship to commit, push '$branch', and open/update its PR."
  fi
  echo "  (reminder only — not blocking. Silence with CLAUDE_SKIP_HOOKS=git-sync-reminder)"
} >&2

log WARN "git-sync-reminder: $branch dirty=$dirty unpushed=$unpushed"
exit 1
