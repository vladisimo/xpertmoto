#!/usr/bin/env bash
# night-dod.sh <worktree> [verify-spec]
# Explicit end-of-task Definition-of-Done gate for night tasks. Mirrors the
# repo Stop hook (typecheck + lint + lint-status-badges) and adds the FULL
# vitest run — cross-module regressions are exactly what would otherwise
# bounce back from cloud CI the next morning. `+build` in the verify-spec
# appends `next build` (default off: CI covers it). e2e is run by worker.sh,
# not here, because it needs the singleton-stack lock.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
source "$HERE/config.env" 2>/dev/null || true

WT="$1"; SPEC="${2:-default}"
cd "$WT" || { echo "night-dod: bad worktree $1"; exit 1; }

step() { # step <name> <timeout-secs> <cmd...>
  local name="$1" to="$2"; shift 2
  local t0; t0=$(date +%s)
  echo "=== DoD: $name (timeout ${to}s) ==="
  timeout -k 30 "$to" "$@"
  local rc=$?
  local dt=$(( $(date +%s) - t0 ))
  if [ "$rc" -eq 0 ]; then
    echo "=== DoD: $name OK (${dt}s) ==="
  elif [ "$rc" -eq 124 ]; then
    echo "=== DoD: $name TIMED OUT after ${to}s ==="
    exit 1
  else
    echo "=== DoD: $name FAILED rc=$rc (${dt}s) ==="
    exit 1
  fi
}

step typecheck "${DOD_TSC_TIMEOUT:-420}"   npm run typecheck
step lint      "${DOD_LINT_TIMEOUT:-420}"  npm run lint
if [ -x scripts/lint-status-badges.sh ]; then
  step status-badges 120 bash scripts/lint-status-badges.sh
fi
step vitest    "${DOD_VITEST_TIMEOUT:-1200}" npm run test
case "$SPEC" in
  *build*) step build "${DOD_BUILD_TIMEOUT:-1500}" npm run build ;;
esac
echo "=== DoD: ALL GREEN ==="
exit 0
