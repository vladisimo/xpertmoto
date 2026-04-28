#!/usr/bin/env bash
# Downloads the MaxMind GeoLite2-City.mmdb used by the Live Visitors
# analytics geo lookup. MaxMind requires a free account + license key:
#   https://www.maxmind.com/en/geolite2/signup
# then export MAXMIND_LICENSE_KEY=... before running this script.
#
# Re-run on a schedule (monthly) to refresh the DB.

set -euo pipefail

DEST_DIR="${DEST_DIR:-./data}"
DEST_FILE="${DEST_FILE:-GeoLite2-City.mmdb}"

if [ -z "${MAXMIND_LICENSE_KEY:-}" ]; then
  echo "ERROR: MAXMIND_LICENSE_KEY env var is required." >&2
  echo "Sign up free at https://www.maxmind.com/en/geolite2/signup" >&2
  exit 1
fi

mkdir -p "$DEST_DIR"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

url="https://download.maxmind.com/app/geoip_download?edition_id=GeoLite2-City&license_key=${MAXMIND_LICENSE_KEY}&suffix=tar.gz"
echo "Downloading GeoLite2-City.tar.gz…" >&2
curl -sSL -o "$tmp/db.tar.gz" "$url"

echo "Extracting…" >&2
tar -xzf "$tmp/db.tar.gz" -C "$tmp"
mmdb=$(find "$tmp" -name "GeoLite2-City.mmdb" -print -quit)
if [ -z "$mmdb" ]; then
  echo "ERROR: GeoLite2-City.mmdb not found in archive." >&2
  exit 1
fi

mv "$mmdb" "$DEST_DIR/$DEST_FILE"
echo "Installed $DEST_DIR/$DEST_FILE ($(du -h "$DEST_DIR/$DEST_FILE" | awk '{print $1}'))" >&2
