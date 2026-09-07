# Design: Codex support

## Canonical vocabulary

| Term | Definition |
| --- | --- |
| Harness | Agent client consuming the shared development workflows |
| Skill body | Canonical instructions in `skills/<name>.md` |
| Wrapper | Discoverable `SKILL.md` linking to a skill body |
| Capability fallback | Available client operation that preserves a workflow's intent |

## Decisions

- Add Codex alongside existing harnesses. The user confirmed preservation;
  the repository's existing multi-harness design should have made this the default.
- Reuse `.agents/skills` for Codex discovery, including when exporting skills.
  Keep Claude, Cursor, and Antigravity formats and defaults intact.
- Keep one shared instruction set. Map slash notation, agent delegation,
  startup checks, PR monitoring, scheduling, and file delivery to available tools.
  Do not fabricate subscriptions, timers, reviewer isolation, or resumed history.
- Prefer instruction-level startup checks over adding a mandatory Codex config.
  Models, permissions, MCP connections, and trust remain consumer-owned.
- Expose Codex as an explicit voice backend while retaining Claude as default.
  Resume the exact returned session; never resume an unrelated latest session.

## Shape and tradeoffs

Portability and preserving existing behavior matter more than identical client UI.
Shared wrappers avoid duplicated skills; targeted capability branches avoid a new
adapter framework. An in-session queue drain works without scheduling tools, but
cannot promise automatic restart after the client closes. Report that limit.

## Callable units

Extend the existing hoist CLI with `--harness codex`: same JSON output, exit codes,
manifest registration/replay, plan/fetch, keep rules and sidecars as other targets.
Extend the existing voice CLI with `VOICE_AGENT=codex`; use TypeScript modules,
Codex JSONL output, and exact session IDs. No new runtime or model pin.

## Scenarios

- A fresh consumer export discovers named skills and resolves their bodies.
- An edited consumer wrapper survives sync/replay with an upstream sidecar.
- Exporting all harnesses keeps a single shared `.agents` wrapper per skill.
- Missing webhook or scheduler tools produces an explicit fallback, not a stall.
- A voice CLI failure or malformed output is reported; no new session is silently
  substituted for a failed resume.

## Q&A

**Q:** Preserve existing harnesses? **A:** Yes; infer routine choices from the repo.

## Design review

Reviewed abstraction, vocabulary, bounded logic, types, and simplicity. Existing
emitters and CLI entry points cover the change; no general adapter layer needed.

## Evidence

- `tools/hoist-skill/hoist.ts` rejects Codex in its harness allowlist.
- `skills/create-pr.md` assumes a subscription tool and suggests an invalid
  `gh pr view --watch` fallback.
- `scripts/voice/voice-loop.ts` always invokes Claude-specific flags.
- [Codex skill discovery](https://learn.chatgpt.com/docs/build-skills)
  documents `.agents/skills` and named skill invocation.
- [Codex instructions](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
  documents direct `AGENTS.md` loading and the default 32 KiB instruction limit.
- Installed `codex exec --help` confirms JSONL output and session resume support.
