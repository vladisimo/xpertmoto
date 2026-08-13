#!/usr/bin/env bash
# PreToolUse: block edits to prisma/schema.prisma unless the turn
# explicitly references a migration or schema change.

set -euo pipefail
source "$(dirname "$0")/../lib/common.sh"

is_skipped "protect-schema" && exit 0

payload="$(read_stdin_json)"
file_path="$(jq_field "$payload" '.tool_input.file_path')"
transcript_path="$(jq_field "$payload" '.transcript_path')"

# Pull recent plain-text user turns from the transcript. PreToolUse payloads
# don't carry `user_prompt` directly, so we derive intent from the transcript.
# We join the last 5 user text turns so a confirmation turn like "proceed" can
# still inherit intent from the preceding turn that named the change.
user_prompt=""
if [ -n "$transcript_path" ] && [ -r "$transcript_path" ]; then
  # Transcript user turns carry .message.content either as a plain string or
  # as an array of typed blocks, depending on harness version. Accept both;
  # collapse each turn to one line so `tail -n 5` approximates "last 5 turns".
  user_prompt="$(
    jq -r 'select(.type == "user")
           | .message.content
           | if type == "string" then gsub("\n"; " ")
             elif type == "array" then (.[0] | select(.type? == "text") | .text | gsub("\n"; " "))
             else empty end' "$transcript_path" 2>/dev/null \
    | tail -n 5 | tr '\n' ' ' || true
  )"
fi

case "$file_path" in
  */prisma/schema.prisma)
    if printf '%s' "$user_prompt" | grep -Eiq 'migration|schema change|prisma schema'; then
      log INFO "protect-schema: allowed schema.prisma edit (intent matched)"
      exit 0
    fi
    echo "BLOCKED: prisma/schema.prisma edits require the user turn to mention 'migration' or 'schema change'." >&2
    echo "Unblock: ask the user to confirm the schema change, then include those words in the acknowledgement." >&2
    log WARN "protect-schema: blocked schema.prisma edit (no intent keyword)"
    exit 2
    ;;
esac

exit 0
