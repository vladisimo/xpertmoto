#!/usr/bin/env bash
# night.sh — one night's orchestration: preflight → sequential task loop →
# morning report. Fired by xpertmoto-night.timer at 00:05 (or manually via
# `nightctl run`, which sets NIGHT_MANUAL=1 to relax the wall-clock cutoffs).
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
source "$HERE/config.env"
# shellcheck source=/dev/null
source "$HERE/lib.sh"

mkdir -p "$QUEUE" "$RUNNING" "$DONE_LANE" "$FAILED_LANE" "$SKIPPED_LANE" \
         "$WORKTREES" "$LOGS" "$REPORTS" "$BUNDLES" "$LOCKS" "$STATE"

exec 9>"$LOCKS/night.lock"
flock -n 9 || { echo "night.sh: another night run holds the lock"; exit 0; }

DATE=$(date +%Y%m%d)
START=$(now_epoch)
MANUAL="${NIGHT_MANUAL:-0}"
rm -f "$STATE/abort-night"

abort_night() { # <reason>
  nlog "NIGHT $DATE ABORTED: $1"
  {
    echo "# Night shift $DATE — ABORTED at preflight"
    echo
    echo "Reason: **$1**"
    echo
    echo "No tasks were attempted. The queue is untouched."
  } > "$REPORTS/night-$DATE.md"
  notify "night aborted" "$1"
  exit 0
}

WPID=""
on_term() {
  nlog "night.sh: TERM received — cutting off current worker"
  if [ -n "$WPID" ]; then
    kill -TERM -- "-$WPID" 2>/dev/null || true
    wait "$WPID" 2>/dev/null || true
  fi
  bash "$HERE/report.sh" "$DATE" >/dev/null 2>&1 || true
  exit 143
}
trap on_term TERM INT

# ── preflight ────────────────────────────────────────────────────────────────
[ -f "$NIGHT/STOP" ] && abort_night "STOP file present ($NIGHT/STOP — nightctl resume to clear)"

# Reconcile leftovers from a crashed/killed night.
shopt -s nullglob
for f in "$RUNNING"/*.md; do
  mv -f "$f" "$QUEUE/" 2>/dev/null && nlog "preflight: orphaned running task $(basename "$f") → queue"
done
for d in "$WORKTREES"/*/; do
  [ -d "$d" ] || continue
  id=$(basename "$d")
  if [ -e "$d/.git" ] && [ -n "$(git -C "$d" log origin/main..HEAD --oneline 2>/dev/null)" ]; then
    git -C "$d" bundle create "$BUNDLES/stale-${id}-${DATE}.bundle" origin/main..HEAD >/dev/null 2>&1 \
      && nlog "preflight: bundled stale worktree $id"
  fi
  git -C "$REPO" worktree remove --force "$d" >/dev/null 2>&1 || rm -rf "$d"
  nlog "preflight: removed stale worktree $id"
done
shopt -u nullglob
git -C "$REPO" worktree prune >/dev/null 2>&1 || true
for b in $(git -C "$REPO" branch --list 'night/*' --format='%(refname:short)' 2>/dev/null); do
  if ! git -C "$REPO" ls-remote --exit-code origin "$b" >/dev/null 2>&1; then
    git -C "$REPO" bundle create "$BUNDLES/branch-$(printf '%s' "$b" | tr '/' '_')-${DATE}.bundle" \
      "origin/main..$b" >/dev/null 2>&1 || true
  fi
  git -C "$REPO" branch -D "$b" >/dev/null 2>&1 && nlog "preflight: pruned local branch $b"
done

git -C "$REPO" fetch origin --prune >/dev/null 2>&1 || abort_night "git fetch failed (network/SSH?)"
[ -z "$(git -C "$REPO" status --porcelain 2>/dev/null)" ] \
  || abort_night "canonical working tree is dirty — never run the night over live WIP"

CI_STATE=$(timeout 30 gh run list --repo "$GITHUB_REPO" --branch main --limit 1 \
             --json conclusion -q '.[0].conclusion' 2>/dev/null || echo unknown)
case "$CI_STATE" in
  failure) abort_night "latest main CI run is RED — fix main first" ;;
  success) nlog "preflight: main CI green" ;;
  *)       nlog "preflight: main CI status '$CI_STATE' (PAT may lack actions:read) — proceeding" ;;
esac

AVAIL_GB=$(df --output=avail -BG /home 2>/dev/null | tail -1 | tr -dc '0-9')
[ "${AVAIL_GB:-0}" -ge "$MIN_DISK_GB" ] || abort_night "disk low: ${AVAIL_GB:-?}G free < ${MIN_DISK_GB}G"
[ -d "$REPO/node_modules" ] || abort_night "canonical node_modules missing"
command -v claude >/dev/null 2>&1 || abort_night "claude CLI not on PATH"
git -C "$REPO" ls-remote -q origin HEAD >/dev/null 2>&1 || abort_night "cannot reach origin over SSH"
docker inspect -f '{{.State.Running}}' xpertmoto-pg 2>/dev/null | grep -q true \
  || nlog "preflight: WARNING dev-DB container xpertmoto-pg not running"

if grep -lE '^e2e:[[:space:]]*(smoke|critical)' "$QUEUE"/*.md >/dev/null 2>&1; then
  pg_isready -h localhost -p 5432 >/dev/null 2>&1 || abort_night "e2e task queued but host PG :5432 down"
  redis-cli -p 6380 ping >/dev/null 2>&1 || abort_night "e2e task queued but Redis :6380 down"
  docker inspect -f '{{.State.Running}}' xpertmoto-e2e-mailpit 2>/dev/null | grep -q true \
    || abort_night "e2e task queued but Mailpit container down"
fi

# Window cutoffs. Timer-launched: absolute wall clock (00:05 start → same-day
# 03:30/04:45). Manual daytime runs: relative to start instead.
if [ "$MANUAL" = 1 ]; then
  LAST_PICK=$(( START + 12600 ))
  DEADLINE=$(( START + 16800 ))
else
  LAST_PICK=$(date -d "today $LAST_TASK_START" +%s)
  DEADLINE=$(date -d "today $SOFT_DEADLINE" +%s)
fi

nlog "NIGHT $DATE START (manual=$MANUAL) queue=$(count_lane queue) base=$(git -C "$REPO" rev-parse --short origin/main)"

# ── sequential task loop ─────────────────────────────────────────────────────
count=0
while [ "$count" -lt "$NIGHT_MAX_TASKS" ]; do
  [ -f "$NIGHT/STOP" ] && { nlog "STOP file — ending night early"; break; }
  [ -f "$STATE/abort-night" ] && { nlog "abort-night signal: $(cat "$STATE/abort-night")"; break; }
  now=$(now_epoch)
  [ "$now" -ge "$LAST_PICK" ] && { nlog "past last-task-start — no new tasks"; break; }
  [ $(( DEADLINE - now )) -lt "$MIN_TASK_BUDGET_SECONDS" ] && { nlog "window too small for another task"; break; }
  [ "$(ratelimit_count)" -ge "$RATELIMIT_NIGHT_LIMIT" ] && { nlog "rate-limit budget exhausted — stopping"; break; }

  task=$(ls -1 "$QUEUE"/*.md 2>/dev/null | sort | head -1 || true)
  [ -z "${task:-}" ] && { nlog "queue empty"; break; }
  dest="$RUNNING/$(basename "$task")"
  mv -f "$task" "$dest"

  setsid bash "$HERE/worker.sh" "$dest" >>"$LOGS/night.log" 2>&1 &
  WPID=$!
  wait "$WPID"
  rc=$?
  WPID=""
  count=$(( count + 1 ))
  nlog "task $(basename "$dest" .md) finished rc=$rc ($count/$NIGHT_MAX_TASKS)"
done

bash "$HERE/report.sh" "$DATE" || nlog "report.sh failed"
nlog "NIGHT $DATE COMPLETE: done=$(count_lane done) failed=$(count_lane failed) queued=$(count_lane queue)"
exit 0
