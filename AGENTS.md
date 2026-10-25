# Agent Guidelines

## Harness capabilities

These instructions support Claude Code, Codex, Cursor, Antigravity (agy), and pi.
Use the tools actually exposed by the current client. A named tool below is not
a guarantee that it is installed. User instructions take precedence over skill
defaults; infer routine choices from the repository and existing authorization.

- **Project policy:** if `.agent/project.md` exists, read it at session start and follow it. It is
  consumer-owned — scaffold never syncs or overwrites it — and holds this repo's own rules, so
  AGENTS.md itself stays upstream-verbatim and syncs without conflicts. On a conflict, project
  policy wins on specifics and these guidelines win on intent. Absent: no project policy.
- **Skills:** `/name` below denotes a scaffold skill. In Codex, invoke `$name`
  or select it via `/skills`; read `.agents/skills/<name>/SKILL.md`, then its
  linked `skills/<name>.md`. Explicitly read referenced `@path` files relative
  to the containing document; do not assume Claude's import expansion.
- **Delegation:** use native subagents when available. Respect client concurrency
  limits by batching independent reviewers. Use fresh context for review when
  supported; otherwise disclose the limitation and apply the criteria serially.
  Editing lanes use explicit git worktrees if the client lacks an isolation flag.
- **Optional tools:** PR subscriptions, monitors, timers, memory, and file-delivery
  tools depend on the client. Use the fallbacks below; never claim an unavailable
  integration is active. Do not change global model, trust, or permission settings
  to make a workflow run.

## Session and process ownership

Each session has exactly one orchestrator. Separate sessions may work concurrently,
including in the same repository, but they are independent owners. Never inspect,
stop, reclaim, interrupt, or signal another session's orchestrator, workers, or a
user-launched agent CLI as lifecycle targets. Read-only aggregate resource checks
may observe them, but process names, PIDs, terminals, queue owner labels, lease
timestamps, and worktrees never establish authority over them.

Only a lifecycle controller may terminate the exact child tree it created for its
current generation, and only on explicit cancel or timeout. Normal child completion
must not send a cleanup signal. If ownership is ambiguous, leave the process and
worktree untouched, stop conflicting dispatch, and report the conflict.

## Iterative Autonomous Enhancement — a core design principle

A loop should produce great improvements **without a human judging each pass**:
**produce → self-evaluate against the target bar → name the gap → improve → re-evaluate.**
Judge with a real signal (a measurement, test, gate or critique of the actual output), prefer
deterministic evaluators, ratchet never reset (no pass regresses a measured gate), count both costs
(defect risk and complexity left behind), gate and commit each iteration, and treat human steering as
refining the target, not approving each step. Cap iterations, bail on non-convergence and escalate a
real blocker with its evidence; never self-label the work "good"; stage output, never merge to main
without approval.
→ full text: [`docs/agents-detail.md`](docs/agents-detail.md#iterative-autonomous-enhancement--a-core-design-principle).

## Session Start

On your first response in a new session:

1. **Sync check** — the `SessionStart` hook warns if the branch is behind `origin/main`; rebase
   (`git rebase origin/main`) or `git pull origin main` on `main`. Without the hook, run
   `git fetch origin main` + `git rev-list --count HEAD..origin/main`; on fetch failure report freshness
   unverified and continue locally.
2. **PR watch** — if this branch has an open PR, `subscribe_pr_activity` (this branch's PR only); without
   it, `gh pr view` / `gh pr checks` (a snapshot, not a subscription).
3. **Artifacts check** — `./docs/` `design.md` / `prd.md` / `plan.md`: resume the relevant ones,
   acknowledge unrelated ones without blocking; none and it's feature work → start `/feature-chain`
   (no permission needed; the grill resolves vague intent — no pre-question).
→ full text: [`docs/agents-detail.md`](docs/agents-detail.md#session-start).

## Responsiveness & Steerability

Optimize for **being steerable**, not autonomous completion; a user who can't redirect you is paying
for expensive autocomplete. Answer a mid-work message **before** resuming; keep turns tight and say so
before going quiet. Show the **fork, tradeoff and cost before** committing effort; flag your own
over-engineering; map the problem's shape first; prefer reversible moves; open each loop with a
one-line contract (target bar, judging signal, durability tier, iteration cap). The user's "wrong path"
is decisive — **"technically possible" is not "right."**
→ full text: [`docs/agents-detail.md`](docs/agents-detail.md#responsiveness--steerability).

## Continuous execution (loops & "build until done")

Given a standing directive (`/loop`, "build until done"), run **continuously**: do the work in-turn,
and the committed, tested slice is the checkpoint. Use a timer only for external gating (CI, deploys,
remote queues), usage-limit windows, or a crash-safety re-arm, and only when the client exposes
scheduling; never claim a restart is armed without a successful tool call. Steering always preempts.
One fully gated unit at a time (RED → GREEN → REFACTOR). **Supervise background work by progress, not
liveness**: each tick checks that jobs advanced, what each leaf process is doing, orphans, and who holds
shared budgets, via a probe script that exits non-zero on anomalies. **Never idle while described work is
unbuilt**: run the built-vs-described audit; "exhausted" means built and reachable.
→ full text: [`docs/agents-detail.md`](docs/agents-detail.md#continuous-execution-loops--build-until-done).

## Orchestration hygiene (lessons from long autonomous runs)

These failures each cost hours in a real run; each has a cheap guard.

- **Confirm a merge before cleaning up.** Check that the PR is `MERGED` and that its squash
  commit is in `origin/main` before you delete branches or worktrees or mark tasks done. A merge
  refused for a conflict must stop the cleanup chain.
- **Gate with the full suite, not the first failure.** When a known-failing test target exists,
  run every target (`cargo test --no-fail-fast`, `jest --bail=false`, and so on) and diff the
  per-target failure set against main. A runner that stops at the first failing target hides
  every target after it. A mass rename can also rewrite deliberately invalid test fixtures into
  valid ones, so read the test diff, not just the result.
- **Never feed parsed command output into `rm`, `mv` or delete loops.** Handle each named
  path explicitly after looking at it, and never act on a directory you didn't create. After
  you kill a destructive job, kill its children too: a `mv` across mounts copies first and
  keeps running after its parent dies.
- **Subagents that "wait" may be asleep.** A worker that ends its turn waiting on its own
  background job often has nothing running and never wakes. Check that the worker's processes
  are alive each tick and resume it if not. Tell workers never to end a turn idle: poll with
  short foreground checks instead.
- **Isolate shared state in tests.** Tests use their own save and user directories, never a
  default slot or a directory other runs share. A stale prompt or a leftover profile in shared
  state turns into false failures, or false passes, far from the real cause.
- **Hold a host lock around one command, never a shell.** Wrapping a shell or script in an
  exclusive lock lets a nested request for the same lock deadlock every job on the host.
- **Keep the task board true.** Claims, releases and completions happen as workers start,
  stop and merge, and the committed queue view is re-rendered with them (see `/queue`,
  `queue check-view`).

## Knowledge state: typed and evidenced, not prose

Prose that a script parses is an accidental database, and a claim nobody re-checks is a rumor.
Full rationale and pilot plan: [`docs/knowledge-architecture.md`](docs/knowledge-architecture.md).

- **Lifecycle state lives in typed fields, not acceptance prose.** Branch, plan, PR, evidence and
  decision references are written with the queue CLI's typed setters (add one if it's missing),
  never as markers such as `BRANCH:` appended to the acceptance text. Scripts read those fields.
- **Done requires evidence.** A task is done only with a recorded PR, test ids, the commit they
  passed at and their scope. Evidence goes stale when the files it covers change. Check existing
  evidence before dispatching, so finished work isn't rediscovered.
- **Record decisions when they are made.** Each owner decision gets one home with an id, the
  owner's words, scope, status and supersession, plus a code reference or a reproducible
  measurement. Record it before replying, because chat summaries are lossy. Everything else cites
  the id. An unmeasured claim is marked unverified.
- **Generate hook points; don't hand-write them.** Code locations come from code at a named
  commit, and plans state intent and gates. Workers own the details and write discoveries back.
- **Never keep project facts only in harness-private memory.** Facts every worker needs live in
  the repo, readable by every harness. Private memory holds harness preferences only.

## Owner status reports (remote owner)

When the owner is away and asks for status reports, the session's **orchestrator** sends one report a
day at the owner's requested local time (default 8am), covering the previous 24 hours, through the
client's scheduler (confirmed by a successful tool call; re-arm session-scoped schedules on resume) and
mail integration (fallback: a private page or the PR/issue thread). Never send a duplicate. Before
sending, bring the project's public surfaces up to date for every merge in the window. Contents, with
links: **merged into main**, **in progress**, **needs your decision** (with a recommendation), **problems
and risks**, **live links**; unmeasured is "not measured". Merging never waits for the report. Record the
schedule and surfaces in the handoff/policy file so another harness continues it. Per-harness mechanics
(e.g. Claude Code `CronCreate` + Gmail `send_message`) are in the full text.
→ full text: [`docs/agents-detail.md`](docs/agents-detail.md#owner-status-reports-remote-owner).

## Understand the shape of the problem first

Before committing to a solution, map the **shape of the problem** — the
dimensions it balances and where the real tension lives — instead of jumping to
the first approach or flattening a complex problem to one axis. Name the axes
(cost, speed, risk, reversibility, clarity…), find where the frontier sits, and
recommend from that mapped space, not a hunch. A general stance — design,
refactors, debugging, decisions alike, not just formal councils (`/council`
applies it in framing). Surfacing the shape is also what lets the user steer
early.

## Durability tiers — match rigor to what the code is

Classify before building and state the tier with the feature slug. **Disposable** (cheap failure,
replaced by prompt, a leaf, short-lived): optimize for speed, skip ceremony (`/ponytail`), keep it a
leaf. **Durable** (data loss/security/downtime, inbound dependents, long-lived): the full chain and every
gate, strict types, explicit boundaries, deterministic tests with in-memory fakes. Durable never imports
disposable; when unsure, it's durable. Tiers are a stated judgment, not yet a gate.
→ full text: [`docs/agents-detail.md`](docs/agents-detail.md#durability-tiers--match-rigor-to-what-the-code-is).

## Veracity — "done" means reachable, not just built

"Done" means an **unbroken call path from a user entry point to the code**. Grep for real (non-test)
callers before claiming or reporting it; a green unit test on an unwired module is a false signal, so
user-facing work needs a live-path test. **Capacity ≠ capability.** Verify a user's stated capability
against the code (`file:line`) before building on it. Report faithfully when the last mile didn't ship.
**Never self-label** "honest / honestly / transparent / to be clear / frankly": state the fact and show
what backs it. Reviewers enforce the code side via the rubric's *Vestige & Layering* R5 and `/validate`.
→ full text: [`docs/agents-detail.md`](docs/agents-detail.md#veracity--done-means-reachable-not-just-built).

## Deterministic first — code over model judgment

Anything decidable explicitly or algorithmically is done by **code**, not an LLM: a script, lint
rule, type, schema, test or CLI gives the same answer every run and can gate CI. Before asking a model
to check, count, compare, parse, format, route or validate, ask whether a tool can; promote repeated
judgment to a check (`[mechanical]` rubric items); model output that drives a decision passes a
deterministic gate; mechanical results win on conflict; keep gates near-zero false-positive; skills put
deterministic steps in their script and only judgment in prose.
→ full text: [`docs/agents-detail.md`](docs/agents-detail.md#deterministic-first--code-over-model-judgment).

## Default language

New code — source, scripts, tooling — uses the language declared in **`.agent/default-language.md`**
(read it before writing code). Absent or `unset`: match the existing codebase. The only exception is a
**hard blocking need** (a tool whose loader requires another format, e.g. `eslint.config.mjs`): get
explicit approval first and note the reason in a comment at the top of the file. The file is
consumer-owned; scaffold never syncs it.
→ full text: [`docs/agents-detail.md`](docs/agents-detail.md#default-language).

## Modern web platform code

Before writing or reviewing browser-facing code — HTML, CSS, client-side JS, or
components that render to the DOM — run `/modern-web`. It uses the harness's
native [Modern Web Guidance](https://developer.chrome.com/docs/modern-web-guidance)
plugin where one exists and the npm CLI otherwise. Skip it for backend, CI, and
non-browser code. A repo may record a `**Browser Support:**` line anywhere in
this file to override the guides' Baseline default.

## Minimum Viable Diff

Prefer the smallest change that achieves the goal: targeted edits, existing structure and naming
preserved, no opportunistic refactors or style rewrites (surface them separately); ask before a diff
larger than ~30 lines. → full text: [`docs/agents-detail.md`](docs/agents-detail.md#minimum-viable-diff).

## Feature-chain workflow

Non-trivial features run `/feature-chain` (or each phase alone): **Design** `/grill-with-docs` →
`design.md` with Q&A, decisions and a canonical vocabulary, then `/design-review` (auto-fix) →
**PRD** `/to-prd` → `prd.md` → **Plan**: vertical slices (data → logic → UI → tests) in `plan.md`,
granularity confirmed once → **TDD** `/tdd`: RED → GREEN → REFACTOR per slice, then `/code-refiner`, then
`/qa` when there is a user-facing entry point; keep `tdd-log.md`. **Stop** any time on "stop", "pause" or
"just answer". → full text: [`docs/agents-detail.md`](docs/agents-detail.md#feature-chain-workflow).

- **Artifacts:** one folder per feature, `./docs/<feature-slug>/` (`design.md`, `prd.md`, `plan.md`,
  `tdd-log.md`); state the slug (kebab-case, no articles, under ~30 chars) before the first file.
  → [`docs/agents-detail.md`](docs/agents-detail.md#artifacts--one-folder-per-feature).
- **Commits, one per step:** `docs(<slug>): design Q&A and vocabulary` · `docs(<slug>): PRD` ·
  `docs(<slug>): implementation plan`; per slice `test(<slug>): slice N red — …`,
  `feat(<slug>): slice N green — …`, `refactor(<slug>): slice N — …` (only if it happened).
  → [`docs/agents-detail.md`](docs/agents-detail.md#git-commits--one-per-step).
- **Retry from the prior artifact:** bad slice → revert it and re-run from `plan.md` slice N; plan off →
  re-plan from `prd.md`; PRD gap → extend `design.md`, rewrite `prd.md`; term drift → update the
  vocabulary, then propagate. → [`docs/agents-detail.md`](docs/agents-detail.md#retry-semantics).
- **Skip the chain for:** bug fixes under ~10 lines, one-off scripts or prototypes, config edits /
  dependency bumps / lint fixes, doc-only changes, or "just write it", "no tests", "quick fix".
  → [`docs/agents-detail.md`](docs/agents-detail.md#what-this-doesnt-apply-to).

## Proactive file-length maintenance

**Never trim comments, densify code or hold back a useful edit to fit a length limit** — that is an
antipattern. The limit is a signal to **split at single-responsibility seams** (behavior-preserving, tests
green). Escape hatch, sparingly: for a genuinely indivisible unit, an inline `quality-ok: file-length —
<reason>` pragma on the first non-shebang line, citing why.
→ full text: [`docs/agents-detail.md`](docs/agents-detail.md#proactive-file-length-maintenance).

## PR Workflow

**One independent task per PR/merge cycle.** Finish acceptance, validate locally, open/update its PR,
verify real required hosted checks on the final head, then merge **only with explicit session or
standing project authorization** (creating a PR does not authorize merging). A failed gate stays part of
the current task; never grow the branch with another feature. Confirm the merge and cut a fresh branch
before the next task. Only the root integrates, pushes and merges. Opt-in legacy batch delivery:
`queue config deliveryMode batch` (see `skills/queue.md`). → full text: [`docs/agents-detail.md`](docs/agents-detail.md#pr-workflow).

1. Pull latest main: `git checkout main && git pull origin main`
2. Create a clean branch: `git checkout -b <prefix>/<short-descriptive-name>`
3. Do the work, verify with build/tests
4. Commit, push: `git push -u origin <branch>`
5. When changes are ready for review, run `/create-pr` — it creates the PR and subscribes where supported, or checks CI with `gh` and reports the monitoring limit.
6. Before merging, verify the green is **real** (see below).
7. On a `<github-webhook-activity>` merge event: run `git checkout main && git pull origin main` automatically, then confirm main is up to date.

**A green PR is not always green — required checks can fail *open*.** GitHub treats
a **skipped** required status check as **satisfied**. So a required check that is an
aggregate roll-up job (`needs:` a matrix/shard set, no `if: always()`) *skips* when
a dependency fails — and the gate passes silently. (Same for path-filtered or
`if:`-gated required jobs that never run.) Before merging:

- **Read the actual check conclusions, not the merge button.** Treat a lingering
  `skipping` on a *required* check as suspect, not as a pass.
- **Capture the watch command's own exit**, not a wrapper's:
  `gh pr checks <pr> --watch; echo "EXIT=$?"` — a surrounding shell/echo can mask a
  failure with exit 0.
- **If you own the CI, make roll-ups fail *closed*:** `if: ${{ always() }}` forces
  the job to run, plus a guard step that exits non-zero unless every dependency
  succeeded (`needs.*.result != 'success'`).

Never commit directly to main for feature work.
A session spans the full lifetime of a branch — from creation until it is merged or discarded. Only switch branches after the current feature branch is merged or the user explicitly asks; keep committing to the current branch until then. The one permitted exception is checking out main solely to pull and immediately create a new feature branch.
Start a fresh branch off main when no active feature branch is being resumed.

## ONE Working Branch — fan-out integration (NON-NEGOTIABLE)

**A session has EXACTLY ONE working branch** — the current task’s feature branch, rotated only after its authorized merge.
Code, assets, docs, lore, ledgers — *everything* lands on that one branch. This is the
single most important operational rule when fanning out; violating it silently splits the
project in two.

- **Lanes work in isolated git worktrees** (`isolation: "worktree"`), each branched off the
  ONE working branch, and gate their own diff.
- **The orchestrator merges each lane into the ONE working branch LOCALLY the moment that lane
  completes** — not into a separate "integration" branch, not batched "later". One completed
  lane → merge/rebase its worktree branch into the local one branch → resolve → delete the worktree →
  mark the ledger. Do it before spawning the next thing. (Pushing to GitHub is a SEPARATE, controlled,
  batched step by the orchestrator — see the push rule below.)
- **Refresh a lane against its integration target before integrating it.** The target is
  whatever this repo's delivery mode integrates into: main under per-task merges, a shared
  working branch, or a branch left open for a separate review process. That target keeps
  moving while the lane runs, and two lanes that each pass on their own can break when
  combined. Before opening the lane's PR or integrating it:
  1. **Merge** the current target into the lane branch, as one merge commit with one
     conflict resolution. Don't rebase a long lane branch: rebasing replays every commit
     and can hit the same conflict once per commit.
  2. Re-run the gates **on the merged result**, not on the lane's old base. That means
     lint over every target, including test code; the full test suite of every touched
     package (not only the new tests); and a regeneration of any derived artifacts the
     change affects (generated guides, manifests, lockfiles). Commit any regenerated files.
  3. Integrate only when that merged result is green. Hosted CI then confirms main
     instead of discovering the combination failure. Short-lived lanes drift less, so
     integrate each lane as soon as it finishes.
- **Retire completed artifacts at integration.** Preserve required source and unique
  evidence with a durable index before removing verified-ended lane worktrees and
  merged branches; clear ended display state through existing queue lifecycle commands.
  After the authorized main merge, verify no unique commits before retiring the task
  branch. Keep generated state ignored and completed narrative archived; retain active
  scope, dependencies and evidence links. See [integration cleanup](skills/queue-drivers.md#integration-cleanup-all-delivery-modes).
- **Reap zombie worktrees after an interrupted session.** The normal merge step deletes
  each lane's worktree. A session that ends abruptly skips that step: weekly usage runs
  out, the harness crashes, or the machine power-cycles. The lane's worktree is then left
  half-done. Sometimes it's still registered with unmerged commits; sometimes it has
  dropped out of `git worktree list` (after `git worktree prune`, or in a harness-managed
  isolation dir such as `.claude/worktrees/agent-*`) while its directory stays on disk with
  every ignored and untracked build output. In one consumer repo, ten such zombies quietly
  held 146 GB. On session start or resume, and on each loop tick, list the worktree roots
  owned by this session and flag each directory with its size and age. Staleness
  never grants authority over another session; verify ownership and actual worker end
  before cleanup:
  - Registered with unmerged commits: **finish or merge the lane** (don't lose the work).
  - Registered and clean: remove only after verifying owned worker end and preserving unique evidence.
  - Unregistered: check for unique, non-reproducible content before deleting, and get the
    user's OK when it isn't clearly reproducible.
- **The orchestrator commits ALL of its OWN work — ledgers, queue, docs, lore, web, hotfixes —
  to that SAME ONE branch**, never to a different branch than the lanes merge into.
- **NEVER run two long-lived branches at once** (e.g. an "integration" branch *and* an "asset"
  branch; a "code" branch *and* a "docs" branch). If a prior session handed you two, your FIRST
  act is to consolidate them into one before any new work.
- **Self-check every few lanes / whenever you notice you've pushed to a branch name:** *"Is
  more than one branch accumulating commits this session?"* If yes — **STOP and merge them now.**
  A code-on-branch-A / bookkeeping-on-branch-B divergence is a process failure, not a workflow.
- The one working branch is what the user plays, and what becomes the PR. It must ALWAYS hold
  both the lane code AND the orchestrator's bookkeeping — never one without the other.

### NO PUSH RACE — lanes commit LOCALLY, the orchestrator merges + gates + pushes

**Subagent worktree lanes NEVER `git push` to GitHub.** A lane commits to its OWN worktree branch and
reports; it does not touch `origin`. Telling a lane to `git push origin HEAD:<branch>` is a bug — it
creates a **push race** where N lanes pushing rapidly each trigger a full CI run and rapid pushes
cancel + cold-restart the slow gates, torching CI minutes. There is ONE pusher: the orchestrator.

Every time: (1) lane commits locally in its worktree, reports — no push; (2) orchestrator merges the
lane branch into the LOCAL one working branch, deletes the worktree; (3) orchestrator runs the CI
gates **LOCALLY as a pre-flight** (a fast local `make ci`/preflight of the same checks CI runs) and
fixes locally before spending a GitHub run; (4) orchestrator pushes to GitHub in **controlled batches**
(rebase-retry, never force). GitHub CI is a fast confirmation, not the failure-finder. The
orchestrator's own commits ride the same batched push. There is no second branch, and there is never a
push race.

## File Delivery

When the user asks to copy, download, or share a file, use SendUserFile when
available. Otherwise use the client's supported attachment or clickable file link
and state what was delivered. Do not substitute an inline dump for a file.
