#!/usr/bin/env bash
# PreToolUse tripwire for XPERT Moto night-shift sessions.
# exit 0 = allow, exit 2 = block. Fails OPEN on internal error (logged) so a
# night never bricks on a hook bug; the strong guard is the worktree write
# fence plus the repo's own project hooks (guard-bash, protect-schema, …).
#
# Env contract (set by worker.sh on the claude process):
#   NIGHT_WT       = absolute path of this task's worktree (write fence root)
#   NIGHT_READONLY = 1 for critic sessions (deny all writes/mutations)
#   NIGHT_E2E_OK   = 1 only when the task owns the e2e singleton lock
#   NIGHT_ALLOW_DEPS = 1 only when the task front-matter allows dep changes
set -uo pipefail
HOOKLOG="${NIGHT_STATE_DIR:-/home/vlad/xpertmoto-night}/logs/safety.log"
ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }
allow() { exit 0; }
deny() {
  echo "BLOCKED by night-shift safety tripwire: $1" >&2
  printf '%s BLOCK %s\n' "$(ts)" "$1" >> "$HOOKLOG" 2>/dev/null
  exit 2
}

input=$(cat 2>/dev/null) || allow
tool=$(printf '%s' "$input" | jq -r '.tool_name // empty' 2>/dev/null) || allow
[ -z "$tool" ] && allow
cwd=$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null)

WT="${NIGHT_WT:-}"
RO="${NIGHT_READONLY:-0}"

path_allowed() { # absolute path -> 0 allow / 1 deny
  local p="$1"
  # Never let a session touch its own guardrails, CI, or hook config —
  # in ANY location (worktree copies are inert but edits there would ship).
  case "$p" in
    */scripts/night-shift/*|*/.claude/*|*/.github/workflows/*) return 1 ;;
  esac
  # The canonical checkout is strictly read-only to night sessions.
  case "$p" in
    /home/vlad/scootering/*) return 1 ;;
  esac
  local r
  for r in ${WT:+"$WT"} /tmp; do
    [ "$p" = "$r" ] && return 0
    [ "${p#"$r"/}" != "$p" ] && return 0
  done
  return 1
}

case "$tool" in
  Write|Edit|MultiEdit|NotebookEdit)
    [ "$RO" = "1" ] && deny "file write in read-only (critic) session"
    p=$(printf '%s' "$input" | jq -r '.tool_input.file_path // .tool_input.notebook_path // empty' 2>/dev/null)
    [ -z "$p" ] && allow
    case "$p" in
      /*) : ;;
      *)  p="${cwd:-$WT}/$p" ;;   # resolve relative against the session cwd
    esac
    path_allowed "$p" || deny "file write outside the task worktree: $p"
    ;;
  Bash)
    cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)
    [ -z "$cmd" ] && allow
    low=$(printf '%s' "$cmd" | tr 'A-Z' 'a-z')

    if [ "$RO" = "1" ]; then
      grep -qE '(^|[;&|[:space:]])git[[:space:]]+(-[^[:space:]]+[[:space:]]+)*(add|commit|checkout|reset|clean|stash|merge|rebase|cherry-pick|push|pull|fetch|worktree|branch[[:space:]]+-[dD])([[:space:]]|$)' <<<"$cmd" && deny "git mutation in read-only session"
      grep -qE '(^|[;&|[:space:]])(npm|npx|pnpm|yarn|node|tsx)([[:space:]]|$)' <<<"$cmd" && deny "package/runtime command in read-only session"
      grep -qE '(^|[;&|[:space:]])(rm|mv|tee|truncate)([[:space:]]|$)|sed[[:space:]]+-[a-z]*i' <<<"$cmd" && deny "file mutation in read-only session"
    fi

    grep -qE '(^|[;&|[:space:]])sudo([[:space:]]|$)' <<<"$cmd" && deny "sudo"
    grep -qE '(^|[;&|[:space:]])(systemctl|loginctl|crontab|shutdown|reboot|mkfs|fdisk|chown)([[:space:]]|$)' <<<"$cmd" && deny "system command"
    grep -qE '(^|[;&|[:space:]])git([[:space:]]+-[^[:space:]]+)*[[:space:]]+(push|remote)([[:space:]]|$)' <<<"$cmd" && deny "git push/remote — the runner ships, not the session"
    grep -qE '(^|[;&|[:space:]])gh([[:space:]]|$)' <<<"$cmd" && deny "gh — the runner ships, not the session"
    grep -qE 'prisma([[:space:]]+\S+)*[[:space:]]+(migrate[[:space:]]+(reset|deploy|dev)|db[[:space:]]+(push|execute|seed))' <<<"$cmd" && deny "prisma migrate/db mutation (dev DB is shared)"
    grep -qE 'npm[[:space:]]+run[[:space:]]+db:' <<<"$cmd" && deny "npm run db:* (dev/e2e DB scripts are runner-only)"
    grep -qiE '(drop[[:space:]]+(database|schema)|truncate[[:space:]])' <<<"$cmd" && deny "destructive SQL"
    if [ "${NIGHT_ALLOW_DEPS:-0}" != "1" ]; then
      grep -qE '(^|[;&|[:space:]])(npm|pnpm|yarn)[[:space:]]+(i|install|ci|add|un|uninstall|rm|remove|update|up|upgrade)([[:space:]]|$)' <<<"$cmd" && deny "package install/update (allow_deps not set)"
    fi
    grep -qE 'docker([[:space:]]+\S+)*[[:space:]]+(rm|stop|kill|restart|pause|unpause|prune|down|rmi)([[:space:]]|$)' <<<"$cmd" && deny "docker mutation"
    if [ "${NIGHT_E2E_OK:-0}" != "1" ]; then
      grep -qE 'playwright([[:space:]]+\S+)*[[:space:]]+test|test:e2e|dev:e2e' <<<"$cmd" && deny "e2e run (singleton stack; not this task's lock)"
    fi
    grep -qE '(curl|wget)[^|]*\|[[:space:]]*(sudo[[:space:]]+)?(ba)?sh([[:space:]]|$)' <<<"$low" && deny "pipe-to-shell"
    grep -qE '(>>?[[:space:]]*|[[:space:]](rm|mv|cp|tee|truncate)[[:space:]])[^\n]*(/home/vlad/\.claude|/home/vlad/\.bashrc|/home/vlad/\.profile|/home/vlad/\.ssh|/home/vlad/\.config|~/\.claude|~/\.ssh|~/\.config|/etc/)' <<<"$low" && deny "write to protected location"
    grep -qE '(>>?[[:space:]]*|[[:space:]](rm|mv|cp|tee|truncate)[[:space:]])[^\n]*/home/vlad/scootering(/|[[:space:]]|$)' <<<"$cmd" && deny "mutate the canonical checkout (read-only to night sessions)"
    grep -qE '(^|[;&|[:space:]])(git|sed)[[:space:]]+[^\n]*-C[[:space:]]+/home/vlad/scootering' <<<"$cmd" && deny "git -C into the canonical checkout"
    grep -qE 'sed[[:space:]]+-[a-z]*i[^\n]*/home/vlad/scootering/' <<<"$cmd" && deny "sed -i on the canonical checkout"
    grep -qE 'rm[[:space:]]+-[a-z]*[rf][a-z]*[[:space:]]+(/([[:space:]]|$)|~|\$home|/home/vlad([[:space:]/]|$)|/etc|/usr|/var|\*)' <<<"$low" && deny "rm -rf of a dangerous path"
    grep -qE ':\(\)[[:space:]]*\{[^}]*:[[:space:]]*\|[[:space:]]*:' <<<"$cmd" && deny "fork bomb"
    allow
    ;;
  *) allow ;;
esac
allow
