#!/usr/bin/env bash
# PreToolUse: remind Claude that CLAUDE.md is authoritative and
# edits must be user-requested. Non-blocking.

set -euo pipefail
source "$(dirname "$0")/../lib/common.sh"

is_skipped "guard-claude-md" && exit 0

payload="$(read_stdin_json)"
file_path="$(jq_field "$payload" '.tool_input.file_path')"

case "$file_path" in
  */CLAUDE.md)
    echo "NOTE: CLAUDE.md is authoritative project guidance." >&2
    echo "Only edit it when the user has explicitly requested a change to project rules, stack, or process." >&2
    echo "If unsure, ask the user first." >&2
    log INFO "guard-claude-md: CLAUDE.md edit attempted"
    ;;
esac

exit 0
