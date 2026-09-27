> **Multi-harness:** This skill works identically in Claude Code, Codex, Cursor, Gemini, pi,
> and agy. It shells out to one npm CLI; all paths and commands are harness-agnostic.

---
name: modern-web
description: Consult Google Chrome's Modern Web Guidance before writing HTML/CSS/client-side JS — search the curated use-case index, retrieve the best-practice guide, and verify the code against it (Baseline-aware fallbacks)
license: MIT
---

> **Note:** The frontmatter above is for pi/Agent Skills discovery. The skill
> instructions follow and are identical across harnesses.

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
declares its own policy. Look for a `Browser Support:` line in `AGENTS.md` /
`CLAUDE.md` (e.g. `**Browser Support:** Baseline 2024; no polyfills over 20
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
| Codex | Request network approval for the `npx` command **before** the first run so the sandbox doesn't time out. If `~/.npm` is read-only, set `NPM_CONFIG_CACHE=/tmp/npm-cache`. |
| Cursor / Gemini / pi / agy | Run the same commands through the client's shell tool; approve that one command pattern rather than a blanket `npx`. |
| pnpm projects | `pnpx modern-web-guidance@latest …` (no `-y`). |
| Windows | Use `npx.cmd` if `npx` fails. |
| Offline | Retry with `npx --offline …` to use the npm cache; if that fails, say the guidance was unavailable rather than guessing. |

### Native plugin installs (optional)

Upstream also ships native plugins. Scaffold's skill works without them; install
one only if you want the upstream `SKILL.md` auto-triggering as well:

| Client | Install |
|---|---|
| Any (wizard) | `npx modern-web-guidance@latest install` (update: `… update`) |
| Claude Code / Copilot CLI | `/plugin marketplace add GoogleChrome/modern-web-guidance` then `/plugin install modern-web-guidance@googlechrome` |
| Codex | `codex plugin marketplace add GoogleChrome/modern-web-guidance` then `codex plugin add modern-web-guidance@googlechrome` |
| Antigravity (agy) | `agy plugin install https://github.com/GoogleChrome/modern-web-guidance` |
| Gemini CLI | not in upstream's README; the package ships a `gemini-extension.json`, so `gemini extensions install https://github.com/GoogleChrome/modern-web-guidance` is the expected route — verify before relying on it |
| Skills CLI | `npx skills add GoogleChrome/modern-web-guidance` |

## Rules

- Search **before** writing the component, not after — the point is to avoid
  building the legacy version first.
- One search per distinct interaction; don't batch unrelated goals into a
  single query.
- Never fabricate a guide's content. If the CLI can't run (no network, denied
  permission), say so and proceed from your own knowledge, flagged as unverified
  against current guidance.
