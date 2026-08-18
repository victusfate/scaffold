# Handoff — voice-chat adoption into scaffold

- **When / branch:** 2026-08-18 · `feat/voice-chat-adoption` (off `main`)
- **Goal:** Move the `voice-chat` skill + `scripts/voice/*` engine from victus
  into scaffold (the upstream provider), port it cross-platform, register it,
  test, and open a PR. Consumers later pull it via `/pull-scaffold`.

## Source of truth

The user pasted a **self-contained** build doc ("voice-chat: self-contained
scaffold build + hoist-back plan") with **Appendix A** holding every file's full
contents. That paste is the authority — do NOT read victusama (its `scripts/voice`
lives on another branch and is not reliably accessible from the sandbox anyway).

## Confirmed decisions (from AskUserQuestion)

- Execute the adoption now (treat the doc as design+plan; no re-interview).
- NZ sample: **ship `fetch-nz-sample.sh` as a neutral example**; default backend
  stays neutral (`say`/`piper`), victus opts into `xtts`+NZ via env.
- Capture mode: **keep always-on VAD** (sox silence-gate). No push-to-talk.

## Done this session

- Created branch `feat/voice-chat-adoption`.
- Learned scaffold's real skill footprint: every skill needs 5 files (mirroring
  `diagram`) + a RESOLVER row + 5 manifest lines, enforced by
  `scripts/check-resolvable.ts` (reachability, cursor/antigravity/frontmatter
  parity, manifest completeness):
  1. `skills/<name>.md` (canonical, hand-edited)
  2. `.claude/skills/<name>/SKILL.md` — `description:` frontmatter + `@../../../skills/<name>.md`
  3. `.cursor/rules/<name>.mdc` — `description:` frontmatter + `@../../skills/<name>.md`
  4. `.agents/skills/<name>/SKILL.md` — `name/description:|/license: MIT/metadata.version` FM + `Read and follow ... [skills/<name>.md](../../../skills/<name>.md)`
  5. `.agent/workflows/<name>.md` — `description:` FM + `Read and follow ... [skills/<name>.md](../../skills/<name>.md)`
  Manifest: append the 5 paths to `.github/scaffold-files.txt`.
- Wrote 2 of 7 engine files **verbatim** into `scripts/voice/`:
  `voice-loop.ts`, `xtts_server.py`.

## Next steps (exact)

1. Write remaining engine files verbatim from Appendix A:
   `scripts/voice/requirements.txt`, `fetch-nz-sample.sh`, `README.md`,
   `.gitignore`, and canonical `skills/voice-chat.md`.
2. Apply the **section-5 portability port** to `scripts/voice/voice-loop.ts`
   (targeted edits, minimal diff):
   - Add `const PLATFORM = process.platform; const IS_MAC = PLATFORM === 'darwin'`.
   - `CFG.player` default: `IS_MAC ? 'afplay' : 'paplay'` (still env-overridable).
   - `CFG.greeting = process.env.VOICE_GREETING ?? "Ready. I'm listening."` and
     replace the hardcoded "Righto…she'll be right" greeting with `CFG.greeting`.
   - `resolveTts()` auto: piper if installed+model → else `IS_MAC && have('say') ? 'say'` → else `'espeak'`.
   - Add an `espeak` branch to `speak()` (`spawnSync(CFG.espeakBin, [text])`,
     `CFG.espeakBin = process.env.VOICE_ESPEAK_BIN ?? 'espeak-ng'`) and to `checkDeps()`.
   - Fix now-false "macOS only" / "macOS ships afplay" dep messages to be
     platform-aware.
   - Extend `--check` to print `Platform: <p>. Recorder: <rec|sox>. Player: <player>.`
   - Neutralize obvious persona bits for the upstream: exit phrase
     `goodbye victus`→`goodbye`; spoken exit `Sweet as. Talk later.`→neutral;
     `victus is working…`/`victus:` labels → neutral. (Flag to user — judgment
     call beyond the confirmed greeting decision.)
3. Neutralize canonical `skills/voice-chat.md` for scaffold: title/"victus"→"the
   agent"; replace the "macOS only" guardrail with cross-platform (macOS/Linux/WSL).
4. Emit the 4 harness forms + RESOLVER row + 5 manifest lines (mirror `diagram`).
   Also append the 5 `scripts/voice/*` runtime paths to the manifest so they sync.
5. Run `node scripts/check-resolvable.ts` and `node scripts/update-skills-doc.ts`;
   iterate to green. Run `node scripts/voice/voice-loop.ts --check`.
6. Add the CI-able STT round-trip test (synthesize→whisper.cpp→assert text).
7. Commit in reviewable slices, then `/create-pr`.

## Open questions

- How far to neutralize persona in the canonical skill body/exit-phrases for the
  neutral upstream (see step 2/3 — flagged for user veto).
- Confirm `.sync`/manifest is the right place for the runtime scripts vs a
  `copy:` policy entry (doc section 8) — verify against scaffold `bin/sync`.

## How to resume

`/resume` from any device. On this machine, `claude -c` reopens full history and
is richer. The pasted Appendix A is the file source — re-request it if the
resumed context lacks it.
