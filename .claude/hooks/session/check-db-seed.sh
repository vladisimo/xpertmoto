#!/usr/bin/env bash
# SessionStart: warn if the dev DB is reachable but empty, so Claude
# doesn't waste a turn diagnosing "why can't I log in" when the real
# answer is "the User table has 0 rows — reseed it". Non-blocking.

set -euo pipefail
source "$(dirname "$0")/../lib/common.sh"

is_skipped "check-db-seed" && exit 0

env_file="$PROJECT_ROOT/.env"
[ -f "$env_file" ] || exit 0

db_url="$(grep -E '^DATABASE_URL=' "$env_file" | head -1 | cut -d= -f2- | sed 's/^"\(.*\)"$/\1/' | sed "s/^'\(.*\)'$/\1/")"
[ -n "$db_url" ] || exit 0

# Parse postgres://user:pass@host:port/db — psql needs it as-is which works
# for libpq URIs. Short timeout so a down DB doesn't stall the session.
count_query='SELECT (SELECT COUNT(*) FROM "User") || ":" || (SELECT COUNT(*) FROM "Vehicle");'
result="$(PGCONNECT_TIMEOUT=2 psql "$db_url" -tA -c "$count_query" 2>/dev/null || true)"

if [ -z "$result" ]; then
  log INFO "check-db-seed: DB unreachable or schema missing, skipping"
  exit 0
fi

users="${result%%:*}"
vehicles="${result##*:}"

if [ "$users" = "0" ] && [ "$vehicles" = "0" ]; then
  echo "⚠️  DB is reachable but empty (0 users, 0 vehicles)." >&2
  echo "   Run 'npm run db:reset' to restore the snapshot," >&2
  echo "   or 'npm run db:seed:demo' for the small demo seed." >&2
  log WARN "check-db-seed: empty DB detected"
elif [ "$users" = "0" ]; then
  echo "⚠️  DB has vehicles but no users. Login will fail." >&2
  echo "   Run 'npm run db:reset' to restore the snapshot." >&2
  log WARN "check-db-seed: zero users ($vehicles vehicles)"
else
  log INFO "check-db-seed: ok ($users users, $vehicles vehicles)"
fi

exit 0
