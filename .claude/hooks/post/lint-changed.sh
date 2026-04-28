#!/usr/bin/env bash
# PostToolUse: run eslint --fix on the single changed file when it is
# a TS/TSX/JS/JSX file under the project tree.

set -euo pipefail
source "$(dirname "$0")/../lib/common.sh"

is_skipped "lint-changed" && exit 0

payload="$(read_stdin_json)"
file_path="$(jq_field "$payload" '.tool_input.file_path')"

case "$file_path" in
  *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs) ;;
  *) exit 0 ;;
esac

[ -f "$file_path" ] || exit 0

cd "$PROJECT_ROOT"
if ! [ -x node_modules/.bin/eslint ]; then
  log INFO "lint-changed: eslint not installed, skipping"
  exit 0
fi

if output="$(node_modules/.bin/eslint --fix "$file_path" 2>&1)"; then
  [ -n "$output" ] && echo "$output" >&2
  log INFO "lint-changed: ok for $file_path"
  exit 0
fi

echo "--- eslint reported problems in $file_path ---" >&2
echo "$output" >&2
log WARN "lint-changed: issues in $file_path"
exit 1
