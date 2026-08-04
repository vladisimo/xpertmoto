#!/usr/bin/env bash
# worker.sh <taskfile-in-running/> — ONE night task end-to-end:
#   worktree off origin/main → build session → hard gates → DoD (+1 repair)
#   → critic self-review → commit → push → PR (or compare-URL fallback).
# Invoked by night.sh via setsid (own process group). NIGHT_DRY_RUN=1 runs the
# full flow but skips push/PR, returns the task to queue/ and leaves the
# worktree in place for inspection.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
source "$HERE/config.env"
# shellcheck source=/dev/null
source "$HERE/lib.sh"

TASKFILE="$1"
DRY="${NIGHT_DRY_RUN:-0}"
[ -f "$TASKFILE" ] || { nlog "worker: taskfile missing: $TASKFILE"; exit 1; }

ID=$(task_id "$TASKFILE"); [ -z "$ID" ] && ID="$(basename "$TASKFILE" .md)"
TITLE=$(tfield "$TASKFILE" title)
CATEGORY=$(tfield "$TASKFILE" category); [ -z "$CATEGORY" ] && CATEGORY=fix
MODELKEY=$(tfield "$TASKFILE" model)
case "$MODELKEY" in
  opus|build|"") MODEL="$MODEL_BUILD" ;;
  sonnet|chore)  MODEL="$MODEL_CHORE" ;;
  *)             MODEL="$MODELKEY" ;;
esac
SCOPE=$(tfield "$TASKFILE" scope)
ALLOW_SCHEMA=$(tfield "$TASKFILE" allow_schema); [ "$ALLOW_SCHEMA" = "true" ] || ALLOW_SCHEMA=false
ALLOW_DEPS=$(tfield "$TASKFILE" allow_deps);     [ "$ALLOW_DEPS" = "true" ] || ALLOW_DEPS=false
VERIFY=$(tfield "$TASKFILE" verify); [ -z "$VERIFY" ] && VERIFY=default
E2E=$(tfield "$TASKFILE" e2e);       [ -z "$E2E" ] && E2E=none
MAXL=$(tfield "$TASKFILE" max_lines); [[ "$MAXL" =~ ^[0-9]+$ ]] || MAXL="$MAX_DIFF_LINES"
TMIN=$(tfield "$TASKFILE" timeout_minutes)
[[ "$TMIN" =~ ^[0-9]+$ ]] && SESSION_TIMEOUT=$(( TMIN * 60 ))

DATE=$(date +%Y%m%d)
BR="night/${DATE}-$(printf '%s' "$ID" | tr 'A-Z' 'a-z')"
WT="$WORKTREES/$ID"
CONSOLE="$LOGS/${ID}.console.log"
SESSION_JSON="$LOGS/${ID}.session.json"
DOD_LOG="$LOGS/${ID}.dod.log"
RESULTS_DIR="$STATE/results-$DATE"; mkdir -p "$RESULTS_DIR"
T0=$(now_epoch)

LANE=""; PR_URL=""; COMPARE_URL=""; VERDICT=""; VERDICT_SUMMARY=""
FINDINGS_JSON="[]"; FAIL_REASON=""; RL_EVENTS=0; ATTEMPTS=1
DIFFSTAT=""; PUSHED=no; KEEP_WT=0

write_result() {
  jq -n --arg id "$ID" --arg title "$TITLE" --arg category "$CATEGORY" \
    --arg lane "$LANE" --arg branch "$BR" --arg pr "$PR_URL" \
    --arg compare "$COMPARE_URL" --arg verdict "$VERDICT" \
    --arg vsummary "$VERDICT_SUMMARY" --arg fail "$FAIL_REASON" \
    --arg diffstat "$DIFFSTAT" --arg pushed "$PUSHED" \
    --argjson findings "$FINDINGS_JSON" --argjson rl "$RL_EVENTS" \
    --argjson attempts "$ATTEMPTS" --argjson wall "$(( $(now_epoch) - T0 ))" \
    '{id:$id,title:$title,category:$category,lane:$lane,branch:$branch,
      pr_url:$pr,compare_url:$compare,verdict:$verdict,verdict_summary:$vsummary,
      findings:$findings,fail_reason:$fail,diffstat:$diffstat,pushed:$pushed,
      ratelimit_events:$rl,attempts:$attempts,wall_seconds:$wall}' \
    > "$RESULTS_DIR/${ID}.json" 2>/dev/null || true
}

move_task() { # move_task <lane-dir-name>
  local dest="$NIGHT/$1/$(basename "$TASKFILE")"
  mv -f "$TASKFILE" "$dest" 2>/dev/null && TASKFILE="$dest"
  LANE="$1"
}

bundle_branch() {
  [ -e "$WT/.git" ] || return 0
  local base="${BASE_SHA:-origin/main}"
  if ! git -C "$WT" diff --quiet 2>/dev/null || ! git -C "$WT" diff --cached --quiet 2>/dev/null; then
    git -C "$WT" add -A >/dev/null 2>&1
    git -C "$WT" commit -q -m "WIP night $ID (not shipped)" >/dev/null 2>&1 || true
  fi
  if [ -n "$(git -C "$WT" log "$base"..HEAD --oneline 2>/dev/null)" ]; then
    git -C "$WT" bundle create "$BUNDLES/${ID}-${DATE}.bundle" "$base"..HEAD >/dev/null 2>&1 \
      && nlog "worker $ID: unshipped work bundled to bundles/${ID}-${DATE}.bundle"
  fi
}

CLEANED=0
cleanup() {
  [ "$CLEANED" = 1 ] && return; CLEANED=1
  if [ "$DRY" = 1 ] || [ "$KEEP_WT" = 1 ]; then
    nlog "worker $ID: worktree kept at $WT (dry=$DRY keep=$KEEP_WT)"
    return
  fi
  git -C "$REPO" worktree remove --force "$WT" >/dev/null 2>&1 || true
  rm -rf "$WT" 2>/dev/null || true
  git -C "$REPO" worktree prune >/dev/null 2>&1 || true
  if [ "$PUSHED" = yes ]; then
    git -C "$REPO" branch -D "$BR" >/dev/null 2>&1 || true   # remote holds it
  fi
}
on_term() {
  nlog "worker $ID: TERM (window cutoff)"
  FAIL_REASON="window cutoff (hard stop)"
  bundle_branch
  move_task failed
  write_result
  cleanup
  exit 143
}
trap on_term TERM
trap cleanup EXIT

finish_fail() { # <reason>
  FAIL_REASON="$1"
  nlog "worker $ID FAIL: $1"
  bundle_branch
  move_task failed
  write_result
  exit 0
}

nlog "worker START $ID ($TITLE) model=$MODEL timeout=${SESSION_TIMEOUT}s dry=$DRY"

# ── 1. fresh worktree off a PINNED base ──────────────────────────────────────
# Resolve origin/main exactly once: if the ref moves mid-task (daytime push,
# dependabot merge), a later `reset --soft origin/main` would re-base the diff
# against a commit the worktree never contained → phantom staged changes.
BASE_SHA=$(git -C "$REPO" rev-parse origin/main) || finish_fail "cannot resolve origin/main"
git -C "$REPO" worktree prune >/dev/null 2>&1 || true
git -C "$REPO" worktree remove --force "$WT" >/dev/null 2>&1 || true
rm -rf "$WT" 2>/dev/null || true
git -C "$REPO" branch -D "$BR" >/dev/null 2>&1 || true
git -C "$REPO" worktree add -b "$BR" "$WT" "$BASE_SHA" >>"$CONSOLE" 2>&1 \
  || finish_fail "worktree add failed"

for f in .env .env.local .env.e2e; do
  [ -f "$REPO/$f" ] && cp "$REPO/$f" "$WT/$f"
done
if [ -d "$REPO/node_modules" ] && [ ! -e "$WT/node_modules" ]; then
  cp -al "$REPO/node_modules" "$WT/node_modules" 2>>"$CONSOLE" || true
  # `prisma generate` writes THROUGH hardlinked inodes and would silently
  # mutate the canonical repo's generated client — real-copy those dirs.
  for d in node_modules/.prisma node_modules/@prisma/client; do
    if [ -e "$REPO/$d" ]; then
      rm -rf "${WT:?}/$d" 2>/dev/null
      cp -a "$REPO/$d" "$WT/$d" 2>>"$CONSOLE" || true
    fi
  done
fi

# ── 1b. baseline sanity: the badge lint is NOT in cloud CI, so origin/main
# can be CI-green yet DoD-red — catch that here instead of burning a repair
# attempt on breakage the task didn't cause.
if [ -x "$WT/scripts/lint-status-badges.sh" ]; then
  if ! ( cd "$WT" && bash scripts/lint-status-badges.sh ) >>"$CONSOLE" 2>&1; then
    echo "baseline" > "$STATE/abort-night"
    finish_fail "origin/main baseline fails lint-status-badges — fix main first (night aborted)"
  fi
fi

# ── 2. e2e singleton lock (only when the task opts in) ───────────────────────
E2E_ENV=0
if [ "$E2E" != "none" ]; then
  exec 8>"$LOCKS/e2e.lock"
  flock -w 60 8 || finish_fail "could not acquire e2e-stack lock"
  E2E_ENV=1
fi

# ── 3. build the prompt ──────────────────────────────────────────────────────
TASKBODY=$(awk 'c>=2{print} /^---[[:space:]]*$/{c++}' "$TASKFILE")
if [ "$ALLOW_SCHEMA" = true ]; then
  # Wording matters: "schema change" + "migration" in the prompt is what
  # unlocks the repo's protect-schema.sh hook for this session.
  SCHEMA_CLAUSE="This task authorises a prisma schema change and its migration: edit prisma/schema.prisma and ship the matching migration in the same change (see prisma/CLAUDE.md)."
else
  # Must NOT contain the unlock phrases (migration / schema change / prisma schema).
  SCHEMA_CLAUSE="The database layer is locked: do NOT edit anything under prisma/."
fi
if [ "$ALLOW_DEPS" = true ]; then
  DEPS_CLAUSE="Dependency changes are authorised for this task; keep them minimal and pinned."
else
  DEPS_CLAUSE="Do NOT add, remove, or update any dependency; package.json and package-lock.json are locked."
fi
E2E_CLAUSE=""
if [ "$E2E" != "none" ]; then
  E2E_CLAUSE=" EXCEPTION: this task holds the e2e-stack lock and may run \`npm run test:e2e:${E2E}\`."
fi
PROMPT=$(cat "$NIGHT_BIN/prompts/preamble.md")
PROMPT=${PROMPT//@ID@/$ID}
PROMPT=${PROMPT//@TITLE@/$TITLE}
PROMPT=${PROMPT//@SCOPE@/$SCOPE}
PROMPT=${PROMPT//@MAXL@/$MAXL}
PROMPT=${PROMPT//@SCHEMA_CLAUSE@/$SCHEMA_CLAUSE}
PROMPT=${PROMPT//@DEPS_CLAUSE@/$DEPS_CLAUSE}
PROMPT=${PROMPT//@E2E_CLAUSE@/$E2E_CLAUSE}
PROMPT=${PROMPT//@TASKBODY@/$TASKBODY}

# ── 4. sessions ──────────────────────────────────────────────────────────────
run_session() { # run_session <timeout> <model> <prompt> <out.json> <readonly01>
  local to="$1" model="$2" prompt="$3" out="$4" ro="$5"
  ( cd "$WT" && \
    CLAUDE_SKIP_HOOKS=typecheck-changed,definition-of-done,git-sync-reminder \
    NIGHT_WT="$WT" NIGHT_STATE_DIR="$NIGHT" NIGHT_READONLY="$ro" \
    NIGHT_E2E_OK="$E2E_ENV" \
    NIGHT_ALLOW_DEPS="$([ "$ALLOW_DEPS" = true ] && echo 1 || echo 0)" \
    timeout -k 60 "$to" claude -p "$prompt" \
      --output-format json --model "$model" \
      --dangerously-skip-permissions --settings "$SETTINGS_FILE" \
  ) > "$out" 2>>"$CONSOLE"
}

check_session_errors() { # <session.json> — handles auth + first ratelimit retry gate
  if is_auth_error "$1"; then
    echo "auth" > "$STATE/abort-night"
    finish_fail "claude auth error — night aborted"
  fi
}

run_build_session() { # <timeout> <prompt> <out>
  run_session "$1" "$MODEL" "$2" "$3" 0
  local rc=$?
  check_session_errors "$3"
  if is_ratelimit_error "$3"; then
    record_ratelimit; RL_EVENTS=$(( RL_EVENTS + 1 ))
    nlog "worker $ID: rate-limited — backing off ${RATELIMIT_BACKOFF_SECONDS}s, one retry"
    sleep "$RATELIMIT_BACKOFF_SECONDS"
    run_session "$1" "$MODEL" "$2" "$3" 0
    rc=$?
    check_session_errors "$3"
    if is_ratelimit_error "$3"; then
      record_ratelimit; RL_EVENTS=$(( RL_EVENTS + 1 ))
      finish_fail "rate-limited twice — task surrendered"
    fi
  fi
  [ "$rc" = 124 ] && nlog "worker $ID: session hit timeout — proceeding to gates anyway"
  return 0
}

run_build_session "$SESSION_TIMEOUT" "$PROMPT" "$SESSION_JSON"

# ── 5. normalise + hard gates ────────────────────────────────────────────────
run_gates() { # sets GATE_FAIL on failure
  GATE_FAIL=""
  git -C "$WT" reset -q --soft "$BASE_SHA" 2>>"$CONSOLE" || true
  git -C "$WT" add -A >/dev/null 2>&1
  if git -C "$WT" diff --cached --quiet 2>/dev/null; then
    GATE_FAIL="no changes produced"; return 1
  fi
  local staged
  staged=$(git -C "$WT" diff --cached --name-only)
  if [ "$ALLOW_SCHEMA" != true ] && grep -qE '^prisma/(schema\.prisma$|migrations/)' <<<"$staged"; then
    GATE_FAIL="schema files staged without allow_schema"; return 1
  fi
  if [ "$ALLOW_DEPS" != true ] && grep -qE '^package(-lock)?\.json$' <<<"$staged"; then
    GATE_FAIL="package.json staged without allow_deps"; return 1
  fi
  if grep -qE '^(\.claude/|\.github/workflows/|scripts/night-shift/)' <<<"$staged"; then
    GATE_FAIL="guardrail/CI files staged"; return 1
  fi
  local pathspecs=(".") g
  IFS=',' read -ra rawglobs <<<"$SCOPE"
  for g in "${rawglobs[@]}"; do
    g="$(printf '%s' "$g" | sed 's/^ *//;s/ *$//')"
    [ -z "$g" ] && continue
    case "$g" in
      *'*'*) pathspecs+=(":(exclude,glob)$g") ;;
      *)     pathspecs+=(":(exclude)$g") ;;
    esac
  done
  pathspecs+=(":(exclude,glob)tests/**")
  local oos
  oos=$(git -C "$WT" diff --cached --name-only -- "${pathspecs[@]}" 2>>"$CONSOLE")
  if [ -n "$oos" ]; then
    GATE_FAIL="out-of-scope files: $(printf '%s' "$oos" | tr '\n' ' ' | head -c 400)"; return 1
  fi
  local lines
  lines=$(git -C "$WT" diff --cached --numstat | awk '{a+=$1; d+=$2} END{print (a+d)+0}')
  if [ "${lines:-0}" -gt "$MAXL" ]; then
    GATE_FAIL="diff too large: ${lines} changed lines > cap ${MAXL} (scope-creep tripwire)"; return 1
  fi
  DIFFSTAT=$(git -C "$WT" diff --cached --shortstat | sed 's/^ *//')
  return 0
}
run_gates || finish_fail "$GATE_FAIL"

# ── 6. DoD gate (+ optional e2e), one repair attempt ─────────────────────────
run_dod() {
  bash "$HERE/night-dod.sh" "$WT" "$VERIFY" >"$DOD_LOG" 2>&1 || return 1
  if [ "$E2E" != "none" ]; then
    local spec="test:e2e:smoke"
    [ "$E2E" = "critical" ] && spec="test:e2e:critical"
    ( cd "$WT" && timeout -k 60 "$DOD_E2E_TIMEOUT" npm run "$spec" ) >>"$DOD_LOG" 2>&1 || return 1
  fi
  return 0
}
if ! run_dod; then
  ATTEMPTS=2
  nlog "worker $ID: DoD red — one repair attempt"
  RPROMPT=$(cat "$NIGHT_BIN/prompts/repair.md")
  RPROMPT=${RPROMPT//@ID@/$ID}
  RPROMPT=${RPROMPT//@TITLE@/$TITLE}
  RPROMPT=${RPROMPT//@SCOPE@/$SCOPE}
  RPROMPT=${RPROMPT//@DODTAIL@/$(tail -80 "$DOD_LOG")}
  if [ "$ALLOW_SCHEMA" = true ]; then
    RPROMPT="$RPROMPT
Reminder: this task authorises a prisma schema change and its migration."
  fi
  run_build_session "$REPAIR_TIMEOUT" "$RPROMPT" "$LOGS/${ID}.repair.json"
  run_gates || finish_fail "after repair: $GATE_FAIL"
  run_dod   || finish_fail "Definition of Done still red after repair (see dod.log)"
fi

# ── 7. commit, then critic self-review ───────────────────────────────────────
case "$CATEGORY" in
  tests) CTYPE="test" ;;
  feature) CTYPE="feat" ;;
  chore) CTYPE="chore" ;;
  *) CTYPE="fix" ;;
esac
case "$MODEL" in
  opus*)   MODEL_NAME="Claude Opus" ;;
  sonnet*) MODEL_NAME="Claude Sonnet" ;;
  *)       MODEL_NAME="Claude" ;;
esac
git -C "$WT" commit -q \
  -m "${CTYPE}: ${TITLE}" \
  -m "Night-shift task ${ID} (${DATE}). Local DoD: typecheck + lint + full vitest green." \
  -m "Co-Authored-By: ${MODEL_NAME} <noreply@anthropic.com>" \
  >>"$CONSOLE" 2>&1 || finish_fail "commit failed"

CPROMPT=$(cat "$NIGHT_BIN/prompts/critic.md")
CPROMPT=${CPROMPT//@ID@/$ID}
CPROMPT=${CPROMPT//@TITLE@/$TITLE}
CPROMPT=${CPROMPT//@BASE@/$BASE_SHA}
CPROMPT=${CPROMPT//@TASKBODY@/$TASKBODY}
run_session "$CRITIC_TIMEOUT" "$MODEL_CRITIC" "$CPROMPT" "$LOGS/${ID}.critic.json" 1 || true
if is_ratelimit_error "$LOGS/${ID}.critic.json"; then
  record_ratelimit; RL_EVENTS=$(( RL_EVENTS + 1 ))
fi
# The critic is fenced read-only, but belt-and-braces: drop any droppings.
if [ -n "$(git -C "$WT" status --porcelain 2>/dev/null)" ]; then
  git -C "$WT" checkout -q -- . 2>/dev/null || true
  git -C "$WT" clean -qfd 2>/dev/null || true
  nlog "worker $ID: critic session left changes — reset to HEAD"
fi
CRITIC_TEXT=$(jq -r '.result // ""' "$LOGS/${ID}.critic.json" 2>/dev/null)
CRITIC_OBJ=$(printf '%s' "$CRITIC_TEXT" | grep -o '{"verdict".*}' | tail -1)
VERDICT=$(printf '%s' "$CRITIC_OBJ" | jq -r '.verdict // empty' 2>/dev/null)
case "$VERDICT" in
  approve|concerns|block) ;;
  *) VERDICT="concerns"
     VERDICT_SUMMARY="critic output unparseable — treating as concerns"
     CRITIC_OBJ='{}' ;;
esac
[ -z "$VERDICT_SUMMARY" ] && VERDICT_SUMMARY=$(printf '%s' "$CRITIC_OBJ" | jq -r '.summary // ""' 2>/dev/null)
FINDINGS_JSON=$(printf '%s' "$CRITIC_OBJ" | jq -c '.findings // []' 2>/dev/null) || FINDINGS_JSON="[]"
[ -z "$FINDINGS_JSON" ] && FINDINGS_JSON="[]"
nlog "worker $ID: critic verdict=$VERDICT"

# ── 8. PR body ───────────────────────────────────────────────────────────────
PRBODY="$LOGS/${ID}.prbody.md"
{
  echo "## Night-shift ${ID} — ${TITLE}"
  echo
  echo "Automated overnight change: developed, gated, and self-reviewed unattended. **Human review required before merge.**"
  echo
  echo "- Category: \`${CATEGORY}\` · Diff: ${DIFFSTAT} · Attempts: ${ATTEMPTS}"
  echo "- Local DoD: typecheck ✓ lint ✓ full vitest ✓$([ "$VERIFY" != "default" ] && printf ' (%s)' "$VERIFY")$([ "$E2E" != "none" ] && printf ' e2e:%s ✓' "$E2E")"
  echo "- Self-review (${MODEL_CRITIC}): **${VERDICT}** — ${VERDICT_SUMMARY}"
  if [ "$(printf '%s' "$FINDINGS_JSON" | jq 'length' 2>/dev/null || echo 0)" -gt 0 ]; then
    echo
    echo "### Critic findings"
    printf '%s' "$FINDINGS_JSON" | jq -r '.[] | "- " + .' 2>/dev/null
  fi
  echo
  echo "<details><summary>Task spec</summary>"
  echo
  echo '```markdown'
  head -60 "$TASKFILE"
  echo '```'
  echo "</details>"
  echo
  echo "🤖 Generated with [Claude Code](https://claude.com/claude-code)"
} > "$PRBODY"

# ── 9. ship ──────────────────────────────────────────────────────────────────
if [ "$DRY" = 1 ]; then
  nlog "worker $ID: DRY RUN complete — verdict=$VERDICT; would push $BR"
  move_task queue
  LANE="dry-run"
  write_result
  echo "── dry-run would-be PR body ──"
  cat "$PRBODY"
  exit 0
fi

if ! git -C "$WT" push -u origin "$BR" >>"$CONSOLE" 2>&1; then
  sleep 30
  if ! git -C "$WT" push -u origin "$BR" >>"$CONSOLE" 2>&1; then
    KEEP_WT=1
    finish_fail "git push failed twice — worktree kept for manual push"
  fi
fi
PUSHED=yes
COMPARE_URL="https://github.com/${GITHUB_REPO}/compare/main...${BR}?expand=1"

if [ "$VERDICT" = "block" ]; then
  FAIL_REASON="critic blocked: ${VERDICT_SUMMARY} (branch pushed, NO PR opened)"
  nlog "worker $ID: $FAIL_REASON"
  move_task failed
  write_result
  exit 0
fi

if timeout 60 gh pr create --repo "$GITHUB_REPO" --base main --head "$BR" \
     --title "${CTYPE}: ${TITLE} [night ${ID}]" --body-file "$PRBODY" \
     > "$LOGS/${ID}.pr.txt" 2>&1; then
  PR_URL=$(grep -oE "https://github.com/${GITHUB_REPO}/pull/[0-9]+" "$LOGS/${ID}.pr.txt" | head -1)
  nlog "worker $ID: PR created ${PR_URL}"
else
  nlog "worker $ID: gh pr create failed — compare-URL fallback (no cloud CI will run!)"
fi

move_task done
write_result
nlog "worker DONE $ID (${DIFFSTAT})"
exit 0
