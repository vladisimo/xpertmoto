#!/usr/bin/env bash
# Enforces the Status chips contract from CLAUDE.md:
#   - <StatusBadge> is the only way to render a domain status enum.
#   - The shadcn <Badge> primitive must NOT be used for status (its
#     `success` / `warning` variants have been removed for that reason).
#   - Local STATUS_VARIANT / SEVERITY_VARIANT / PRIORITY_VARIANT /
#     CONDITION_VARIANT maps next to a <Badge> import are banned —
#     add the missing key to STATUS_TONE_MAP instead.
#   - Hand-rolled tone pairs on a pill outside StatusBadge / Badge
#     themselves are banned.
set -e
cd "$(dirname "$0")/.."

fail=0

# 1. Disallow Badge variant="success"|"warning"
hits=$(grep -rEn 'variant="(success|warning)"' src \
        --include='*.ts' --include='*.tsx' \
        --exclude='*.test.ts' --exclude='*.test.tsx' || true)
if [ -n "$hits" ]; then
  echo "ERROR: Badge variant=\"success\"/\"warning\" is banned. Use <StatusBadge>."
  echo "$hits"
  fail=1
fi

# 2. Disallow local *_VARIANT / *_CLASS status-tone maps. (Not _BADGE —
#    that suffix is also used by legitimate adapter maps that resolve to
#    `{ status: StatusKey; label }` and feed straight into <StatusBadge>.)
hits=$(grep -rEn 'const (STATUS|SEVERITY|PRIORITY|CONDITION|SYNC_STATUS|BOOKING_STATUS|PAYMENT_STATUS)_(VARIANT|CLASS)\b' src \
        --include='*.ts' --include='*.tsx' || true)
if [ -n "$hits" ]; then
  echo "ERROR: Local status-tone maps are banned. Add the key to STATUS_TONE_MAP."
  echo "$hits"
  fail=1
fi

# 3. Disallow hand-rolled status tone pairs on pill-shaped spans.
#    We only flag the tone-pair-on-rounded-full pattern; the same
#    colours used for full-page warning surfaces or text emphasis are
#    out of scope. The status-badge / badge sources are exempt.
hits=$(grep -rEn 'rounded-full[^"]*bg-(red|amber|emerald|green|sky)-(50|100|500/10)[^"]*text-(red|amber|emerald|green|sky)-(700|800|300)' src \
        --include='*.ts' --include='*.tsx' \
        --exclude='status-badge.tsx' --exclude='badge.tsx' || true)
if [ -n "$hits" ]; then
  echo "ERROR: Hand-rolled status tone pair on a pill detected. Use <StatusBadge>."
  echo "$hits"
  fail=1
fi

if [ "$fail" -eq 0 ]; then
  echo "lint-status-badges: OK"
fi
exit $fail
