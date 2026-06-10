---
name: ship
description: Commit the current work, push it to a feature branch, and open or update its PR so nothing sits un-synced locally. Use when the user says "ship it", "push this", "open a PR", "commit and push", or when the git-sync-reminder Stop hook has flagged uncommitted/unpushed work.
---

# /ship — get the current work into git and onto a PR

Goal: take whatever is done locally and land it as a pushed feature branch with
an open (or updated) PR, with CI running. This is the deliberate, on-demand
counterpart to the `git-sync-reminder` Stop hook. Never push straight to `main`.

## Pre-flight

1. **Check state.** Run `git status --short` and `git rev-parse --abbrev-ref HEAD`.
   Note tracked changes, untracked files, and the current branch.
2. **Confirm the definition-of-done is green** before shipping broken code:
   `npm run typecheck` and `npm run lint` must pass for the files you touched.
   (The `definition-of-done.sh` Stop hook enforces this anyway — don't ship red.)
   Remember the lint/typecheck red-baseline gotcha: a stale `.next` pollutes
   local results, so judge by *your* files, not the whole-repo count.

## Branch

3. **Never commit to `main`/`master`.** If `HEAD` is on `main`:
   - Propose a branch name from the work (e.g. `feat/<slug>`, `fix/<slug>`,
     `chore/<slug>`). Ask the user to confirm or rename it.
   - `git checkout -b <branch>` — this carries the uncommitted changes with you.
4. If already on a feature branch, stay on it.

## Commit

5. Stage deliberately. **Do not blanket `git add -A`** — exclude generated /
   scratch files (`next-env.d.ts` auto-flips, `.claude/*.lock`, anything in
   `data/`). Review `git status` and add the real changes.
6. Commit with a clear conventional-commit message (`feat:`, `fix:`, `chore:`,
   `ci:`, etc.). End the message body with the repo's required trailer:
   `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
7. If a `prisma/schema.prisma` edit is in the diff, confirm a matching migration
   is staged too (see the `prisma-migration` skill) — don't ship a schema change
   without its migration.

## Push + PR

8. Push with upstream: `git push -u origin <branch>`.
   - `git push` uses the SSH remote (`git@github.com:...`) and the user's SSH key.
   - The `guard-bash.sh` hook blocks `git push --force` to `main`/`master`; never
     force-push shared branches.
9. Open or update the PR:
   - If `gh` is authenticated **with `Pull requests: write`**: `gh pr create
     --fill --base main` (or `gh pr view` / push to update an existing one).
   - If `gh` lacks PR-write (a fine-grained PAT often does — this repo hit that):
     `gh pr create` will fail with "Resource not accessible by personal access
     token". In that case push the branch (done in step 8) and give the user the
     compare URL (`https://github.com/<owner>/<repo>/compare/main...<branch>`)
     to open the PR in the UI. **Do not** work around it by pushing to `main`.
10. Report: branch name, commit SHA, PR number/URL, and that CI is running. If
    asked to wait, poll `gh run list --branch <branch>` until the run concludes,
    then report green/red (investigate + fix if red).

## What /ship must NOT do

- Push or merge directly to `main`/`master` (bypasses PR review; the harness
  blocks it anyway).
- Merge a PR on the user's behalf unless explicitly asked and authorized.
- Blanket-add generated/untracked noise into a commit.
