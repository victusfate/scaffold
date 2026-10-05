> **Multi-harness:** Plugin-first. Where the harness has a native Modern Web Guidance
> plugin or package (Claude Code, agy, Codex, pi), that is the primary path; this skill routes to
> it and is the fallback everywhere else (Cursor) via one npm CLI.

# Modern Web Guidance

[Modern Web Guidance](https://developer.chrome.com/docs/modern-web-guidance) is a
set of expert-curated, eval-calibrated guides from the Chrome team (with Edge and
the web community) that steer coding agents off legacy patterns and onto the
modern web platform: popover/dialog/anchor positioning, view transitions,
scroll-driven animations, container and style queries, customizable `<select>`,
form autofill and `:user-invalid` validation, Core Web Vitals (LCP/INP),
speculation rules, Temporal, built-in AI APIs, WebMCP, accessibility, and more.

Training data over-represents old code, so an agent's first instinct for a web
task is often a heavy JS library or a hand-rolled polyfill where one native
feature now suffices. This skill closes that gap by pulling the current guide
into context **before** the code is written.

Upstream: npm package [`modern-web-guidance`](https://www.npmjs.com/package/modern-web-guidance)
(Apache-2.0, source: `github.com/GoogleChrome/modern-web-guidance-src`). Scaffold
does not vendor its guides — every call runs `@latest`, so the guidance never
goes stale in a consumer repo.

## When to use

**Use it** at the start of any task that writes or changes browser-facing code:

- UI and layout — modals, dialogs, popovers, tooltips, menus, drawers,
  carousels, `:has()`, container queries, dark mode, typography.
- Scroll and motion — view transitions, scroll-driven animations, entry/exit
  animations, scroll snap.
- Forms — autofill, validation feedback, custom selects, auto-sizing fields.
- Performance — LCP, INP, long tasks, image and fetch priority, prefetch/prerender.
- Client APIs — Temporal dates, Navigation API, WebAuthn/FedCM, built-in AI
  (Translator, Summarizer, Prompt API), WebMCP.
- Framework work (React, Vue, Angular, Svelte…) that ends in DOM/CSS output.
- Reviewing web code (`/validate`, `/simplify`, `/audit`) for legacy patterns.

**Skip it** for backend code, databases, CI/CD, Docker, lint config, git, and
non-browser scripts.

`/frontend-design` decides the *aesthetic*; this skill decides the *platform
mechanism*. Use both for UI work — design direction first, then look up how to
build each interaction natively.

## Workflow

### 0. Plugin first

If the harness has a native plugin, use it — it ships upstream's own
`modern-web-guidance` skill, which auto-triggers on web tasks and stays current
with upstream's release cadence.

- **Already active?** If a `modern-web-guidance` skill (or
   `modern-web-guidance:modern-web-guidance`) is in your skill list, invoke it
   and follow it instead of §1–§3 below, subject to the current client's
   permissions and the Harness notes below. Stop here.
- **Not active, harness has a plugin** — install it:

   | Harness | Plugin | How it gets enabled |
   |---|---|---|
   | Claude Code | `modern-web-guidance@claude-plugins-official` | **Declared** in scaffold's `.claude/settings.json` (`enabledPlugins`). Declaring is not installing: Claude Code only offers the install when a repo is first trusted, so `bin/sync-from-scaffold.sh` runs `bin/ensure-plugins.sh`, which installs any declared-but-missing plugin at project scope. If the skill still isn't listed, run `bash bin/ensure-plugins.sh` (or `claude plugin install modern-web-guidance@claude-plugins-official --scope project`), then `/reload-plugins`. A `/reload-plugins` "error during load" usually means a declared plugin isn't installed. |
   | agy (Antigravity; the successor to Gemini CLI) | GoogleChrome/modern-web-guidance | `agy plugin install https://github.com/GoogleChrome/modern-web-guidance` |
   | Codex | `modern-web-guidance@googlechrome` | `codex plugin marketplace add GoogleChrome/modern-web-guidance` then `codex plugin add modern-web-guidance@googlechrome` |
   | pi | no dedicated plugin — upstream's npm package loads as a pi package (its `skills/` dir is discovered by convention; verified against pi 0.87.0 / package 0.0.190) | `pi install -l npm:modern-web-guidance` (project-scoped, writes `.pi/settings.json`, loads after project trust; omit `-l` for user-wide). Also loads upstream's `chrome-extensions` skill. |
   | Cursor | none documented upstream | skip to §1 Search — this skill *is* the integration |

   In Codex, check `codex plugin --help` first. If the CLI is absent or has no
   plugin commands, continue with §1 Search using scaffold's `modern-web` skill
   from `.agents/skills/modern-web/SKILL.md` (`$modern-web` or `/skills`). The native
   install route was verified with Codex CLI 0.154.0 and plugin 0.0.190; use
   `codex plugin list --marketplace googlechrome --json` to check installation
   and enablement, then check the skill list in a fresh session for discovery.

   Outside Claude Code's committed setting, a plugin install changes the user's
   client config (global, or pi's `.pi/settings.json`). Propose the exact command and run it only once
   the user approves it; if they decline, or the install fails (no network,
   marketplace unreachable), continue with §1 Search in this session. A freshly
   installed plugin usually loads only on the next session or after a reload —
   use §1–§3 for the current task either way. In pi, project-local packages load
   only once the project is trusted — scripted runs pass `-a` (e.g.
   `pi -a -p …`) or the user approves at the interactive trust prompt.

### 1. Search

Summarize the goal as an action, not an API name (the index is keyed by
use case — "animate a dialog's backdrop on open and close", not "@starting-style"):

```sh
npx -y modern-web-guidance@latest search "<what you want to achieve>"
```

It returns JSON: `id`, `description`, `category`, `featuresUsed`, `tokenCount`,
`similarity`. Pick the closest match(es). If similarity is low or nothing fits,
browse the full index:

```sh
npx -y modern-web-guidance@latest list
```

### 2. Retrieve

```sh
npx -y modern-web-guidance@latest retrieve "<id>"            # one guide
npx -y modern-web-guidance@latest retrieve "<id-a>,<id-b>"   # several
```

If the output is truncated, redirect it to a scratch file and read the file —
never implement from a half-read guide.

### 3. Implement and verify

Adapt the (usually framework-agnostic) guide to the project's stack, then
cross-check before calling the work done:

- The guide's modern pattern is applied — not an ad-hoc or library substitute.
- Its fallback strategy is applied where the project's browser-support policy
  requires one (below), without adding features the user didn't ask for.
- The user's actual request is fully satisfied.

Treat the retrieved guide as the project's local standard. Do not invent guide
IDs or paraphrase a guide you did not retrieve.

## Browser-support policy

Guides assume **Baseline Widely available** features are safe without fallbacks.
For anything newer, follow the guide's fallback advice **unless** the repo
declares its own policy. Look for a `**Browser Support:**` line anywhere in
`AGENTS.md` (e.g. `**Browser Support:** Baseline 2024; no polyfills over 20
lines`). For a "Baseline YYYY" target, a feature qualifies when its guide's
"Baseline since" date is ≤ YYYY.

If the user mentions a restricted runtime (Electron, Tauri, a single browser),
excludes targets, or pushes back on polyfill weight, suggest recording a
`Browser Support:` line in `AGENTS.md` so every harness shares it.

## Harness notes

The CLI needs Node ≥ 20 and outbound network access to the npm registry.

| Harness | What to do |
|---|---|
| Claude Code | Scaffold's `.claude/settings.json` pre-allows `Bash(npx -y modern-web-guidance@latest:*)` and the `pnpx` equivalent. Keep any extra allowlisting that narrow — never bare `npx *`. |
| Codex | Use the current session's network and approval policy. Run directly when network access is allowed; request approval for the specific command only when access is restricted and the client supports escalation. Never request escalation under an approval policy of `never`, or change global permissions to run this skill. If access is blocked, try the offline fallback below. If `~/.npm` is read-only, set `NPM_CONFIG_CACHE` to a writable temporary directory. |
| Cursor / pi / agy | Run the same commands through the client's shell tool; approve that one command pattern rather than a blanket `npx`. |
| pnpm projects | `pnpx modern-web-guidance@latest …` (no `-y`). |
| Windows | Use `npx.cmd` if `npx` fails. |
| Offline | Retry with `npx --offline …` to use the npm cache; if that fails, say the guidance was unavailable rather than guessing. |

## Rules

- Search **before** writing the component, not after — the point is to avoid
  building the legacy version first.
- One search per distinct interaction; don't batch unrelated goals into a
  single query.
- Never fabricate a guide's content. If the CLI can't run (no network, denied
  permission), say so and proceed from your own knowledge, flagged as unverified
  against current guidance.
