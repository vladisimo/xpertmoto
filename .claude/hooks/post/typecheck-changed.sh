#!/usr/bin/env bash
# PostToolUse: run tsc --noEmit on the project when a TS/TSX file
# was edited. Debounced to one run per DEBOUNCE_SECONDS to survive
# rapid-fire edits.

set -euo pipefail
source "$(dirname "$0")/../lib/common.sh"

is_skipped "typecheck-changed" && exit 0

payload="$(read_stdin_json)"
file_path="$(jq_field "$payload" '.tool_input.file_path')"

case "$file_path" in
  *.ts|*.tsx) ;;
  *) exit 0 ;;
esac

DEBOUNCE_SECONDS="${DEBOUNCE_SECONDS:-30}"
STAMP_FILE="$PROJECT_ROOT/.claude/hooks/.typecheck.stamp"
now=$(date +%s)
if [ -f "$STAMP_FILE" ]; then
  last=$(cat "$STAMP_FILE" 2>/dev/null || echo 0)
  if [ $((now - last)) -lt "$DEBOUNCE_SECONDS" ]; then
    log INFO "typecheck-changed: debounced"
    exit 0
  fi
fi
printf '%s' "$now" > "$STAMP_FILE"

cd "$PROJECT_ROOT"
if ! [ -x node_modules/.bin/tsc ]; then
  log INFO "typecheck-changed: tsc not installed, skipping"
  exit 0
fi

if node_modules/.bin/tsc --noEmit -p tsconfig.json 2>&1 | tee /tmp/.xpertmoto-tsc.$$ >&2; then
  rm -f /tmp/.xpertmoto-tsc.$$
  log INFO "typecheck-changed: clean"
  exit 0
fi
rm -f /tmp/.xpertmoto-tsc.$$
echo "--- typecheck failed (see errors above) ---" >&2
log WARN "typecheck-changed: errors"
exit 1
