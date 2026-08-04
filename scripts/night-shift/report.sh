#!/usr/bin/env bash
# report.sh [YYYYMMDD] — render the morning report from per-task result JSON
# (written by worker.sh into state/results-<date>/) + notify.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
source "$HERE/config.env"
# shellcheck source=/dev/null
source "$HERE/lib.sh"

DATE="${1:-$(date +%Y%m%d)}"
RD="$STATE/results-$DATE"
OUT="$REPORTS/night-$DATE.md"

{
  echo "# Night shift — $DATE"
  echo
  echo "_Generated $(_ts) · base \`$(git -C "$REPO" rev-parse --short origin/main 2>/dev/null || echo '?')\` (origin/main)_"
  echo
  if ! ls "$RD"/*.json >/dev/null 2>&1; then
    echo "No tasks ran this night."
  else
    echo "| task | outcome | critic | ship | diff | wall | att |"
    echo "|---|---|---|---|---|---|---|"
    for j in "$RD"/*.json; do
      id=$(jq -r '.id' "$j")
      title=$(jq -r '.title' "$j" | cut -c1-45)
      lane=$(jq -r '.lane' "$j")
      verdict=$(jq -r '.verdict // "—"' "$j"); [ -z "$verdict" ] && verdict="—"
      pr=$(jq -r '.pr_url // ""' "$j")
      compare=$(jq -r '.compare_url // ""' "$j")
      pushed=$(jq -r '.pushed // "no"' "$j")
      diff=$(jq -r '.diffstat // ""' "$j")
      wall=$(jq -r '.wall_seconds // 0' "$j")
      att=$(jq -r '.attempts // 1' "$j")
      if [ -n "$pr" ]; then ship="[PR]($pr)"
      elif [ "$pushed" = "yes" ]; then ship="[compare]($compare) ⚠ no PR → no cloud CI"
      else ship="not pushed"
      fi
      echo "| **$id** $title | $lane | $verdict | $ship | $diff | $(( wall / 60 ))m | $att |"
    done
    echo
    for j in "$RD"/*.json; do
      id=$(jq -r '.id' "$j")
      fail=$(jq -r '.fail_reason // ""' "$j")
      vsum=$(jq -r '.verdict_summary // ""' "$j")
      nfind=$(jq -r '.findings | length' "$j")
      if [ -n "$fail" ]; then
        echo "### $id — failed"
        echo
        echo "- $fail"
        if [ -f "$LOGS/$id.dod.log" ] && grep -q 'FAILED\|TIMED OUT' "$LOGS/$id.dod.log" 2>/dev/null; then
          echo
          echo '```'
          tail -20 "$LOGS/$id.dod.log"
          echo '```'
        fi
        echo
      fi
      if [ "$nfind" -gt 0 ]; then
        echo "### $id — critic findings ($(jq -r '.verdict' "$j")${vsum:+ — $vsum})"
        echo
        jq -r '.findings[] | "- " + .' "$j"
        echo
      fi
    done
  fi
  echo "## Lanes"
  echo
  echo "queue: $(count_lane queue) · done: $(count_lane done) · failed: $(count_lane failed) · skipped: $(count_lane skipped)"
  rl=$(cat "$STATE/ratelimit-count-$DATE" 2>/dev/null || echo 0)
  [ "$rl" -gt 0 ] && { echo; echo "⚠ rate-limit events this night: $rl"; }
  if ls "$BUNDLES"/*-"$DATE".bundle >/dev/null 2>&1; then
    echo
    echo "Unshipped work preserved as git bundles:"
    ls -1 "$BUNDLES"/*-"$DATE".bundle | sed 's/^/- /'
  fi
  echo
  echo "## Night log"
  echo
  echo '```'
  tail -40 "$LOGS/night.log" 2>/dev/null || true
  echo '```'
} > "$OUT"

DONE_N=0; FAILED_N=0
if ls "$RD"/*.json >/dev/null 2>&1; then
  DONE_N=$(jq -rs '[.[] | select(.lane=="done")] | length' "$RD"/*.json 2>/dev/null || echo 0)
  FAILED_N=$(jq -rs '[.[] | select(.lane=="failed")] | length' "$RD"/*.json 2>/dev/null || echo 0)
fi
notify "night $DATE" "shipped:$DONE_N failed:$FAILED_N still-queued:$(count_lane queue) — $OUT"
echo "$OUT"
