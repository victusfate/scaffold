# Knowledge architecture for agent teams

Status: **proposal, pilot before adopting.** It comes from a council review (five advisors across two model vendors, then cross-vendor peer review) in a consumer repo where one owner, one orchestrator agent and several worker lanes share a large doc set and a task queue.

## Diagnosis: a doc set linked by prose is an archive, not a knowledge graph

Most agent-driven repos accumulate the same layers:
- process rules (AGENTS.md and guidelines);
- a task queue with long free-text acceptance fields;
- per-task spec files;
- design decisions in a design doc;
- harness-private memory;
- handoff notes;
- orchestration scripts.

Each layer is plain text, and the relationships between them live in prose. So every agent rebuilds those relationships on every task by reading and grepping, and gets them wrong in recurring ways:

- **Stale tasks get re-dispatched.** Nothing links a task to the PR and test that prove it's done, so finished work is rediscovered as "pending".
- **Premises drift from the code.** A remembered claim ("X does 2–9× damage") is believed and built on without anyone measuring it.
- **Workers re-derive the same hook points.** Hand-written `file:line` pointers go stale at the next commit. Plans that pin them are brittle, and workers stop on small mismatches.
- **Decisions scatter.** The same ruling lives in task text, harness memory, the design doc and chat, and the copies drift apart.
- **Accidental databases form.** When a script parses a free-text field (for example a `BRANCH: x` line appended to a task's acceptance text), that field has become an untyped database, and its most recent line silently counts as the truth.
- **Inputs go missing.** Non-git artifacts (generated images, large-file-storage objects) get lost or aren't present in a fresh worktree, and every fix becomes another one-off script.
- **Chat summaries lose decisions.** Owner decisions made in chat disappear when context is compacted.

Knowledge-graph advocates argue that resolving entities offline, storing typed relationships as precomputed edges, and supplying *instance* facts rather than just *type* knowledge sharply cuts both tokens and errors. The council agreed with the idea of typed, precomputed relationships. It rejected the conclusion that a graph *store* is needed.

## The core insight: the bottleneck is trust, not retrieval

Faster retrieval of a stale or unmeasured claim only makes the team wrong sooner. What these failures have in common is **state that was written once and never verified**. The fix is typed lifecycle state with evidence, kept as plain, git-diffable records that every harness can read. It does not need a graph database, embeddings or a wikilink crawler.

## Storage: extend the queue's database, don't add a new store

If the task queue already lives in an embedded database (for example SQLite through the runtime's built-in driver) with a rendered markdown view, put the new records **in that same database as typed tables**, and render human-readable views from it the way the queue view is rendered:
- `decisions` (id, statement, owner quote, scope, status, supersedes, code ref or probe command);
- `evidence` (task, PR, test ids, commit, scope, covered files);
- one typed `edges` table (`from_kind, from_id, relation, to_kind, to_id`).

A single edge table is what makes this a queryable knowledge graph in plain SQL, with no separate graph store. It reuses the existing locking, CLI and render path. Use plain files (JSON Lines) only when no database exists yet.

## Recommendation

### 1. Typed lifecycle state on the existing task queue
- **Typed fields, not prose.** The queue CLI is usually already the only writer of the store. The failure is *where* facts go: branch, plan or spec path, PR, evidence and decision references get appended as prose markers (`BRANCH:`, `PLAN:`) to the free-text acceptance field, often because the CLI has no typed setter for them, even when the schema has the column. Give the CLI typed setters (`queue set <id> branch|plan|pr|evidence|decisions …`), have scripts read those fields, and reject the prose markers in acceptance text. Acceptance prose describes the *outcome* only.
- **`done` requires an evidence record:** PR number, test ids, the commit they passed at, and the scope they cover.
- **Evidence goes stale.** When files covered by a done task's evidence change, the task is flagged for re-verification instead of being trusted forever. A merged PR proves a change landed, not that today's acceptance criteria still hold.
- **Dispatch checks evidence first.** Before a task goes to a worker, show any existing implementation and verification evidence. That catches already-done tasks and work one change could satisfy together.
- **Read the edges you already have.** Commit subjects often name their task, so the task-to-PR edge may already exist in `git log`. Backfill from it.

### 2. A decision registry
- **One home per decision.** Each entry has an id, a statement, the owner's own words, its scope, a status (live / queued / superseded), what it supersedes, and either a code reference or a **reproducible measurement**: the conditions plus the command that reproduces it.
- **Everything else cites the id.** Task text, memory and docs reference `D17`; they never restate it. Human-readable design docs are rendered from the registry.
- **Record a decision the moment it's made, before replying.** The orchestrator writes it at that point, because chat summaries are lossy.
- **Unverified claims stay visibly unverified.** A decision or claim with no code reference and no measurement is marked UNVERIFIED, never quietly treated as fact.

### 3. A generated per-task context packet (`queue brief <task>`)
- **Contents:** the governing decisions; symbol locations **at a named commit**, generated from code and never hand-written as `file:line`; prior evidence; artifact availability; and open assumptions.
- **Plans state intent and gates; workers own the details.** Code references are navigation hints: the worker re-resolves them when code has moved, instead of stopping.
- **Workers write back.** When a task finishes, the worker records corrected locations, new evidence and discoveries through the CLI, so every task makes the next one cheaper.

### 4. An artifact manifest for non-git inputs
- **Every artifact a task depends on** that git doesn't carry (generated images, large-file objects, external caches) is recorded with its path, content hash, durable location and provenance.
- **A worker preflight checks availability** and fetches from the durable location. A perfect briefing is useless if the inputs it names are missing.

### 5. Harness-private memory holds only harness preferences
Project facts live in the repo, where every harness (Claude Code, Codex, pi, agy, Cursor) can read them. A fact that exists only in one harness's private memory is invisible to every other worker.

### 6. A concurrency and recovery contract
- **Define who may write each record.** For example: owner decisions are written only by the orchestrator, and task state only through the queue CLI.
- **Define how conflicting lane discoveries are reconciled.**
- **Define recovery when a worker crashes** between merging code and recording its evidence. For example, the merge step and the evidence write are one CLI operation, or a sweeper reconciles merged PRs that have no evidence record.

## Pilot before adopting

Try this on about 10 real tasks before rolling it out. Measure:
- time from dispatch to a correct briefing;
- repeated investigation (the same hook point re-derived);
- stale or already-done tasks caught at dispatch;
- total maintenance and verification cost against the time saved, under the team's actual model budget.

Adopt each piece only if it pays for itself.

## What the council disagreed on
- **Cut everything that isn't regenerable from code or testable, or keep owner intent with attribution?** Keep intent: code shows implemented behaviour, not intended behaviour. Design intent, rejected alternatives and art direction need a status and a source, not deletion.
- **The reviewers split by vendor, and the split is complementary.** One vendor's reviewers favoured the concrete, code-grounded plan (use the typed columns the queue already has; enforce at the `done` chokepoint). The other vendor's reviewers favoured the evidence and trust model (scoped, stale-able evidence; decisions with supersession). This proposal takes the first as its plan and the second as the rules it has to obey.

## First step

Add typed CLI setters for branch and evidence (most schemas already have the columns), stop scripts from parsing acceptance prose, and require evidence for `done`. It's the cheapest change, it removes the fragile parsing of free text, and it catches already-done tasks.
