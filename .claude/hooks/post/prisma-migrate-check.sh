#!/usr/bin/env bash
# PostToolUse: remind Claude to generate a migration after editing
# prisma/schema.prisma. Never runs migrate itself.

set -euo pipefail
source "$(dirname "$0")/../lib/common.sh"

is_skipped "prisma-migrate-check" && exit 0

payload="$(read_stdin_json)"
file_path="$(jq_field "$payload" '.tool_input.file_path')"

case "$file_path" in
  */prisma/schema.prisma)
    echo "REMINDER: schema.prisma changed." >&2
    echo "  1. Run 'npm run db:migrate -- --name <descriptive>' to generate a migration." >&2
    echo "  2. Commit the migration file alongside the schema change." >&2
    echo "  3. Never rely on 'prisma db push' for this project." >&2
    log INFO "prisma-migrate-check: reminder emitted"
    ;;
esac

exit 0
