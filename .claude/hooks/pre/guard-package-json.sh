#!/usr/bin/env bash
# PreToolUse: when package.json is about to be edited, surface which
# dependencies are being added vs the committed state. Non-blocking.

set -euo pipefail
source "$(dirname "$0")/../lib/common.sh"

is_skipped "guard-package-json" && exit 0

payload="$(read_stdin_json)"
file_path="$(jq_field "$payload" '.tool_input.file_path')"

case "$file_path" in
  */package.json) ;;
  *) exit 0 ;;
esac

if ! in_git_repo; then
  echo "NOTE: package.json is being modified. (Repo is not git-initialised — cannot diff against HEAD.)" >&2
  log INFO "guard-package-json: no git repo, skipped diff"
  exit 0
fi

new_text="$(jq_field "$payload" '.tool_input.content')"
if [ -z "$new_text" ]; then
  echo "NOTE: package.json is being edited. Confirm the dep change is in scope before proceeding." >&2
  exit 0
fi

old_deps="$(git -C "$PROJECT_ROOT" show HEAD:package.json 2>/dev/null \
  | jq -r '(.dependencies // {}) * (.devDependencies // {}) | keys[]' 2>/dev/null || true)"
new_deps="$(printf '%s' "$new_text" \
  | jq -r '(.dependencies // {}) * (.devDependencies // {}) | keys[]' 2>/dev/null || true)"

added="$(comm -13 <(printf '%s\n' "$old_deps" | sort -u) <(printf '%s\n' "$new_deps" | sort -u))"
removed="$(comm -23 <(printf '%s\n' "$old_deps" | sort -u) <(printf '%s\n' "$new_deps" | sort -u))"

if [ -n "$added" ] || [ -n "$removed" ]; then
  echo "NOTE: package.json dependency changes detected:" >&2
  [ -n "$added" ] && echo "  + adding: $(printf '%s' "$added" | tr '\n' ' ')" >&2
  [ -n "$removed" ] && echo "  - removing: $(printf '%s' "$removed" | tr '\n' ' ')" >&2
  echo "Confirm each addition is covered by the approved plan or an explicit user request." >&2
  log INFO "guard-package-json: added='$added' removed='$removed'"
fi

exit 0
