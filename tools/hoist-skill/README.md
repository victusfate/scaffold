# hoist-skill

Emit scaffold capabilities (skills) into a consumer repo in the target harness format. scaffold owns the emit — consumers ask for capabilities by name and do not need to know the internal layout.

## Usage

```bash
node tools/hoist-skill/run --names <name[,name]|all> [--harness <claude|cursor|antigravity|all>] [--into <dest>] [--force]
```

**Options**

| Flag | Default | Description |
|---|---|---|
| `--names` | `all` | Comma-separated capability names, or `all` |
| `--harness` | `claude` | Target harness: `claude`, `cursor`, `antigravity`, or `all` |
| `--into` | `.` | Destination repo root |
| `--force` | false | Overwrite differing files instead of writing `.scaffold-new` sidecars |
| `--list` | — | Print available capabilities and harnesses as JSON and exit |

## Example

```bash
# Emit feature-chain and tdd for Claude Code into the current directory
node tools/hoist-skill/run --names feature-chain,tdd --harness claude

# Emit all capabilities for all harnesses into another repo
node tools/hoist-skill/run --names all --harness all --into ../my-project

# List what is available
node tools/hoist-skill/run --list
```

## What it writes

For each capability + harness:

| Harness | Files written |
|---|---|
| `claude` | `skills/<name>.md` (canonical body) + `.claude/skills/<name>/SKILL.md` (wrapper) |
| `cursor` | `skills/<name>.md` + `.cursor/rules/<name>.mdc` |
| `antigravity` | `skills/<name>.md` + `.agents/skills/<name>/SKILL.md` + `.agent/workflows/<name>.md` |

## Clobber-safe contract

- Files listed in the consumer's `.scaffold-keep` are never touched.
- A destination file that differs from the incoming content is written to `<file>.scaffold-new` for deliberate review. The original is left untouched. Pass `--force` to overwrite instead.
- Unchanged files are skipped silently.

## Output

Logs progress to stderr. Emits a JSON manifest on stdout:

```json
{
  "into": "/path/to/dest",
  "harnesses": ["claude"],
  "results": [
    { "path": "skills/feature-chain.md", "status": "written" },
    { "path": ".claude/skills/feature-chain/SKILL.md", "status": "written" }
  ]
}
```

Status values: `written`, `unchanged`, `sidecar`, `kept`.

## Running the tests

```bash
node tools/hoist-skill/test
```
