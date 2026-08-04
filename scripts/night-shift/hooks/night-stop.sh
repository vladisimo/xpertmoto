#!/usr/bin/env bash
# Stop hook for night sessions: bounded ONE-cycle typecheck nudge.
# If typecheck fails the first time the session tries to stop, block once so it
# self-corrects; never loops (stop_hook_active + per-session marker). Lint and
# vitest belong to the explicit night-dod.sh gate, not to every Stop.
# 300s timeout: this repo's project-wide tsc (~1100 files) can exceed the 150s
# the onlyplans variant used; a `timeout` exit 124 must not masquerade as red.
set -uo pipefail
[ "${NIGHT_READONLY:-0}" = "1" ] && exit 0   # critic sessions: nothing to gate
input=$(cat 2>/dev/null) || exit 0
active=$(printf '%s' "$input" | jq -r '.stop_hook_active // false' 2>/dev/null)
[ "$active" = "true" ] && exit 0
sid=$(printf '%s' "$input" | jq -r '.session_id // "nosid"' 2>/dev/null)
cwd=$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null)
[ -n "$cwd" ] && cd "$cwd" 2>/dev/null || exit 0

marker="/tmp/xpertmoto-nightstop-${sid}"
[ -f "$marker" ] && exit 0
[ -f package.json ] || exit 0
jq -e '.scripts.typecheck // empty' package.json >/dev/null 2>&1 || exit 0
[ -d node_modules ] || exit 0   # never trigger installs from a hook

if ! timeout 300 npm run typecheck >"/tmp/xpertmoto-nighttc-${sid}.log" 2>&1; then
  : > "$marker"
  printf '%s' '{"decision":"block","reason":"Typecheck is failing — run `npm run typecheck`, fix every TypeScript error, then finish. This is your one automatic correction cycle."}'
fi
exit 0
