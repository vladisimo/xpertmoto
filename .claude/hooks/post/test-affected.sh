#!/usr/bin/env bash
# PostToolUse: when a file under src/server/ is edited, run the matching
# vitest unit test file if one exists. No-op otherwise.
# Also no-op until Vitest is installed (pre-A6 migration).

set -euo pipefail
source "$(dirname "$0")/../lib/common.sh"

is_skipped "test-affected" && exit 0

payload="$(read_stdin_json)"
file_path="$(jq_field "$payload" '.tool_input.file_path')"

case "$file_path" in
  *.ts|*.tsx) ;;
  *) exit 0 ;;
esac

cd "$PROJECT_ROOT"
if ! [ -x node_modules/.bin/vitest ]; then
  log INFO "test-affected: vitest not installed, skipping"
  exit 0
fi

rel="${file_path#"$PROJECT_ROOT/"}"
candidates=()
case "$rel" in
  src/server/*)
    stem="${rel#src/server/}"
    stem="${stem%.ts}"
    stem="${stem%.tsx}"
    # Mirrored path (per CLAUDE.md testing contract) preferred; basename is a fallback.
    candidates+=("tests/unit/${stem}.test.ts")
    candidates+=("tests/unit/$(basename "$stem").test.ts")
    ;;
  src/lib/*)
    stem="${rel#src/lib/}"
    stem="${stem%.ts}"
    candidates+=("tests/unit/${stem}.test.ts")
    candidates+=("tests/unit/$(basename "$stem").test.ts")
    candidates+=("tests/$(basename "$stem").test.ts")
    ;;
  tests/unit/*|tests/*.test.ts)
    candidates+=("$rel")
    ;;
  *) exit 0 ;;
esac

candidate=""
for c in "${candidates[@]}"; do
  if [ -f "$c" ]; then candidate="$c"; break; fi
done

if [ -z "$candidate" ]; then
  log INFO "test-affected: no matching test for $rel (tried: ${candidates[*]})"
  exit 0
fi

echo "Running affected test: $candidate" >&2
if node_modules/.bin/vitest run "$candidate" >&2; then
  log INFO "test-affected: pass $candidate"
  exit 0
fi
echo "--- affected test failed: $candidate ---" >&2
log WARN "test-affected: fail $candidate"
exit 1
