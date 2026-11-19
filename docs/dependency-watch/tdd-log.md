# TDD log: dependency-watch

## Slice 1 — .ruby-version behind latest patch
- Status: done
- Notes: tracer through parsePins → classify. Release line = major.minor. `today` deferred to slice 3 (EOL).

## Slice 2 — other pin files and Dockerfile FROM
- Status: done
- Notes: split parsing into `pins.ts` (Pin is a union: exact / floating / unchecked). Node line = major.
  Untagged runtime image → floating. Pin above its line's latest, or no release data → unchecked.

## Slice 3 — upstream release parsers and EOL findings
- Status: done
- Notes: `releases.ts` holds source URLs + parsers. Fixtures are trimmed real payloads from 2026-11-19.
  Malformed or empty payloads throw. EOL applies to exact and floating pins; `behind` and `eol`
  are separate findings. `classify` takes an injected ISO date.

## Slice 4 — runtime-check CLI
- Status: done
- Notes: tracked files only (`git ls-files`); fetches only pinned runtimes; `--releases` offline,
  `--today` injectable. `isPinFile` shares the parser dispatch in `pins.ts`.
- Live probe 2026-11-19 [verified: ran against a scratch repo]: `.ruby-version 3.4.12` → behind 3.4.13
  (Ruby2Shell, disclosure day), `python:3.13.8` → behind 3.13.18, `node:20` → eol 2026-04-30.
