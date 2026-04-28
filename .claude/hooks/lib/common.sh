#!/usr/bin/env bash
# Shared helpers for Claude Code hooks in this project.
# Sourced by every hook. Keep it small and dependency-light.

set -euo pipefail

HOOK_LOG="${HOOK_LOG:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.log}"
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

log() {
  local level="$1"; shift
  printf '[%s] %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$level" "$*" >> "$HOOK_LOG" 2>/dev/null || true
}

read_stdin_json() {
  if [ -t 0 ]; then echo "{}"; else cat; fi
}

jq_field() {
  local json="$1" path="$2"
  printf '%s' "$json" | jq -r "$path // empty" 2>/dev/null || true
}

is_skipped() {
  local name="$1"
  case ",${CLAUDE_SKIP_HOOKS:-}," in
    *",${name},"*) return 0 ;;
    *",all,"*) return 0 ;;
    *) return 1 ;;
  esac
}

in_git_repo() {
  git -C "$PROJECT_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1
}
