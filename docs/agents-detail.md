<!-- // quality-ok: file-length — verbatim long-form archive of AGENTS.md sections; one reference unit, read by section anchor -->
# Agent guidelines — full text

The long-form text behind the compact sections of [`AGENTS.md`](../AGENTS.md). AGENTS.md holds the
rules; this file keeps the rationale, examples and per-harness detail verbatim. Each section here is
linked from its AGENTS.md section, and `scripts/check-agents-detail.ts` fails if a link or section goes
missing.

## Iterative Autonomous Enhancement — a core design principle

Iterative autonomous enhancement is a **core design principle** of this harness: a **loop** should
produce great improvements **without a human in the loop**. The agent closes the loop itself instead
of waiting for a human to judge each result:

> **produce → self-evaluate against the target bar → name the gap → improve → re-evaluate.**

- **Self-evaluate with a real signal, not vibes.** Ground every judgment in something observable: a
  measurement (timings, throughput, a gate's pass/fail, a state delta), a test, a reviewer pass, or an
  automated critique of the actual output (read the rendered result, the log, the diff — not a
  description of it). A "looks good" with nothing behind it is not an evaluation (see *Veracity*).
- **Prefer deterministic evaluators.** A loop judged by a test, a gate, or a measurement converges; one
  judged only by a model's opinion drifts. When a pass keeps making the same judgment, promote it to a
  check so the next pass is graded by code (see *Deterministic first*).
- **Ratchet, never reset.** No iteration may regress a measured gate: test count, a benchmark, a frozen
  lint baseline such as `eslint-suppressions.json`. Baselines only shrink; a pass that improves one
  thing by worsening another hasn't improved anything.
- **Count both costs of a change.** Each change risks an immediate defect *and* makes the next change
  harder to understand. Judge the second cost too: did complexity, coupling or file length rise? The
  structure a pass leaves behind is the next pass's context.
- **Name the target and the gap each pass.** State the quality bar, where the current output falls
  short, and the specific change that closes that gap; apply it and re-judge the same way.
- **The loop is the deliverable, not a single pass.** build → evaluate → fix → re-evaluate; measure →
  optimize → re-measure — repeat until the output meets the bar or you hit a real blocker. One-and-done
  is not enhancement.
- **Each iteration is gated + committed** so the stream stays inspectable and safe to stop at any commit
  (see *Continuous execution*). Stage output for review; never publish or merge to main without the
  user's approval.
- **Human steering refines the target; it does not gate each iteration.** The user redirects *what*
  "great" means and *which* subject matters; the loop improves on its own between those redirects. A
  loop that needs a human to approve every step is expensive manual review, not autonomous enhancement.
- **Guardrails that keep autonomy safe:** plain self-assessment (the measurement, test, or critique
  backs every "improved"; never self-label the work "good"); **cap iterations and bail on
  non-convergence**, escalating a real blocker to the user *with the evidence* rather than spinning (a
  stuck loop is a report, not more identical passes); no brute-force sweeps of variants when a few
  candidates plus a judgment will do; reversible, staged output.

This is why the orchestration loop exists: given a target and the tools (build, test, measure, review),
the agent drives a subject from "first pass" to "great" across many **self-judged** iterations,
surfacing to the user the staged results and any real blocker, not a decision at every step. Related:
*Continuous execution* (the commit is the checkpoint) and *Veracity* (evidence, not claims).

## Responsiveness & Steerability

The user can see when a path is wrong even when it's technically valid; the interface exists so they
can steer. Optimize for **being steerable**, not for autonomous completion. A user who can't redirect
you is paying for expensive autocomplete.

### Answer the user first

- Address a message that arrives mid-work **before resuming** your prior agenda. Never finish a long
  self-directed run and treat their message as an afterthought.
- Keep turns tight (fewer tool calls between check-ins) so there are frequent moments to listen. Don't
  go heads-down for ten steps.
- If you're about to go quiet for a while, **say so first.**
- Harness limit: a single in-flight tool call can't be preempted; the instant it returns, their message
  is the priority. (The user can press `Esc` to interrupt, but they shouldn't have to.)

### Surface direction before building

- Show the **fork, the tradeoff, and the cost before** committing effort, so the user can veto at the
  cheap moment instead of after a rebuild.
- **Flag your own over-engineering.** If a simpler path exists, name it first; don't make the user
  catch it.
- Before recommending on a multidimensional problem, **map its shape first** (see *Understand the shape
  of the problem* below).
- Prefer **reversible moves** so course-correcting costs a sentence, not a redo.
- **Open each loop with a one-line contract**: the target bar, the signal that judges it, the durability
  tier, and the iteration cap. The user steers that line (the cheapest moment to redirect) instead of
  approving each pass.

### The user's judgment is the tiebreaker

- "Wrong path" from the user is **decisive.** Don't defend a valid-but-wrong direction because it
  technically works.
- **"Technically possible" is not "right."**

### Why

A human in the loop is valuable because they can see the wrong path while it's still cheap to change.
Ignoring them, or steamrolling them with a technically valid but unwanted approach, defeats the reason
the interface exists.

## Continuous execution (loops & "build until done")

When given a standing directive to work autonomously toward a goal (an explicit `/loop`, "build until
done / until all slices pass", or a similar until-condition), run **continuously**, not in
artificially paced bursts:

- **Do the work in-turn; the commit is the checkpoint.** The progress marker is a committed, tested
  slice, not a scheduled wakeup. Keep going slice by slice within the turn; each commit survives a
  turn/context boundary.
- **Don't insert a `ScheduleWakeup`/timer delay to *pace* self-contained work.** A wakeup delay is for
  *waiting on something you can't act on right now*, not for spacing out your own code→test→commit,
  which has nothing to wait for. A timer IS correct in three cases:
  - **External gating:** CI finishing, a deploy, a remote queue. Pick the delay from how fast that
    state actually changes.
  - **Usage-limit windows:** when closing in on 100% of the rolling 5-hour usage limit, schedule a
    wakeup to resume after the window resets. This keeps long/overnight autonomous runs going: spend
    the budget, then sleep until it refills and continue.
  - **Crash-safety net:** if a turn ends with work remaining, re-arm with the minimum delay so the loop
    survives; never as cadence.
- These timer rules apply only when the client exposes scheduling. Without it, keep working in-turn; at
  a real limit, checkpoint and state how to resume. Never claim a background restart has been armed
  without a successful tool call.
- **Steering always preempts.** Handle a mid-turn user message before resuming (see *Responsiveness &
  Steerability*). "Unless I'm actively steering" is the point: continuous ≠ uninterruptible. Stop or
  redirect the instant the user speaks.
- **One reviewable unit at a time, fully gated.** Each slice goes RED → GREEN → REFACTOR and passes the
  full gate (tests + typecheck + quality gate) before its commit, so the stream stays inspectable and
  safe to stop at any commit.
- **Supervise background work by progress, not liveness.** When a tick checks on running jobs, "the
  processes exist" is not health. A job can be alive and stuck: in a retry/wait loop, or blocked on a
  lock or a shared budget someone else holds. Each tick, answer with evidence:
  - **Did it advance since the last tick?** Compare a progress counter (items finished, commits, CPU
    time used) against the last reading and the expected rate. Nothing finished in a window that
    should have produced output is a finding, not a wait.
  - **What is each job doing right now?** Look at the leaf process or current step. A `sleep` inside a
    retry loop is waiting, not working.
  - **Is anything orphaned?** Look for helpers whose launcher died, such as display servers, workers,
    or locks; they keep holding reservations, ports, or disk. A reparented orphan may not show PID 1 as
    its parent (on WSL it's a `Relay(N)` process).
  - **Who holds the shared budget?** Account for memory/slot/lock reservations against their limit.
    Stale holders starve new work without failing anything.

  Encode these as a small probe script run every tick that exits non-zero on anomalies, and
  investigate each anomaly before ending the tick. A human asking "how's X holding up?" is this probe;
  don't wait for them to ask it.
- **Never idle while described work is unbuilt — run the built-vs-described audit.** Before concluding
  "the queue is exhausted / nothing to do," compare, per category of work the user asked for, what
  **exists and is reachable** (code that runs, features wired to an entry point, tests green) against
  what is only **described** (a spec, a design doc, a queued task, a TODO). Every gap is ready work: a
  spec with no implementation → **build it**; a described capability with no wiring → **wire it**; a
  documented interface with no caller → **connect it**. "Exhausted" means *built and reachable*, not
  merely *written down*. "The user might want it slightly different" is no reason to idle: produce a
  reasonable first pass, stage anything user-facing for review, and keep going. Steering *refines* the
  work; it is not a prerequisite for starting it.

## Context hygiene — validate, compact, curate, prune

A model's attention budget is finite, and quality degrades as the context fills ("context rot").
An agent also treats its own earlier notes as ground truth. Four failure modes follow, each with
one countermeasure (after IBM Technology's *Context Engineering for AI Agents: 4 Failure Modes to Avoid*).

- **Poisoning → validate.** One misreading ("the new driver retries on its own") gets written down,
  and every later step builds on it. Before a conclusion enters a handoff, plan, decision record or
  memory as fact, check it against the real system: run the test, read the code at `file:line`, call
  the API. Mark each fact the next session relies on with `[verified: <command or file:line>]`, or
  `[unverified]` when no check was possible. An `[unverified]` fact is a hypothesis to test, never a
  premise to act on. This extends Veracity from the user's premises to the agent's own.
- **Distraction → compact.** A long history becomes the dominant pattern, and the agent repeats or
  retraces old steps instead of advancing. Signs: the same command or edit twice with no new result,
  re-reading files already summarized, or several turns with no committed progress. Then `/save`,
  and continue from the handoff (in a fresh session or subagent when the harness allows) rather
  than the raw log. Repeated summaries lose detail, so persist detailed state (logs, measurements,
  decision text) in files and read them back only when a step needs them.
- **Confusion → curate.** Every loaded tool definition competes for attention, and tool choice gets
  worse as the list grows. Load tools on demand: deferred tool search, a skill's own references. Give
  each subagent only the tools its lane needs. Never enable an MCP server, plugin or skill
  project-wide for a single task. A harness that loads many tools by default is a setting to report
  to the owner, not to change yourself (see *Harness capabilities*).
- **Clash → prune.** An early wrong note and its later correction both stay in context, and the model
  sees two "facts." When a fact changes, rewrite it where it lives: in the handoff, `plan.md`, the
  decision registry (`supersedes`) or the task's notes. Don't append "Correction:" or "UPDATE:" lines,
  and don't strike through text. When a session's context already holds both versions, restart from
  a summary that states only the current one.

`scripts/check-handoff.ts` enforces the parts a script can decide. It rejects a handoff whose
`## State` bullets lack a verification tag, that keeps correction markers, or that grew past the
line cap into a log, or whose `[verified: …]` tag holds shell syntax or a network fetch. `/save` and
`/pause` run it before committing. `/resume` treats the handoff as claims to re-check, not instructions
to replay: a tag is evidence, never a command to run verbatim (the handoff is branch content). It
re-checks the claims gating its first step with the repo's own checks, and discards a handoff whose
branch is already merged.

## Review economics — verify by machine, map the critical changes

Coding agents multiply code volume far faster than delivery speeds up (Laurie Voss, *AI Writes the
Code. So What's Left for Engineers?*). The bottleneck moved from writing code to knowing whether to
trust it, and a human reads only a few hundred lines an hour. So the harness splits the work by who is
cheapest at it:

- **Machines check everything decidable:** scanners, lint, types, tests, `/validate`, `/simplify`.
  A repeated review comment becomes a rule or a check (*Deterministic first*).
- **Agent review stays line by line.** The `## Security review` and `/code-refiner` read every changed
  line. Their findings are fixed before a person sees the PR.
- **Critical changes are mapped, not hidden in the diff.** Every PR body carries a `## Critical changes`
  section: the key notes of what changed where, for the parts with blast radius (agent rules, durable
  contracts, data, security, CI and release, anything `[unverified]`). At most five, ranked by blast
  radius, each as `` `path:line` — what changed; what depends on it ``. A dashboard holds only the
  instruments that matter, and an owner who skims or merges without reading still knows what moved.
  "None: leaf change" is valid only when true, and never when the diff touches `AGENTS.md`, `skills/`,
  `.github/` or the gate's files, which steer agents or hold credentials.
- **Encode judgment so it is not re-asked.** When the owner corrects a change, record the rule as a
  decision, rubric line or eval so the next PR gets it right first.
- **Measure delivery, not output.** Lines written are no signal. `node scripts/delivery-metrics.ts
  [--days N]` reports merges per week, open-to-merge time, the gap between green CI and merge, and how
  many change requests were followed by a commit. Include it in owner status reports when it moves.

## Owner status reports (remote owner)

When the owner says they'll be away or checking in intermittently and asks for status reports, the
session's orchestrator owns the report, whichever harness is orchestrating (Claude Code, Codex, pi or
another client). Subagents never send it.

- **Schedule.** Send one report a day at the owner's requested local time
  (default 8am in the owner's timezone). It covers the previous 24 hours. Use the
  client's scheduler (a cron or wakeup tool) and confirm with a successful tool
  call; never claim a schedule exists without one. Session-scoped schedulers
  expire, so state the expiry and re-arm it when resuming a session.
- **Channel.** Use the client's mail integration (for example a Gmail connector's
  send tool) to the owner's own address. With no mail tool, publish the report
  where the owner already looks (a private artifact or page, or the PR/issue
  thread) and say which. Send exactly one report per day; never send a duplicate
  after a resume.
- **Before sending, bring public surfaces up to date.** For every merge in the
  window, make sure the surfaces the project policy names are current: landing
  page, dev blog, experiments, model galleries. Ship any gap as its own small
  merged change, deployed and checked in a real browser, before reporting.
- **Contents.** Keep it skimmable and factual, with links:
  1. **Merged into main:** PR number, title, one plain-language line each.
  2. **In progress:** lanes and tasks, with their state.
  3. **Needs your decision:** each item with a recommended option.
  4. **Problems and risks:** failing checks, regressions, blocked work.
  5. **Live links.**

  Report what the evidence shows. Unmeasured is "not measured", not "fine".
- **Merging continues between reports.** The report summarises per-task merges; it
  never batches or delays them.
- **Persistence.** Record the requested time, the address source and the surfaces
  to update in the project's handoff or policy file, so a different harness
  taking over orchestration keeps sending the same report.
- **Claude Code specifics.**
  - Schedule with `CronCreate` (a recurring 5-field cron in local time). Pick an
    off-minute just before the hour, e.g. `57 7 * * *` for an 8am report.
  - `CronCreate` jobs are session-only and expire after 7 days. Re-create the
    job on every session resume (check `CronList` first, so it's never doubled),
    and tell the owner the expiry.
  - Send with the Gmail connector's `send_message` tool, using an `htmlBody`.
  - Fallback: a private page via the `Artifact` tool, with the link sent through
    `SendUserFile` or `PushNotification` when they are available.
  - In bypass-permissions mode the mail tool may still prompt. Tell the owner
    they can allow that one tool once.

  Other harnesses (Codex, pi) document their own scheduler and mail tools here.

## Durability tiers — match rigor to what the code is

Quality practices exist so the code can be understood and safely changed. How much rigor that takes
depends on where the code sits between **disposable** and **durable**. Classify before building, and
state the tier with the feature slug so the user can correct it cheaply:

| | Disposable | Durable |
|---|---|---|
| Failure costs | an annoyance | data loss, security, downtime |
| Replacement | minutes to hours by prompt | weeks, with migrations |
| Inbound dependencies | none (a leaf) | other code relies on its contract |
| Lifetime | one session or one use | maintained for years |

- **Disposable:** optimize for speed, skip ceremony (`/ponytail`), and keep it a leaf.
  Durable code never imports disposable code.
- **Durable:** the full chain and every gate, with strict types and errors rather
  than warnings, explicit module boundaries, and deterministic tests that use
  in-memory fakes at external boundaries instead of network mocks.
- **When unsure, it's durable.** Throwaway code that gains a dependent has been
  promoted, and it inherits durable rigor at that point.

Tiers aren't recorded or enforced mechanically yet. Until a typed field and an
import-boundary rule exist, the tier is a judgment you state, not a gate.

## Veracity — "done" means reachable, not just built

A feature is not done because it compiles and its unit tests pass. It is done when there is an
**unbroken call path from a user entry point (button, route, CLI) to the code**. Reachability is the
deliverable; existence is not. Never state a feature as done, live, or working when it is
built-but-unwired.

- **Before claiming a feature done, or reporting status on one, grep for real callers** of the new code
  (e.g. `grep -rn <symbol> src/ | grep -v test`). Zero non-test callers means it is **unwired**: report
  it exactly that way, not "done." A green unit test proves a unit works, not that the feature is
  reachable.
- **A test on an unwired module is a false signal.** For anything user-facing, require at least one
  test that exercises the *live* path, not just the pure module. Treat "tested but unreachable" as a
  defect, and say so.
- **Capacity ≠ capability.** "14 seats" is not "14 players" if 12 are bots. When reporting scale or
  multiplayer claims, name what fills each slot; never infer delivered capability from data-model
  capacity.
- **Verify user premises against the code.** When the user states a capability as fact ("PvP hosts
  7v7 now"), confirm it in the code before building on it; before extending an inherited capability,
  check the last mile shipped (wiring, UI, signaling), not just the core. Long-lived projects
  accumulate beliefs that drifted from reality; surface any gap with a `file:line` citation.
- **Report faithfully.** If the last mile didn't ship, say so plainly. Never present built-but-dead as
  delivered.
- **Don't label your own reporting "honest."** "Honest," "honestly," "the honest truth," "to be
  honest," "honest status/assessment" are claims *about yourself*, not properties of the statement;
  announcing honesty neither makes a claim accurate nor adds information. When every update is tagged
  "honest," the word means nothing and implies the untagged ones weren't. State the fact and show what
  backs it (the `file:line`, the measurement, the failing test output). Reserve "honestly" for the rare
  case where it does real work (flagging that you're now *contradicting* an earlier claim of your
  own), never as a preface or intensifier. Same for "transparent," "to be clear," "frankly," and
  similar self-congratulating hedges.

Reviewers enforce the code side of this via the rubric's *Vestige & Layering* R5
("liveness is the call graph, not tests") and `/validate`'s test-integrity pass.

## Deterministic first — code over model judgment

Anything that can be decided explicitly or algorithmically is done by code, not by an LLM. A script,
linter rule, type, schema, test or CLI gives the same answer every run, costs nothing per call, and can
gate CI; a model's judgment does none of those. Reserve LLM judgment for what needs it: intent, naming,
design tradeoffs, prose quality, ambiguous root causes.

- **Before asking a model to check, count, compare, parse, format, route or
  validate, ask whether a tool can.** File length, import boundaries, magic
  literals, formatting, schema shape, stale generated files, version bumps and
  dependency direction are rules — encode them as rules (lint config, a `scripts/`
  check, a type, a test) and gate on them.
- **Promote repeated judgment to code.** When you or a reviewer prompt keep applying
  the same call, turn it into a check. A rubric criterion a script can decide is
  marked `[mechanical]` and enforced by `check-quality-mechanical.sh` or a linter,
  not by a reviewer reading for it.
- **Model output that drives a decision passes a deterministic gate.** Parse it
  against a schema, run the tests, diff it against the expected result — never act
  on free-form model text that a check could have validated.
- **Mechanical results win on conflict.** A failing lint, type check or test is not
  overridden by a reviewer's "looks fine"; mechanical violations are fixed (see the
  rubric's override rules).
- **Keep deterministic gates near-zero false-positive.** A noisy rule teaches agents
  to ignore it. Narrow or remove it rather than leaving it as an unenforced warning.
- **Skills follow the same split.** The skill's script does the deterministic steps
  (enumerate, compute, write, verify); its prose carries only the judgment calls.

Related: *Knowledge state* (typed fields over parsed prose) and *Veracity*
(evidence, not claims).

## Default language

This repo's default language for new code (source, scripts, and tooling) is declared in
**`.agent/default-language.md`**. Read that file at the start of any task that writes code and honor
it:

- **When it names a language,** write new code in that language and file format by default. When a
  task could be done in several languages, choose the declared one; do not introduce another language,
  extension, or a second runtime just because it's conventional elsewhere.
- **When the file is absent, or declares the language `unset`,** there is no repo default: infer the
  language from the existing codebase and match what's already there.

The only exception is a **hard blocking need**: a tool whose own loader or runtime *requires* a
different language/format (e.g. `eslint.config.mjs`: ESLint's flat-config loader resolves the config
as an ES module and can't load a `.ts` file directly). When you hit one, **stop and get explicit
approval before adding the off-language file**, and note the reason in a comment at the top of it.
"It's a script, X is conventional" is not a blocking need; use the declared language.

**Setting the default (per repo).** `.agent/default-language.md` is consumer-owned: scaffold does not
sync or overwrite it, so each repo sets its own. Create it with a level-1 heading naming the language,
then a sentence or two on the file extension, how code runs, and any formats to avoid. To opt out of a
repo default, omit the file or write `# Default language: unset`.

## Proactive file-length maintenance

**Never trim comments, densify code, or hold back a useful edit to keep a file under the length limit;
that is an antipattern.** It trades clarity for a line count. Do not tell the user to "be lean here" to
preserve file size, and do not do it to your own edits.

The limit is a signal to **split the file into cohesive modules at single-responsibility seams**
(behavior-preserving, tests green), not a budget to cram within. When a file grows near the limit,
extract modules.

**Escape hatch, used sparingly.** When a file is *one cohesive unit* (every candidate seam is shallow
and a split would scatter one concept across files, e.g. a model/schema/state-machine over a single
type), an inline `quality-ok: file-length — <reason>` pragma on the first non-shebang line is
preferable to an arbitrary split that fragments the concept. A real seam always wins over the override;
use it only when keeping the file whole aids comprehension more than splitting it, and cite why.

## Session Start

On your first response in a new session:

1. **Sync check** — Claude Code's `SessionStart` hook fetches `origin/main` and warns if
   the current branch is behind. If you see that warning, rebase before
   starting new feature work (`git rebase origin/main`) or pull if on `main`
   (`git pull origin main`). Without that hook, run `git fetch origin main`
   and `git rev-list --count HEAD..origin/main` explicitly. On a fetch failure,
   report that freshness is unverified and continue local work where possible.
2. **PR watch** — If the current branch has an open PR, subscribe to it with
   `subscribe_pr_activity`. Watch only this session's branch's PR, not PRs from
   other branches. If no subscription tool is available, inspect with
   `gh pr view` and `gh pr checks`; this is a snapshot, not a webhook subscription.
3. **Artifacts check** — Check `./docs/` for existing feature artifacts
   (`design.md`, `prd.md`, `plan.md`).

- **Artifacts exist:** resume artifacts relevant to the user's request. Acknowledge
  unrelated artifacts without blocking new work; ask only if intent is unclear.
- **No artifacts:** when the request is feature work (see *What This Doesn't Apply To*),
  start `/feature-chain` without asking permission. If the user's intent is vague or
  unstated, the grill (Phase 1) resolves it through Q&A. Do not ask a pre-question first.

## Minimum Viable Diff

Prefer the smallest change that achieves the goal.

- Single, targeted edits. Don't rewrite when a few-line change works.
- Preserve existing structure, naming, and patterns unless a rewrite is asked for.
- No opportunistic refactors — surface them as separate suggestions.
- No style-preference rewrites. Working code stays as-is.
- When in doubt, ask before producing a diff larger than ~30 lines.

## Feature-chain workflow

Run `/feature-chain` to execute all phases automatically. Or invoke individually:

1. **Design** — `/grill-with-docs`. Interview one question at a time until
   the design tree is resolved. Produces `design.md` with Q&A, decisions, and
   a **canonical vocabulary**. Run `/design-review` (auto-fix mode) before
   advancing — patches `design.md` directly. Auto-advances to PRD when complete.

2. **PRD** — `/to-prd`. Synthesize context and codebase into `prd.md` without
   re-interviewing. Auto-advances to TDD when complete.

3. **Plan** — break `prd.md` into **vertical slices** (each cuts through all
   layers: data → logic → UI → tests). Output `plan.md`. Confirm granularity
   once before coding.

4. **TDD** — `/tdd`. Execute `plan.md` one slice at a time: RED → GREEN →
   REFACTOR. When all slices pass, run `/code-refiner` (auto-fix mode —
   parallel correctness + structural review, merged findings applied in one
   pass, then re-verified to 10/10), then `/qa` when the feature has a
   user-facing entry point (drives the running app, fixes what breaks, writes
   `qa-report.md`), before advancing to the review summary.
   Maintain `tdd-log.md` with per-slice status.

**Stop** the chain at any point by saying "stop", "pause", or "just answer".

## Artifacts — One Folder Per Feature

State the slug before writing the first file so I can correct it.

```
./docs/<feature-slug>/
  ├── design.md      # Q&A, decisions, scenarios, canonical vocabulary
  ├── prd.md         # full PRD
  ├── plan.md        # vertical slices
  └── tdd-log.md     # per-slice TDD status
```

Feature-slug rule: kebab-case, drop articles, keep it under ~30 chars.

## Git Commits — One Per Step

Commit each artifact before moving on:

- `docs(<slug>): design Q&A and vocabulary`
- `docs(<slug>): PRD`
- `docs(<slug>): implementation plan`

For TDD, commit per phase per slice:

- `test(<slug>): slice N red — <behavior>`
- `feat(<slug>): slice N green — <behavior>`
- `refactor(<slug>): slice N — <what changed>` (only if refactor happened)

## Retry Semantics

Each step's input is the prior step's artifact:

- Bad TDD slice → revert those commits, re-run from `plan.md` slice N.
- Plan off → re-plan from `prd.md`.
- PRD missed something → extend `design.md`, then rewrite `prd.md`.
- Terms drift → update vocabulary in `design.md`, then propagate.

## What This Doesn't Apply To

Skip the chain for:

- Bug fixes under ~10 lines
- One-off scripts or throwaway prototypes
- Config edits, dependency bumps, lint fixes
- Doc-only changes
- Anything where I say "just write it", "no tests", or "quick fix"

## PR Workflow

**Default: one independent task per PR/merge cycle.** Finish full acceptance, review and validate
locally, create/update its PR, verify real required hosted checks on the final head, then merge **only
with explicit session or standing project authorization**. Creating a PR does not authorize merging;
without that permission, preserve the ready PR and gate the next task. A failed gate remains part of
the current task; never grow the branch with another feature to defer it. Confirm the actual merge and
cut a fresh branch from updated main before the next independent task. Subagents may parallelize
subtasks of the current task; only the orchestrator integrates, pushes and merges. Explicit project
policy may opt into legacy batch delivery (`queue config deliveryMode batch`). See `skills/queue.md`
for runtime boundaries, migration and the `advance` acknowledgment.

1. Pull latest main: `git checkout main && git pull origin main`
2. Create a clean branch: `git checkout -b <prefix>/<short-descriptive-name>`
3. Do the work, verify with build/tests
4. Commit, push: `git push -u origin <branch>`
5. When changes are ready for review, run `/create-pr` — it creates the PR and subscribes where supported, or checks CI with `gh` and reports the monitoring limit.
6. Before merging, clear the handoff and verify the green is **real** (see below).
7. On a `<github-webhook-activity>` merge event: run `git checkout main && git pull origin main` automatically, then confirm main is up to date.

**A green PR is not always green: required checks can fail *open*.** GitHub treats a **skipped**
required status check as **satisfied**, so a required aggregate roll-up job (`needs:` a matrix/shard
set, no `if: always()`) *skips* when a dependency fails, and the gate passes silently. (Same for
path-filtered or `if:`-gated required jobs that never run.) Before merging:

- **Read the actual check conclusions, not the merge button.** Treat a lingering
  `skipping` on a *required* check as suspect, not as a pass.
- **Capture the watch command's own exit**, not a wrapper's:
  `gh pr checks <pr> --watch; echo "EXIT=$?"` — a surrounding shell/echo can mask a
  failure with exit 0.
- **If you own the CI, make roll-ups fail *closed*:** `if: ${{ always() }}` forces
  the job to run, plus a guard step that exits non-zero unless every dependency
  succeeded (`needs.*.result != 'success'`).

**Handoffs live only on branches.** `.pause/handoff.md` is the checkpoint for work in flight: `/save` and
`/pause` push it on the working branch, and lane merges into that branch keep it. Once the branch merges,
the work is done, and a handoff left on main would be read by the next `/resume` as current state (context
poisoning). So the orchestrator's last commit before merging to main is `git rm .pause/handoff.md`
(`chore: clear handoff before merge`). `node scripts/check-handoff.ts --pre-merge` must exit 0 on the head
being merged, and the merge uses that head (`--match-head-commit`). The decisions and facts it held belong
in the PR body, `design.md` or the decision registry, not in the handoff.

Never commit directly to main for feature work. A session spans the full lifetime of a branch, from
creation until it is merged or discarded. Only switch branches after the current feature branch is
merged or the user explicitly asks; keep committing to the current branch until then. The one permitted
exception is checking out main solely to pull and immediately create a new feature branch. Start a
fresh branch off main when no active feature branch is being resumed.

## Harness capabilities

These instructions support Claude Code, Codex, Cursor, Antigravity (agy), and pi.
Use the tools actually exposed by the current client; a named tool below is not
a guarantee that it is installed. User instructions take precedence over skill
defaults; infer routine choices from the repository and existing authorization.

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

Each session has exactly one orchestrator. Separate sessions may work concurrently, including in the
same repository, but they are independent owners. Never inspect, stop, reclaim, interrupt, or signal
another session's orchestrator, subagents, or a user-launched agent CLI as lifecycle targets. Read-only
aggregate resource checks may observe them, but process names, PIDs, terminals, queue owner labels,
lease timestamps, and worktrees never establish authority over them.

Only a lifecycle controller may terminate the exact child tree it created for its current generation,
and only on explicit cancel or timeout. Normal child completion must not send a cleanup signal. If
ownership is ambiguous, leave the process and worktree untouched, stop conflicting dispatch, and report
the conflict.

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
- **Subagents that "wait" may be asleep.** A subagent that ends its turn waiting on its own
  background job often has nothing running and never wakes. Check that the subagent's processes
  are alive each tick and resume it if not. Tell subagents never to end a turn idle: poll with
  short foreground checks instead.
- **Isolate shared state in tests.** Tests use their own save and user directories, never a
  default slot or a directory other runs share. A stale prompt or a leftover profile in shared
  state turns into false failures, or false passes, far from the real cause.
- **Hold a host lock around one command, never a shell.** Wrapping a shell or script in an
  exclusive lock lets a nested request for the same lock deadlock every job on the host.
- **Keep the task board true.** Claims, releases and completions happen as subagents start,
  stop and merge, and the committed queue view is re-rendered with them (see `/queue`,
  `queue check-view`).
- **Never park a worker branch.** Keep at most one branch (and worktree) per active subagent, plus
  main. Every branch a subagent worked on ends, in the same tick the subagent stops, in exactly one
  of three ways:
  1. **Complete:** merge it, then delete the branch and worktree once the commit is in main.
  2. **Partial but sound:** merge the gated progress and record in the task what remains. The task
     stays open.
  3. **Not mergeable yet:** send another subagent at the same branch to finish it.
  Marking a task "held" and leaving its branch, or saving a "WIP" commit for later, is not a
  resolution. Parked branches accumulate until nobody knows which work is live, which is stale and
  which still needs a decision. Preempting a subagent for a higher priority means merging its sound
  progress or making it that slot's next job, not leaving its branch behind. Deleting a branch that
  holds unmerged commits needs the owner's OK. Count branches each tick: more than active subagents
  plus main is a defect to fix before dispatching new work.

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
  commit, and plans state intent and gates. Subagents own the details and write discoveries back.
- **Never keep project facts only in harness-private memory.** Facts every subagent needs live in
  the repo, readable by every harness. Private memory holds harness preferences only.

## Understand the shape of the problem first

Before committing to a solution, map the **shape of the problem** (the dimensions it balances and
where the real tension lives) instead of jumping to the first approach or flattening a complex problem
to one axis. Name the axes (cost, speed, risk, reversibility, clarity…), find where the frontier sits,
and recommend from that mapped space, not a hunch. This is a general stance for design, refactors,
debugging and decisions alike, not just formal councils (`/council` applies it in framing). Surfacing
the shape also lets the user steer early.

## Modern web platform code

Before writing or reviewing browser-facing code — HTML, CSS, client-side JS, or
components that render to the DOM — run `/modern-web`. It uses the harness's
native [Modern Web Guidance](https://developer.chrome.com/docs/modern-web-guidance)
plugin where one exists and the npm CLI otherwise. Skip it for backend, CI, and
non-browser code. A repo may record a `**Browser Support:**` line anywhere in
this file to override the guides' Baseline default.

## ONE Working Branch — fan-out integration (NON-NEGOTIABLE)

**A session has EXACTLY ONE working branch**: the current task's feature branch, rotated only after its
authorized merge. Code, assets, docs, lore, ledgers — *everything* lands on that one branch. This is the
most important operational rule when fanning out; violating it silently splits the project in two.

- **Lanes work in isolated git worktrees** (`isolation: "worktree"`), each branched off the
  ONE working branch, and gate their own diff.
- **The orchestrator merges each lane into the ONE working branch LOCALLY the moment that lane
  completes**, not into a separate "integration" branch and not batched "later". One completed lane →
  merge/rebase its worktree branch into the local one branch → resolve → delete the worktree → mark
  the ledger, before spawning the next thing. (Pushing to GitHub is a SEPARATE, controlled, batched
  step by the orchestrator; see the push rule below.)
- **Refresh a lane against its integration target before integrating it.** The target is whatever
  this repo's delivery mode integrates into: main under per-task merges, a shared working branch, or a
  branch left open for a separate review process. It keeps moving while the lane runs, and two lanes
  that each pass on their own can break when combined. Before opening the lane's PR or integrating it:
  1. **Merge** the current target into the lane branch, as one merge commit with one conflict
     resolution. Don't rebase a long lane branch: rebasing replays every commit and can hit the same
     conflict once per commit.
  2. Re-run the gates **on the merged result**, not on the lane's old base: lint over every target,
     including test code; the full test suite of every touched package (not only the new tests); and a
     regeneration of any derived artifacts the change affects (generated guides, manifests,
     lockfiles). Commit any regenerated files.
  3. Integrate only when that merged result is green. Hosted CI then confirms main instead of
     discovering the combination failure. Short-lived lanes drift less, so integrate each lane as soon
     as it finishes.
- **Retire completed artifacts at integration.** Preserve required source and unique
  evidence with a durable index before removing verified-ended lane worktrees and
  merged branches; clear ended display state through existing queue lifecycle commands.
  After the authorized main merge, verify no unique commits before retiring the task
  branch. Keep generated state ignored and completed narrative archived; retain active
  scope, dependencies and evidence links. See [integration cleanup](skills/queue-drivers.md#integration-cleanup-all-delivery-modes).
- **Reap zombie worktrees after an interrupted session.** The normal merge step deletes each lane's
  worktree. A session that ends abruptly (weekly usage runs out, the harness crashes, the machine
  power-cycles) skips that step and leaves the lane's worktree half-done: either still registered with
  unmerged commits, or dropped out of `git worktree list` (after `git worktree prune`, or in a
  harness-managed isolation dir such as `.claude/worktrees/agent-*`) while its directory stays on disk
  with every ignored and untracked build output. In one consumer repo, ten such zombies quietly held
  146 GB. On session start or resume, and on each loop tick, list the worktree roots owned by this
  session and flag each directory with its size and age. Staleness never grants authority over another
  session; verify ownership and actual subagent end before cleanup:
  - Registered with unmerged commits: **finish or merge the lane** (don't lose the work).
  - Registered and clean: remove only after verifying owned subagent end and preserving unique evidence.
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
- The one working branch is what the user plays and what becomes the PR, so it must ALWAYS hold both
  the lane code AND the orchestrator's bookkeeping.

### NO PUSH RACE — lanes commit LOCALLY, the orchestrator merges + gates + pushes

**Subagent worktree lanes NEVER `git push` to GitHub.** A lane commits to its OWN worktree branch and
reports; it does not touch `origin`. Telling a lane to `git push origin HEAD:<branch>` is a bug: it
creates a **push race** where N lanes pushing rapidly each trigger a full CI run, and rapid pushes
cancel and cold-restart the slow gates, burning CI minutes. There is ONE pusher: the orchestrator.

Every time: (1) lane commits locally in its worktree, reports — no push; (2) orchestrator merges the
lane branch into the LOCAL one working branch, deletes the worktree; (3) orchestrator runs the CI
gates **LOCALLY as a pre-flight** (a fast local `make ci`/preflight of the same checks CI runs) and
fixes locally before spending a GitHub run; (4) orchestrator pushes to GitHub in **controlled batches**
(rebase-retry, never force). GitHub CI is a fast confirmation, not the failure-finder. The
orchestrator's own commits ride the same batched push, so there is no second branch and no push race.
