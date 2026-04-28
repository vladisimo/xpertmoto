#!/usr/bin/env bash
# Stop: enforce definition-of-done before Claude is allowed to stop.
# Runs typecheck + lint + lint-status-badges. Exits 2 if any are red,
# blocking Stop and giving Claude the failure summary so it has to fix
# before claiming completion.
#
# Skip via CLAUDE_SKIP_HOOKS=definition-of-done for one-off cases.
# Skip via CLAUDE_SKIP_DOD=1 environment variable for sustained debugging.
#
# Pattern source: https://claudelog.com/mechanics/hooks/

set -euo pipefail
source "$(dirname "$0")/../lib/common.sh"

is_skipped "definition-of-done" && exit 0
[ "${CLAUDE_SKIP_DOD:-}" = "1" ] && exit 0

payload="$(read_stdin_json)"
stop_hook_active="$(jq_field "$payload" '.stop_hook_active')"

# Avoid infinite loops: if we're already inside a Stop-hook-triggered
# continuation, just let Claude stop.
if [ "$stop_hook_active" = "true" ]; then
  log INFO "definition-of-done: stop_hook_active=true, allowing stop"
  exit 0
fi

cd "$PROJECT_ROOT"

# If no scripts/lint-status-badges.sh, skip that check (fail-open).
have_status_lint=0
[ -x scripts/lint-status-badges.sh ] && have_status_lint=1

failures=()

# 1. typecheck
if [ -x node_modules/.bin/tsc ]; then
  if ! npm run --silent typecheck >/tmp/dod-typecheck.log 2>&1; then
    failures+=("typecheck")
  fi
else
  log INFO "definition-of-done: tsc not installed, skipping typecheck"
fi

# 2. lint
if [ -x node_modules/.bin/eslint ]; then
  if ! npm run --silent lint >/tmp/dod-lint.log 2>&1; then
    failures+=("lint")
  fi
else
  log INFO "definition-of-done: eslint not installed, skipping lint"
fi

# 3. lint-status-badges (UI/UX contract)
if [ "$have_status_lint" = "1" ]; then
  if ! bash scripts/lint-status-badges.sh >/tmp/dod-status-badges.log 2>&1; then
    failures+=("lint-status-badges")
  fi
fi

if [ "${#failures[@]}" -eq 0 ]; then
  log INFO "definition-of-done: all green, allowing stop"
  exit 0
fi

{
  echo "BLOCKED by definition-of-done: cannot stop while these are red:"
  for f in "${failures[@]}"; do
    echo "  - $f (last 30 lines):"
    tail -n 30 "/tmp/dod-${f}.log" 2>/dev/null | sed 's/^/      /'
  done
  echo
  echo "Fix the failures above before stopping. To bypass for this session, set CLAUDE_SKIP_DOD=1 or CLAUDE_SKIP_HOOKS=definition-of-done."
} >&2

log WARN "definition-of-done: blocked stop on: ${failures[*]}"
exit 2
