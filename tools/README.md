# tools — capability index

Agent/MCP-callable units (spec: `docs/agent-authoring-requirements.md` §2).
Every tool home is self-describing: `tool.yaml` + `run` + `test` + `README.md`.

| Tool | Purpose | Entry |
|---|---|---|
| [`hoist-skill`](hoist-skill/README.md) | Emit scaffold capabilities into a consumer repo in the target harness format (claude / cursor / antigravity); records and replays a `.sync/hoisted` manifest. | `node tools/hoist-skill/run` |
| [`sync`](sync/README.md) | Zero-local-code consumer sync — promote files per `.sync/policy.yaml` and replay hoisted skills. | `node tools/sync/run.mjs` (npx: `npx github:victusfate/scaffold sync`) |

Shared modules live in `tools/lib/` (not callable units — no descriptors):

- `lib/safe-write.mjs` — the clobber-safe write contract (`.scaffold-keep`,
  `*.scaffold-new` sidecars, `force`), shared by both tools.
