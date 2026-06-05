# Design: hoist-pull-flow

> Source: scaffold-hoist-ergonomics.md (victusfate/victusama, branch claude/hoist-registration-spec)
> Audience: scaffold contributors.

## Problem

Pull-only consumers must hand-build a local mirror of scaffold's tree before the
tool can run. Any missed directory or file produces a cryptic `ENOENT` or
`curl: (23) Failure writing output to destination` failure. The emit loop reads
from `SCAFFOLD_ROOT` (`../..` of `run`), so a curl-only consumer must:

1. fetch `run`
2. fetch `RESOLVER.md`
3. run `--plan`
4. fetch each listed source into the right subdir (with correct `mkdir -p`)
5. emit

Any error in step 4 (wrong dir, missing subdir) silently corrupts the output or
crashes with an opaque message.

## Q&A

**Q: Should the tool download sources itself, or should consumers keep doing the
mirror dance?**
A: The tool downloads its own sources when `--fetch` is passed. Pure-emit
(local SCAFFOLD_ROOT) stays the default — offline, dogfood, tests unaffected.

**Q: Where do fetched files go?**
A: A per-invocation temp dir under `os.tmpdir()`. The OS cleans it up; the tool
never manages cleanup.

**Q: What happens on a 404 for a generated (optional) source?**
A: Skip silently. The emitter synthesizes a valid wrapper when the upstream file
is absent, so a 404 is expected and correct.

**Q: Should `--plan` change its output shape?**
A: Yes — bump from a flat string array to `{ path, required }[]`. Consumers can
now fail loudly on missing required sources and silently skip generated ones.
Back-compat note: update the existing tests that check `.includes(string)`.

**Q: What Node version is assumed?**
A: Node 18+. The script already uses ESM (`import`). `fetch` and `os.tmpdir()`
are both built-in at 18+.

**Q: Is `--fetch` available in all modes (`--plan`, `--list`, emit)?**
A: Yes. `--fetch` only affects where RESOLVER.md and skill bodies are read from;
it is transparent to the downstream mode logic.

**Q: What about content hashes for drift detection (P4)?**
A: Out of scope for this PR. Noted for follow-up.

## Decisions

| Decision | Choice |
|---|---|
| Network implementation | Node built-in `fetch` (no new deps) |
| Temp dir | `os.tmpdir()` + timestamp suffix, no explicit cleanup |
| `--plan` shape | Break to `{ path, required }[]`; update tests |
| P3 trigger | Pre-check before emit loop in pure-emit mode |
| P4 (hashes) | Deferred |

## Canonical Vocabulary

| Term | Meaning |
|---|---|
| *source root* | Directory emitters read from; SCAFFOLD_ROOT in pure-emit, temp dir in fetch mode |
| *required source* | Must exist upstream; missing → hard failure |
| *generated source* | Harness wrapper synthesized by the emitter when absent; 404 is fine |
| *fetch mode* | `--fetch` flag active; tool resolves all sources from GitHub raw URLs |
| *pure-emit mode* | Default; reads from local SCAFFOLD_ROOT |

## Scenarios

### Happy path — fetch mode
```
node tools/hoist-skill/run --fetch --names tdd --into /repo --ref v1.4
→ fetches RESOLVER.md from raw.githubusercontent.com/victusfate/scaffold/v1.4/...
→ fetches skills/tdd.md (required)
→ tries .claude/skills/tdd/SKILL.md (required:false) — skip if 404
→ emits into /repo
→ records manifest at /repo/.sync/hoisted
```

### Pure-emit with missing source
```
node tools/hoist-skill/run --names tdd --into /repo
→ pre-check: skills/tdd.md missing from SCAFFOLD_ROOT
→ prints: hoist-skill: missing source skills/tdd.md
           (mirror it from https://raw.githubusercontent.com/victusfate/scaffold/main/skills/tdd.md, or run with --fetch)
→ exits 1
```

### --plan annotated output
```json
{
  "ref": "main",
  "harness": "claude",
  "sources": [
    { "path": "tools/hoist-skill/run",          "required": true  },
    { "path": ".claude/skills/RESOLVER.md",      "required": true  },
    { "path": "skills/tdd.md",                   "required": true  },
    { "path": ".claude/skills/tdd/SKILL.md",     "required": false }
  ]
}
```
