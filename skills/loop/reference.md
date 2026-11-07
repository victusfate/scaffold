# External loop driver and continuity

Read this only when the main loop skill selects an external driver or manages an existing one.
Apply the main skill's captured contract, lane reconciliation, and steering rules to every scheduled run.
Resolve the helper and adapter from their actual installed scaffold checkout, using absolute paths even
when the invoking process has a different CWD. Replace `/absolute/scaffold` and `/absolute/checkout` below.
A skill-only export may lack executable helpers; verify their presence before arming anything.

## Transfer checkout ownership

Before the first external run:

- Finish or checkpoint the current edit and transfer checkout ownership: the parent session stops editing that
  checkout once the driver starts.
- Finish native subagent lanes first, or record their worktrees and logs for reconciliation.
- To resume interactive edits, stop the loop and wait for the current run to finish (or explicitly cancel it).
  Status-only check-ins do not require stopping it.
- Keep lifecycle control with the parent or supervisor. A scheduled child reports its outcome through the
  structured result below; it never invokes `stop` on its own driver.

Include the captured contract and shared lane/steering rules in the child prompt, plus:

- Read repository instructions and the recorded handoff; if the recorded branch changed, report blocked before editing.
- Leave completed worktree commits isolated and report their branches and paths for the orchestrator to integrate.
- Poll the steering inbox at run start, each tool/subagent boundary, before dispatch, publication, and exit.
  Adopt direction in the handoff before acknowledging it; only the recurring agent consumes inbox messages.
  Include the exact absolute `inbox` and `ack` commands below in the captured prompt.
- Report `continue`, `complete`, or `blocked` through the structured result; exit zero alone proves no outcome.

This is an authorization contract, not credential isolation: the generic driver executes the reviewed argv with
inherited process access. When publication must be technically impossible, run the external command with
credentials and OS permissions that cannot push, merge remotely, or deploy.

## Portable external fallback

Requires Node >=23.6 on macOS, Linux/WSL, or native Windows. A detached Node supervisor runs outside the chat
and launches commands serially. No systemd, launchd, Task Scheduler, boot installation, global settings,
permission changes, or paid agent calls as probes. Unsupported hosts fail explicitly.

Schedule foreground commands that keep their parent alive until the work they start finishes. Non-overlap applies to
those command runs, not arbitrary detached services. On Windows, tree cancellation requires the command parent
to still be alive; a launcher that spawns background work and exits is unsupported. Independently detached
jobs need their own lifecycle controls and are reconciled by the agent, not covered by the supervisor's
timeout. Do not use a fire-and-forget launcher as the recurring command.

```text
node /absolute/scaffold/scripts/agent-loop.ts start --cwd /absolute/checkout --interval 10min --lifetime 8h --timeout 30min --max-failures 3 --require-result -- EXECUTABLE ARG...
node /absolute/scaffold/scripts/agent-loop.ts status --cwd /absolute/checkout
node /absolute/scaffold/scripts/agent-loop.ts logs --cwd /absolute/checkout
node /absolute/scaffold/scripts/agent-loop.ts stop --cwd /absolute/checkout
node /absolute/scaffold/scripts/agent-loop.ts stop --cwd /absolute/checkout --cancel
```

For natural language, inspect the installed agent CLI help and build its headless argv:

- Pass the captured prompt as one argument. The helper pins the CWD.
- A detached invocation may not inherit the parent session's permission, trust, sandbox, model, or
  device-access mode. Preserve those settings in the child argv using only the target CLI's reviewed
  unattended-approval mechanism. Never enable an unreviewed permission or sandbox bypass.
- Before claiming the loop is usable, verify that the child can perform the capabilities its task requires,
  including Git-metadata writes, device/GPU access, and required paths outside the workspace.
- If a required capability is unavailable, do not leave an apparently healthy recurrence armed: stop it,
  report the failed capability, and continue in the current session or checkpoint the work instead.

Use `--require-result` for agent-driven work. The driver supplies the writable `SCAFFOLD_AGENT_LOOP_RESULT`
path to each run. Before exiting successfully, the child command writes one JSON object there; a reviewed
harness adapter may produce the same object from the agent's structured response:

```json
{"status":"continue|complete|blocked","summary":"concrete progress or blocker","resume":"<optional id for next run's {{SESSION}}>"}
```

- `summary` must be a nonempty description of concrete progress, completion, or the blocker.
- `continue` schedules another run, `complete` ends the recurrence successfully, and `blocked` ends it with the
  typed directive and summary visible in status.
- The optional `resume` string is the capture path for session continuity (below): when present, the driver
  substitutes it for `{{SESSION}}` on the next run, overriding the minted id. When absent, the minted id is
  kept.
- A missing, empty, malformed, or unknown result fails closed instead of treating exit code zero as progress.
- The scheduled child must not also invoke `agent-loop stop`: that reduces every terminal outcome to
  `reason: stopped` and erases the distinction.
- Grant the child access only to that private result path when its sandbox requires an explicit writable path.
- Explicit command loops that already use meaningful process exit codes may omit this protocol.

**Session continuity (opt-in, cuts per-run token cost).** A fresh agent each run re-reads its whole context
(repo instructions, handoff, playbook) and re-probes capabilities every interval. To avoid that, split the
start command with a `:::` sentinel into a COLD command (run 1, full prompt) and a WARM command (runs 2+, a
short continuation prompt) so the agent keeps one conversation: the driver substitutes the effective session
id for every `{{SESSION}}` token in either command. The warm run inherits the cold run's context and prompt
cache. The result/steering/timeout protocol is unchanged.

Two paths feed `{{SESSION}}`; the driver knows nothing CLI-specific about either:

- **Pre-set path (CLIs that accept a caller-chosen id).** The driver mints a uuid at `start` time. The child
  sets it once on the cold run and resumes it on warm runs. No `resume` field needed: when a run omits
  `resume`, the minted id is kept.
- **Capture path (CLIs that generate their own id).** The child reports the CLI-generated id as `"resume"` in
  its result object. The driver stores it and substitutes it for `{{SESSION}}` on the NEXT run, overriding the
  minted id. The cold command ignores `{{SESSION}}` (there is nothing to resume yet); the warm command resumes
  `{{SESSION}}`.

Per-harness cold/warm argv (verified headless). Keep each warm prompt self-sufficient: a run may be the first
after a supervisor restart, and steering/handoff remain the durable memory the session must reconcile. This
holds even without a `:::` sentinel, where the same command runs cold each interval.

```text
# Claude Code — pre-set path (driver-minted id set once, resumed after)
node /absolute/scaffold/scripts/agent-loop.ts start --cwd /absolute/checkout --interval 10min --require-result -- \
  claude -p "<FULL cold-start prompt>" --session-id {{SESSION}} --permission-mode <mode> \
  ::: \
  claude -p "<SHORT warm prompt>" --resume {{SESSION}} --permission-mode <mode>

# pi.dev — pre-set path (same shape; verified: cold creates the session file,
# warm with the same id resumes it and recalls prior context)
node /absolute/scaffold/scripts/agent-loop.ts start --cwd /absolute/checkout --interval 10min --require-result -- \
  pi -p --session-id {{SESSION}} "<FULL cold-start prompt>" \
  ::: \
  pi -p --session-id {{SESSION}} "<SHORT warm prompt>"

# Codex — shipped capture adapter (first run generates thread_id)
# The adapter owns --json, structured output and the private result file.
# Warm: resume the captured id explicitly — never --last (it may pick unrelated work).
node /absolute/scaffold/scripts/agent-loop.ts start --cwd /absolute/checkout --interval 10min --require-result -- \
  node /absolute/scaffold/scripts/agent-loop-codex.ts codex -- --prompt "<FULL cold-start prompt>" \
  ::: \
  node /absolute/scaffold/scripts/agent-loop-codex.ts codex -- resume {{SESSION}} --prompt "<SHORT warm prompt>"
```

The shipped Codex adapter asks Codex for a `status`/`summary` object, captures the `thread.started` ID from
JSONL, validates both, and writes the private driver result with that ID as `resume`; from run 2 on, the driver
substitutes it for `{{SESSION}}`. The adapter withholds the private result-file path from the Codex process;
filesystem isolation still depends on the selected Codex sandbox and OS permissions. The adapter rejects
caller-supplied output flags, `--ephemeral`, and `--last`; put reviewed Codex options between the first `--`
and `--prompt`. On Windows use `codex.exe`, or place `node.exe` plus the installed Codex JavaScript entrypoint
before the first `--`, not a `.cmd` shim.

- `--fork-session` is available if a run should branch instead of extending the thread.
- Resume an explicitly selected session with supported options; never use a global "latest session" selector
  that might pick unrelated work.
- On Windows use an actual `.exe`, or `node.exe` plus the installed CLI's JavaScript entrypoint. A `.cmd`/`.bat`
  shim is not an executable argv target without shell parsing. Do not silently enable a shell to run agent
  instructions through a shim.
- Pass native absolute paths on Windows, for example `C:\\work\\project`; the POSIX paths above are
  placeholders, not required path syntax.

Explain defaults when arming unless the user supplied alternatives:

- First run starts promptly; the next starts one interval after completion. Long runs do not overlap or
  accumulate a backlog. This is a restart delay, not an independent 10-minute watchdog polling an active agent.
  The active agent manages its subagents; the timeout bounds a hang.
- Lifetime 8h, per-run timeout 30min, stop after three consecutive failures. Lifetime prevents new runs after
  expiration; a run already active may finish afterward within its own timeout. Choose a longer explicit
  timeout for known long jobs. Timeouts can interrupt work. Semantic stagnation needs agent judgment; the
  driver sees exit codes.
- Survives chat/terminal closure while the supervisor lives, not reboot/WSL shutdown or a supervisor crash.
  Does not wake the computer or run without CLI authentication. Stale/crashed state requires deliberate
  recovery under the repository's session and process ownership rules.
- Stop disables future runs; current work finishes. `--cancel` also terminates the current command's process
  tree. Explain that distinction before cancelling. Stop returns after recording the request. Poll status until
  `ended` before claiming cancellation finished or handing the checkout back to interactive work.
- Private state includes argv and logs. Keep credentials out of prompts/argv and sensitive command details out
  of public status updates.

After start succeeds, immediately call `status`. Report the actual supervisor ID/PID, checkout, interval,
expiration, timeout, logs and stop commands. If startup or verification fails, report **not armed** and
resolve the specific failure within scope. Never claim background execution without verified driver state.

## Status, changes, and stopping

### External steering inbox

Inspect status for the intended checkout, enqueue relevant direction, and report its message ID as queued.
Deliver through the inbox without editing the loop-owned checkout.

```text
node /absolute/scaffold/scripts/agent-loop.ts steer --cwd /absolute/checkout --message "Keep the slide torso more vertical"
node /absolute/scaffold/scripts/agent-loop.ts steer --cwd /absolute/checkout --message-file /private/steering.txt
node /absolute/scaffold/scripts/agent-loop.ts inbox --cwd /absolute/checkout
node /absolute/scaffold/scripts/agent-loop.ts ack --cwd /absolute/checkout --id MESSAGE_ID --outcome applied
node /absolute/scaffold/scripts/agent-loop.ts ack --cwd /absolute/checkout --id MESSAGE_ID --outcome deferred --note "Finish the current atomic export, then adjust the pose; recorded in handoff"
node /absolute/scaffold/scripts/agent-loop.ts inbox --cwd /absolute/checkout --all
```

- Use one message source, not both. Preserve text as data, never shell source.
- Prefer a private message file for long/sensitive text; command arguments can be visible in process listings.
  Inbox storage is outside the checkout.
- Default reads return unacknowledged messages for the current generation without consuming them; `--all`
  explicitly inspects history, including prior generations.
- Messages survive run boundaries until acknowledged, so handle redelivery idempotently.
- Acknowledge only after adopting the direction in the working plan/handoff, not on mere read. `applied` means
  direction adopted, **not** that the requested deliverable is done.
- `deferred` and `blocked` require an explanatory note and must remain visible in the handoff/work queue.
  Deferral is for an unavoidable safe boundary, not lower priority than older work.
- Record superseding direction before acknowledging it. Do not silently replay an old generation after a
  restart.
- The CLI refuses restart while the previous generation has unacknowledged steering. Inspect its inbox first,
  incorporate applicable direction into the new handoff/prompt (or record why the user superseded it), then
  acknowledge that disposition, so recovery never silently returns to the old agenda.

This is cooperative delivery, not a native chat interceptor; it cannot preempt an in-flight tool call. The chat
agent must enqueue the update, and the recurring agent must have the polling instructions in its launch prompt.

- Do not silently alter arbitrary executable argv to add agent behavior.
- For an older already-running prompt without inbox polling, queueing alone is insufficient: report the
  limitation and use the existing stop/wait/handoff procedure before a deliberate restart.
- Do not claim automatic delivery is active until the recipient can poll.

### Configuration changes

Disabling future runs is immediate; current work may still claim tasks until it ends or times out.
Use explicit cancellation when the user requests that current work stop too.
