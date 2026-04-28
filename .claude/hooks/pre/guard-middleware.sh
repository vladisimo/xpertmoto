#!/usr/bin/env bash
# PreToolUse: block creating/editing Next.js `middleware.ts` files.
# Next.js 16 deprecated the middleware convention in favour of `proxy.ts`.
# Having both files triggers a fatal "Both middleware file and proxy file are
# detected" error at dev-server startup.

set -euo pipefail
source "$(dirname "$0")/../lib/common.sh"

is_skipped "guard-middleware" && exit 0

payload="$(read_stdin_json)"
file_path="$(jq_field "$payload" '.tool_input.file_path')"

case "$file_path" in
  */src/middleware.ts|*/src/middleware.js|src/middleware.ts|src/middleware.js|middleware.ts|middleware.js)
    echo "BLOCKED: Next.js 16 deprecated middleware.ts — use src/proxy.ts instead." >&2
    echo "If both files exist the dev server fails with 'Both middleware file and proxy file are detected'." >&2
    echo "Unblock: edit src/proxy.ts (export default async function proxy(req)) and merge the logic there." >&2
    log WARN "guard-middleware: blocked write to $file_path"
    exit 2
    ;;
esac

exit 0
