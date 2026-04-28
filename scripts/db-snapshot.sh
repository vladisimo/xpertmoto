#!/usr/bin/env bash
# Capture the current database contents as the reseed baseline.
# Overwrites prisma/seed-snapshot.sql. Run this whenever you want to
# re-baseline what `db:reset` restores to.
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  if [[ -f .env ]]; then
    # Don't `source` .env — unquoted values with spaces (e.g.
    # `FOO=Some Title`) would be parsed as shell commands, and `$!` / `!!`
    # in passwords trips `set -u` / history expansion. We only need
    # DATABASE_URL; pick just that line and strip optional quotes.
    line=$(grep -E '^DATABASE_URL=' .env | tail -n 1 || true)
    if [[ -n "$line" ]]; then
      DATABASE_URL="${line#DATABASE_URL=}"
      # Strip surrounding single or double quotes if present.
      DATABASE_URL="${DATABASE_URL%\"}"
      DATABASE_URL="${DATABASE_URL#\"}"
      DATABASE_URL="${DATABASE_URL%\'}"
      DATABASE_URL="${DATABASE_URL#\'}"
      export DATABASE_URL
    fi
  fi
fi

: "${DATABASE_URL:?DATABASE_URL is not set}"

# Parse postgresql://user:pass@host:port/db
proto_removed="${DATABASE_URL#*://}"
creds="${proto_removed%@*}"
hostpart="${proto_removed#*@}"
PGUSER="${creds%%:*}"
PGPASSWORD="${creds#*:}"
HOSTPORT="${hostpart%%/*}"
PGDATABASE="${hostpart#*/}"
PGDATABASE="${PGDATABASE%%\?*}"
PGHOST="${HOSTPORT%%:*}"
PGPORT="${HOSTPORT#*:}"
[[ "$PGPORT" == "$HOSTPORT" ]] && PGPORT=5432

export PGPASSWORD

OUT="prisma/seed-snapshot.sql"
echo "📸 Snapshotting $PGDATABASE@$PGHOST:$PGPORT → $OUT"

pg_dump \
  -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" \
  --data-only \
  --disable-triggers \
  --exclude-table=_prisma_migrations \
  --no-owner \
  --no-privileges \
  -f "$OUT"

echo "✅ Wrote $(wc -c <"$OUT") bytes to $OUT"
