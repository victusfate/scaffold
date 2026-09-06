# Codex support

Scaffold supports Codex alongside Claude Code, Cursor, Gemini, pi, and agy.
The shared development workflow is design → PRD → TDD → review. Codex reads
`AGENTS.md` directly and discovers `.agents/skills/<name>/SKILL.md`; each wrapper
links to its canonical body in `skills/`. See the official
[skill discovery](https://learn.chatgpt.com/docs/build-skills) and
[instruction discovery](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
documentation.

## Start here

1. Open the repository in Codex with Node ≥23.6 available for scaffold tooling.
2. Ask for a development task or invoke `$feature-chain`. Use `/skills` to select
   a skill where the client exposes that picker.
3. Use `$code-refiner` to review and fix a diff, `$queue` to drain project work,
   and `$save`, `$pause`, or `$resume` for Git-backed checkpoints.

`/name` in scaffold docs means a skill, not necessarily a Codex slash command.
Use `$name` or read `.agents/skills/<name>/SKILL.md` when names collide with client
commands. For example, Codex `/resume` restores a chat; scaffold `$resume` reads
the pushed `.pause/handoff.md`. Local full history uses `codex resume --last`.
Read referenced `@path` files explicitly, relative to their containing document.

The bundled `$improve` advisor also has an Agent Skills wrapper that reads its
unchanged upstream source and references under `.claude/skills/improve/`. It
produces plans; use the implementation workflow to build them. Full sync ships
this bundle; selective hoisting lists only the shared canonical skills.

## Install into another development project

The full scaffold sync manifest includes instructions, wrappers, canonical skill
bodies, quality rubric, and runtime tools. Use the README's sync/bootstrap flow
for a complete harness. Consumer edits retain the existing keep/sidecar behavior.

To export only selected skills from this checkout:

```sh
node tools/hoist-skill/run --names feature-chain,tdd --harness codex --into ../my-project
node tools/hoist-skill/run --from-manifest --into ../my-project
```

The exporter writes `skills/<name>.md`, `.agents/skills/<name>/SKILL.md`, and a
`codex` registration in `.sync/hoisted`. `--plan`, `--fetch`, `--force`, and
`.scaffold-keep` work as for other targets. `--harness all` includes Codex and
shares its `.agents` wrapper with Antigravity. Selective export installs skill
bodies/wrappers, not a transitive dependency closure; full sync supplies runtime
dependencies and the other skills that the feature chain invokes.

Do not copy `.claude` import stubs into Codex's global skill directory. The
existing `bin/install-skills.sh` is a Claude installer. Repository sync is the
supported complete Codex installation path.

## Client-dependent behavior

| Workflow | Codex behavior |
| --- | --- |
| Startup freshness | Explicit Git fetch/check when no startup hook has run |
| Review/council | Native isolated subagents when available; batch to available slots; disclose a serial review fallback |
| Editing lanes | Explicit git worktrees when the client lacks an isolation option |
| PR monitoring | Subscribe if a tool is exposed; otherwise `gh pr checks --watch` checks CI and `gh pr view` inspects reviews/state |
| Queue | Drain continuously in the current turn; persistent restart requires an actual scheduler/monitor |
| Statusline | Codex CLI `/statusline` picker; `/status` for a snapshot; app clients use their status UI |
| File delivery | Available attachment tool or clickable file link |
| Voice | `VOICE_AGENT=codex`; see [voice setup](../scripts/voice/README.md) |

A CI watch is not a review/merge webhook subscription. A saved queue does not
restart itself when the client closes. Report which integration is active.
Claude's `.claude/settings.json` hooks and read-once cache remain Claude-specific;
scaffold does not claim Codex loads them. Codex supports its own
[hook configuration](https://learn.chatgpt.com/docs/config-file/config-reference),
but this repo does not install mandatory hooks or overwrite consumer settings.

Models, MCP connections, trust, and permissions stay under the user's control.
The root instruction file stays below Codex's default 32 KiB combined instruction
limit; user/global/nested instructions also consume that limit. The CLI's
[command reference](https://learn.chatgpt.com/docs/developer-commands?surface=cli)
documents the current skill, resume, status, and statusline commands.

## Verification

`npm test` exercises real exporter and voice-loop CLI entry points in temporary
directories, with fixture processes replacing model/audio calls. It also runs
the existing sync/bootstrap, queue, and skill-resolution suites. `npm run
test:integration`, `npm run typecheck`, and `npm run lint` cover the surrounding
toolchain. The new voice protocol follows Codex's documented
[noninteractive JSONL format](https://learn.chatgpt.com/docs/non-interactive-mode).

An authenticated model response, physical microphone/TTS playback, and a
persistent external scheduler require environment-specific acceptance checks.
Fixture success does not establish those integrations are running.
