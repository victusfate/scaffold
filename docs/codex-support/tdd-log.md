# TDD log: Codex support

## Slice 1

- RED: live hoist CLI exited 1: `Unknown harnesses: codex`.
- GREEN: Codex export, plan/replay/edit protection, generated wrapper resolution,
  and all-harness coexistence pass (3 acceptance tests).
- Existing baseline `npm test` passed before changes. Tests need the normal
  subprocess/Git environment; sandbox execution initially suppressed child output.
- Exporter regressions and typecheck pass. Added fetch coverage verifies a pinned
  source and generated fallback for an absent optional wrapper (4 tests total).

## Slice 2

- RED: live voice loop launched `claude` when `VOICE_AGENT=codex` was selected.
- GREEN: real loop with local fixture executables verifies Codex exec/stdin,
  exact-session resume, Claude default compatibility, subprocess/protocol errors,
  and missing-binary handling (4 tests). Original voice checks still pass (12).
- Evaluation caught malformed JSON parser errors exposing raw output; fixed by
  reporting a stable error message, then reran the same failing test successfully.
- Independent correctness review found two voice documentation mismatches;
  corrected the Claude-only allowlist and CLI-auth billing wording.
- Independent structural review found unused exports and ambiguous skill
  registration rules. Removed the exports and clarified registration. The strict
  skill gate also caught duplicated capability guidance; centralized it in AGENTS.
- Re-review: no remaining correctness findings or rubric deductions. New runtime,
  exporter, tests, instruction changes, and generated bridges scored 10 in each
  dimension (Quality, Readability, Encapsulation, Clarity).

## Final verification

- `npm test`: passed; includes existing sync/bootstrap, queue, skill/rubric,
  tool suites, plus the 8 new acceptance tests.
- `npm run test:integration`: passed for hoist, sync, and linter setup.
- `npm run typecheck`: passed.
- `npm run lint`: exit 0, no errors; 112 warning-level findings remain. This is
  not a warning-free codebase; some warnings cover added code and test literals.
- Full tracked-code mechanical gate and shellcheck: passed.
- Strict resolver/manifest checks and generated-doc freshness: passed.
- Fresh consumer installation through the real sync entry point: 27 Codex
  wrappers resolve, including the bundled advisor; rubric and voice runtime ship;
  installed voice help and exporter listing execute successfully.
- Installed Codex CLI help accepts the constructed exec/resume options.
- No authenticated model call, physical audio, or durable scheduler was tested;
  these remain environment-specific acceptance checks, documented in `docs/codex.md`.

## Reachability

- `tools/hoist-skill/run` → `hoist` → `makeEmitters` → Codex wrapper emission.
- `scripts/voice/voice-loop.ts` main → `agentConfig` / `askAgent` → selected CLI.
- `.agents/skills` wrappers → canonical bodies / bundled advisor source.
- Sync manifest → consumer instructions, rubric, wrappers, and runtime dependencies.
