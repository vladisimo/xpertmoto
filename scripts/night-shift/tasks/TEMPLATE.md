---
id: NT-000
title: One-line imperative title (lands in the commit + PR title)
category: tests            # tests | fix | ui | feature | chore → commit type
model: opus                # opus (default) | sonnet (cheap chores only)
scope: src/server/trpc/router/example.ts, src/components/example/**
                           # comma-separated allowed paths. Globs use *. Test
                           # files under tests/ are always allowed on top.
allow_schema: false        # true injects the protect-schema unlock phrase AND
                           # lets prisma/ files through the staged-file gate.
                           # Week-1 rule: never true.
allow_deps: false          # true lets package.json changes through
verify: default            # default = typecheck+lint+badges+full vitest;
                           # "default+build" appends next build
e2e: none                  # none | smoke | critical — explicit opt-in only;
                           # takes the e2e singleton-stack lock
max_lines: 800             # per-task diff cap (default 1500 if omitted)
timeout_minutes: 45        # build-session cap (default 45)
risk: low — say in one line what could go wrong and why it won't
---
## Done criteria

- Bullet list of observable outcomes a reviewer can check.
- e.g. "vitest file tests/unit/trpc/router/example.test.ts exists and covers
  every procedure with a happy path + failure case."

## Task

Full prompt body. Be specific: name files, name procedures, quote the
documented bug (docs/frontend-test-findings.md #N), state what must NOT
change. The night preamble (prompts/preamble.md) is prepended automatically —
don't repeat the contract here, spend the words on the task itself.
