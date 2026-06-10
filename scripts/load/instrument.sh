#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────
# Instrumentation wrapper for a single load-test run.
#
#   scripts/load/instrument.sh <run-name> <k6-script.js> [extra k6 env: K=V ...]
#
# Around the run it captures, into loadtest-results/<ts>_<run-name>/:
#   - k6 stdout + machine-readable summary (k6-summary.json)
#   - per-container CPU/MEM samples at 1s (docker-stats.csv)
#   - pg_stat_statements top queries before/after (reset → run → dump)
#   - redis INFO (memory + ops), postgres connection count
#   - Booking row-count delta + container resource limits (caps under test)
#
# k6 is run via the grafana/k6 docker image with --network host so it reaches
# the app on localhost:3009 (no local k6 install needed).
#
# Targets the ISOLATED xpltest stack only (pg :55432, redis :55379, app :3009).
# ─────────────────────────────────────────────────────────────────────────
set -uo pipefail

RUN_NAME="${1:?usage: instrument.sh <run-name> <k6-script> [K=V ...]}"
K6_SCRIPT="${2:?missing k6 script}"
shift 2

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TS="$(date +%Y%m%d-%H%M%S)"
OUT="$ROOT/loadtest-results/${TS}_${RUN_NAME}"
mkdir -p "$OUT"

PGH=localhost; PGP=55432; PGU=postgres; PGDB=xpertmoto
export PGPASSWORD=postgres
PSQL="psql -h $PGH -p $PGP -U $PGU -d $PGDB -t -A"
BASE_URL="${BASE_URL:-http://localhost:3009}"

# k6 env passthrough: collect K=V args into -e flags
K6ENV=(-e "BASE_URL=$BASE_URL")
for kv in "$@"; do K6ENV+=(-e "$kv"); done

echo "=== run: $RUN_NAME  ->  $OUT"
echo "    script=$K6_SCRIPT  base=$BASE_URL  extra=[$*]"

# --- capture the caps under test ---
{
  echo "# container resource limits (the sizing knobs under test)";
  for c in xpltest-app-1 xpltest-postgres-1 xpltest-redis-1 xpltest-worker-1; do
    lim=$(docker inspect -f '{{.Name}} NanoCpus={{.HostConfig.NanoCpus}} Mem={{.HostConfig.Memory}}' "$c" 2>/dev/null)
    echo "$lim"
  done
} > "$OUT/caps.txt"

# --- pre: reset pg_stat_statements + booking count ---
$PSQL -c "SELECT pg_stat_statements_reset();" >/dev/null 2>&1
BOOK_BEFORE=$($PSQL -c "SELECT count(*) FROM \"Booking\";" 2>/dev/null)
echo "booking_before=$BOOK_BEFORE" > "$OUT/row-deltas.txt"

# --- docker stats sampler (background) ---
STATS="$OUT/docker-stats.csv"
echo "ts,container,cpu_pct,mem_used,mem_pct" > "$STATS"
(
  while true; do
    now=$(date +%s)
    docker stats --no-stream --format '{{.Name}},{{.CPUPerc}},{{.MemUsage}},{{.MemPerc}}' \
      xpltest-app-1 xpltest-postgres-1 xpltest-redis-1 xpltest-worker-1 2>/dev/null \
      | while IFS=, read -r name cpu memu memp; do
          echo "$now,$name,${cpu//\%/},${memu// /},${memp//\%/}" >> "$STATS"
        done
    sleep 1
  done
) &
SAMPLER=$!

# --- run k6 (containerised) ---
docker run --rm --network host \
  -v "$ROOT/scripts/load:/scripts" \
  "${K6ENV[@]}" \
  grafana/k6 run --summary-export "/scripts/.summary.tmp.json" "/scripts/$(basename "$K6_SCRIPT")" \
  2>&1 | tee "$OUT/k6.log"

# k6 wrote summary into the mounted dir; move it into the run folder
[ -f "$ROOT/scripts/load/.summary.tmp.json" ] && mv "$ROOT/scripts/load/.summary.tmp.json" "$OUT/k6-summary.json"

# --- stop sampler ---
kill "$SAMPLER" 2>/dev/null; wait "$SAMPLER" 2>/dev/null

# --- post: pg_stat_statements top queries ---
{
  echo "## top 25 by total_exec_time";
  $PSQL -c "SELECT round(total_exec_time::numeric,1) AS tot_ms, calls, round(mean_exec_time::numeric,2) AS mean_ms, round((100*total_exec_time/sum(total_exec_time) over ())::numeric,1) AS pct, left(regexp_replace(query,'\s+',' ','g'),140) AS q FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 25;"
  echo; echo "## top 15 by mean_exec_time (calls>5)";
  $PSQL -c "SELECT round(mean_exec_time::numeric,2) AS mean_ms, calls, left(regexp_replace(query,'\s+',' ','g'),140) AS q FROM pg_stat_statements WHERE calls>5 ORDER BY mean_exec_time DESC LIMIT 15;"
} > "$OUT/pg_stat_statements.txt" 2>&1

# --- post: redis + pg connections + row delta ---
docker exec xpltest-redis-1 redis-cli INFO 2>/dev/null | grep -E "used_memory_human:|used_memory_peak_human:|instantaneous_ops_per_sec:|connected_clients:|total_commands_processed:" > "$OUT/redis_info.txt"
$PSQL -c "SELECT state, count(*) FROM pg_stat_activity GROUP BY state;" > "$OUT/pg_connections.txt" 2>&1
BOOK_AFTER=$($PSQL -c "SELECT count(*) FROM \"Booking\";" 2>/dev/null)
echo "booking_after=$BOOK_AFTER" >> "$OUT/row-deltas.txt"
echo "booking_created=$((BOOK_AFTER - BOOK_BEFORE))" >> "$OUT/row-deltas.txt"

# --- post: peak CPU/mem per container from samples ---
{
  echo "# peak/avg CPU% and peak MEM per container (from docker-stats.csv)";
  for c in xpltest-app-1 xpltest-postgres-1 xpltest-redis-1 xpltest-worker-1; do
    awk -F, -v C="$c" 'NR>1 && $2==C {n++; cs+=$3; if($3>cmax)cmax=$3; if($5>mmax)mmax=$5}
      END{ if(n>0) printf "%-22s cpu_avg=%.1f%% cpu_peak=%.1f%% mem_peak=%.1f%%\n", C, cs/n, cmax, mmax }' "$STATS"
  done
} > "$OUT/utilisation.txt"

echo "=== done: $OUT"
cat "$OUT/utilisation.txt"
echo "--- booking delta ---"; cat "$OUT/row-deltas.txt"
