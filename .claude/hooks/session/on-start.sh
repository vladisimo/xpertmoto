#!/usr/bin/env bash
# SessionStart: surface the current focus by finding the first
# unchecked item in CLAUDE.md's BUILD ORDER.

set -euo pipefail
source "$(dirname "$0")/../lib/common.sh"

is_skipped "on-start" && exit 0

claude_md="$PROJECT_ROOT/CLAUDE.md"
[ -f "$claude_md" ] || exit 0

first_unchecked="$(awk '
  /^## BUILD ORDER/ { in_section=1; next }
  in_section && /^## / { exit }
  in_section && /^- \[ \]/ { print; exit }
' "$claude_md")"

if [ -n "$first_unchecked" ]; then
  echo "Current XPERT Moto build focus (from CLAUDE.md BUILD ORDER):" >&2
  echo "  $first_unchecked" >&2
  log INFO "on-start: surfaced focus: $first_unchecked"
fi

exit 0
