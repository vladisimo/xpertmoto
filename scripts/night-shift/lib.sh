#!/usr/bin/env bash
# Shared helpers for the XPERT Moto night shift. Source after config.env.
# Defensive: nothing in here may crash the orchestrator.

: "${NIGHT:=/home/vlad/xpertmoto-night}"
: "${REPO:=/home/vlad/scootering}"
QUEUE="$NIGHT/queue"
RUNNING="$NIGHT/running"
DONE_LANE="$NIGHT/done"
FAILED_LANE="$NIGHT/failed"
SKIPPED_LANE="$NIGHT/skipped"
WORKTREES="$NIGHT/worktrees"
LOGS="$NIGHT/logs"
REPORTS="$NIGHT/reports"
BUNDLES="$NIGHT/bundles"
LOCKS="$NIGHT/locks"
STATE="$NIGHT/state"

_ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }
now_epoch() { date +%s; }

nlog() { printf '%s  %s\n' "$(_ts)" "$*" >> "$LOGS/night.log" 2>/dev/null || true; }

# Extract a scalar front-matter field (first match before the closing ---)
tfield() { # tfield <taskfile> <key>
  [ -f "$1" ] || { echo ""; return; }
  awk -v k="$2" '
    NR==1 && $0!~/^---/ {exit}
    f && /^---[[:space:]]*$/ {exit}
    /^---[[:space:]]*$/ {f=1; next}
    f && $0 ~ ("^" k ":") { sub("^" k ":[ \t]*", ""); print; exit }
  ' "$1" 2>/dev/null
}

task_id() { tfield "$1" id; }

count_lane() { ls -1 "$NIGHT/$1"/*.md 2>/dev/null | wc -l | tr -d ' '; }

# Locate a task file by id across lanes (first hit)
find_task_file() { # find_task_file <TASK-ID>
  local id="$1" d f
  for d in queue running done failed skipped; do
    for f in "$NIGHT/$d/"*"${id}"*.md; do
      [ -f "$f" ] && [ "$(task_id "$f")" = "$id" ] && { echo "$f"; return 0; }
    done
  done
  return 1
}

notify() { # notify <title> <message>
  local title="$1"; shift
  nlog "[notify] $title: $*"
  DISPLAY="${DISPLAY:-:0}" notify-send -u normal "XPERT night: $title" "$*" >/dev/null 2>&1 || true
  if [ -n "${NIGHT_NTFY_URL:-}" ]; then
    curl -fsS -m 10 -d "XPERT night — $title: $*" "$NIGHT_NTFY_URL" >/dev/null 2>&1 || true
  fi
}

# Rate-limit accounting (per calendar night)
record_ratelimit() {
  now_epoch > "$STATE/last-ratelimit"
  local f="$STATE/ratelimit-count-$(date +%Y%m%d)"
  echo $(( $(cat "$f" 2>/dev/null || echo 0) + 1 )) > "$f"
}
ratelimit_count() { cat "$STATE/ratelimit-count-$(date +%Y%m%d)" 2>/dev/null || echo 0; }

# Detect a rate-limit / auth error in a `claude -p --output-format json` result.
# Inspect ONLY the structured error fields — never grep the whole file: this
# repo contains rate-limit source code and 429 fixtures (false positives).
session_error_text() { # session_error_text <session.json>  -> error text or ""
  jq -r 'if (.is_error // false) then ((.result // "") + " " + (.subtype // "")) else "" end' \
    "$1" 2>/dev/null | head -c 2000
}
is_ratelimit_error() { # <session.json>
  session_error_text "$1" | grep -qiE 'usage limit|rate limit|overloaded|too many requests|429'
}
is_auth_error() { # <session.json>
  session_error_text "$1" | grep -qiE 'oauth|authentication|not logged in|api key|login'
}
