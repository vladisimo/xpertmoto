#!/usr/bin/env bash
# PreToolUse: block dangerous Bash commands. Non-blocking for safe ones.
#
# Catches:
#   - rm -rf at /, ~, $HOME, or any absolute path containing src/, prisma/
#   - prisma db push against a non-localhost DATABASE_URL
#   - git push --force / -f to main / master
#   - git reset --hard with no recent stash (warn only)
#   - npm install of an unpinned new package without --save-dev (warn only)
#
# Pattern source: https://www.pixelmojo.io/blogs/claude-code-hooks-production-quality-ci-cd-patterns

set -euo pipefail
source "$(dirname "$0")/../lib/common.sh"

is_skipped "guard-bash" && exit 0

payload="$(read_stdin_json)"
tool_name="$(jq_field "$payload" '.tool_name')"
[ "$tool_name" = "Bash" ] || exit 0

cmd="$(jq_field "$payload" '.tool_input.command')"
[ -n "$cmd" ] || exit 0

block() {
  echo "BLOCKED by guard-bash: $1" >&2
  echo "If this is intentional, ask the user to confirm and run the command yourself, or set CLAUDE_SKIP_HOOKS=guard-bash for this session." >&2
  log WARN "guard-bash: blocked: $cmd"
  exit 2
}

# rm -rf against root / home / project-critical paths
if printf '%s' "$cmd" | grep -Eq '\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r|-rf|-fr)\b'; then
  if printf '%s' "$cmd" | grep -Eq '(\s|=)(/|~|\$HOME|\$\{HOME\})(\s|$|/)'; then
    block "rm -rf at filesystem root or \$HOME"
  fi
  if printf '%s' "$cmd" | grep -Eq 'rm\s+-[rfRF]+\s+(/?src|/?prisma|/?\.git|/?node_modules)(\b|/)'; then
    block "rm -rf against a project-critical path (src/ / prisma/ / .git / node_modules)"
  fi
fi

# prisma db push against non-localhost
if printf '%s' "$cmd" | grep -Eq '(prisma|npx prisma|pnpm prisma|yarn prisma)\s+db\s+push'; then
  db_url="${DATABASE_URL:-}"
  if [ -n "$db_url" ] && ! printf '%s' "$db_url" | grep -Eq '@(localhost|127\.0\.0\.1|0\.0\.0\.0|host\.docker\.internal)(:|/)'; then
    block "prisma db push against non-localhost DATABASE_URL ($db_url) — use migrations instead"
  fi
fi

# git push --force / -f to main or master
if printf '%s' "$cmd" | grep -Eq '\bgit\s+push\s+.*(--force\b|--force-with-lease\b|\s-f\b)'; then
  if printf '%s' "$cmd" | grep -Eq '\b(origin\s+)?(main|master)\b'; then
    block "git push --force to main/master"
  fi
fi

# git reset --hard — warn-only, run a snapshot suggestion
if printf '%s' "$cmd" | grep -Eq '\bgit\s+reset\s+--hard\b'; then
  echo "guard-bash WARNING: 'git reset --hard' is destructive. Did you stash first? Continuing." >&2
  log INFO "guard-bash: warned on git reset --hard"
fi

# npm install of a new package without --save-dev (slopsquatting guard)
if printf '%s' "$cmd" | grep -Eq '\bnpm\s+(install|i|add)\s+[^-]'; then
  if ! printf '%s' "$cmd" | grep -Eq '(--save-dev|-D|--save-exact|-E)\b'; then
    echo "guard-bash WARNING: 'npm install <pkg>' without --save-dev or --save-exact. Confirm the package name with the user before installing." >&2
    log INFO "guard-bash: warned on unpinned npm install"
  fi
fi

exit 0
