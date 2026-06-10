#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────
# Phase C runbook — executes the full timeboxed load suite unattended.
# Designed to run inside the off-peak window; total wall-clock ≈ 45–55 min.
#
#   scripts/load/run-all.sh            # full suite
#   SCALE=0.1 scripts/load/run-all.sh  # quick rehearsal (durations ×0.1)
#
# Each slot is captured by instrument.sh into loadtest-results/<ts>_<name>/.
# Back-office load runs concurrently during target/soak (its load shows up in
# the captured container stats). Operates ONLY on the isolated xpltest stack.
# ─────────────────────────────────────────────────────────────────────────
set -uo pipefail
cd "$(dirname "$0")/../.."
export BASE_URL="${BASE_URL:-http://localhost:3009}"
SCALE="${SCALE:-1}"
I="scripts/load/instrument.sh"

# duration helper: scale minutes/seconds for rehearsals
secs() { awk -v s="$1" -v k="$SCALE" 'BEGIN{printf "%d", (s*k<5?5:s*k)}'; }
dur()  { echo "$(secs "$1")s"; }

bo_bg() { # start detached back-office load for $1 seconds at rate $2
  docker rm -f xpltest-bo >/dev/null 2>&1
  docker run -d --name xpltest-bo --network host -v "$PWD/scripts/load:/scripts" \
    -e "BASE_URL=$BASE_URL" -e "RATE=${2:-0.4}" -e "DURATION=$(dur "$1")" \
    grafana/k6 run /scripts/backoffice.js >/dev/null 2>&1
}
bo_stop() { docker rm -f xpltest-bo >/dev/null 2>&1; }

echo "############ Phase C load suite — $(date) — SCALE=$SCALE ############"
docker update --cpus 1.0 xpltest-app-1 >/dev/null 2>&1   # ensure baseline cap

# 1. BASELINE — light single-stream latency floor
$I baseline funnel.js "RATE=1" "DURATION=$(dur 90)" "CREATE_PCT=3" "PREALLOC=5"

# 2. TARGET — funnel + back-office concurrently (the costing run)
bo_bg 480 0.4
$I target funnel.js "RATE=5" "DURATION=$(dur 480)" "CREATE_PCT=3"
bo_stop

# 3. BREAKING POINT — read-path ramp (quote, no external calls)
$I breakpoint-quote booking-surge.js "MODE=quote" "MAX_RATE=400" "STAGE=$(dur 60)"

# 4. BREAKING POINT — write-path ramp (authenticated create, Stripe stub)
$I breakpoint-create booking-surge.js "MODE=create" "MAX_RATE=60" "STAGE=$(dur 45)"

# 5. RESOURCE SWEEP — re-run target at a tighter app cap (0.5 vCPU) to bracket
#    the minimum viable instance. docker update changes the limit live.
docker update --cpus 0.5 xpltest-app-1 >/dev/null 2>&1
$I sweep-app-0.5cpu funnel.js "RATE=5" "DURATION=$(dur 240)" "CREATE_PCT=3"
docker update --cpus 1.0 xpltest-app-1 >/dev/null 2>&1

# 6. SOAK — sustained target to surface leaks / pool exhaustion / job backlog
bo_bg 1200 0.4
$I soak funnel.js "RATE=4" "DURATION=$(dur 1200)" "CREATE_PCT=3"
bo_stop

# 7. CHAOS / reliability — safe container-level fault injection
echo "### chaos: worker-down (web must stay up; jobs queue in Redis) ###"
docker stop xpltest-worker-1 >/dev/null 2>&1
$I chaos-worker-down funnel.js "RATE=3" "DURATION=$(dur 120)" "CREATE_PCT=5"
docker start xpltest-worker-1 >/dev/null 2>&1

echo "### chaos: postgres-pause (expect health 503 + graceful errors, then recovery) ###"
( sleep "$(secs 30)"; echo "  pausing postgres…"; docker pause xpltest-postgres-1; \
  sleep "$(secs 20)"; echo "  unpausing postgres…"; docker unpause xpltest-postgres-1 ) &
CHAOS=$!
$I chaos-db-pause funnel.js "RATE=3" "DURATION=$(dur 90)" "CREATE_PCT=3"
wait "$CHAOS" 2>/dev/null
docker unpause xpltest-postgres-1 >/dev/null 2>&1  # safety

# verification: duplicate-payment invariant after all the create load
export PGPASSWORD=postgres
echo "### invariant: duplicate Payment rows per booking (should be empty) ###"
psql -h localhost -p 55432 -U postgres -d xpertmoto -c \
  "SELECT \"bookingId\", count(*) FROM \"Payment\" WHERE \"bookingId\" IS NOT NULL GROUP BY \"bookingId\" HAVING count(*) > 3 ORDER BY 2 DESC LIMIT 10;" \
  | tee "loadtest-results/duplicate-payment-check.txt"

echo "############ Phase C complete — $(date) ############"
echo "Results under loadtest-results/ :"
ls -1dt loadtest-results/*/ | head -12
