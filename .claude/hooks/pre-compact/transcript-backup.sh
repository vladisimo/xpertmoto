#!/usr/bin/env bash
# PreCompact: copy the current transcript into .claude/transcripts/ before
# Claude Code compacts it, so the unsummarised reasoning is recoverable.
#
# Pattern source: https://github.com/disler/claude-code-hooks-mastery

set -euo pipefail
source "$(dirname "$0")/../lib/common.sh"

is_skipped "transcript-backup" && exit 0

payload="$(read_stdin_json)"
transcript_path="$(jq_field "$payload" '.transcript_path')"
session_id="$(jq_field "$payload" '.session_id')"
trigger="$(jq_field "$payload" '.trigger')"

if [ -z "$transcript_path" ] || ! [ -r "$transcript_path" ]; then
  log INFO "transcript-backup: no readable transcript_path, skipping"
  exit 0
fi

backup_dir="$PROJECT_ROOT/.claude/transcripts"
mkdir -p "$backup_dir"

ts="$(date -u +%Y%m%dT%H%M%SZ)"
sid="${session_id:-unknown}"
trg="${trigger:-manual}"
out="$backup_dir/${ts}-${sid}-${trg}.jsonl"

cp -f "$transcript_path" "$out"
log INFO "transcript-backup: wrote $out"

# Best-effort retention: keep last 30 backups.
ls -1t "$backup_dir"/*.jsonl 2>/dev/null | tail -n +31 | xargs -r rm -f
exit 0