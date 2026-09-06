# PRD: Codex support

## Problem statement

Scaffold advertises Codex support, but only its root instructions and existing
Agent Skills wrappers are directly usable. Export rejects Codex, and workflows
assume client-specific tools, hooks, commands, and Claude voice execution.

## Solution

Make Codex an explicit supported harness using shared instructions and wrappers.
Keep all existing targets, defaults, and consumer edit protection.

## User stories

1. Export skills for Codex and discover them from a consumer repository.
2. Plan, fetch, register, and replay a Codex selection like any other harness.
3. Run design, implementation, review, checkpoint, PR, and queue workflows using
   the current client's available tools without invoking imaginary APIs.
4. Run the voice loop with Codex and retain the conversation across utterances.
5. Understand which behavior requires optional client integrations or local audio.

## Implementation decisions

- Add `codex` to the existing export contract; reuse Agent Skills emission without
  emitting Antigravity workflows. Keep the canonical body and wrapper structure.
- Document Codex named invocation, explicit referenced-file reads, bounded
  reviewer concurrency, available-tool fallbacks, startup, and local session resume.
- Use an explicit voice backend setting, Claude by default; invoke Codex through
  its noninteractive CLI, with stdin prompts and structured output. Keep model
  and approval configuration under the user's control.
- Ship new runtime dependencies in the existing sync manifest. Do not overwrite
  consumer Codex configuration or install global client settings.

## Testing decisions

Use isolated consumer directories and real CLI subprocesses for export, planning,
replay, keep rules, and wrapper resolution. Use a local fixture process for voice
protocol tests and exercise the live loop with fake audio commands. Run existing
regressions, typecheck, lint, mechanical quality checks, and two review lenses.
Microphone hardware, authenticated model calls, and persistent scheduling are
environment-dependent and must not be described as verified by fixture tests.

## Out of scope

Replacing other harnesses, publishing or merging without approval, provisioning
accounts, global settings, a new scheduler, or migrating the sync architecture.
