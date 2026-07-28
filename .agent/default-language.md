# Default language: TypeScript

New code in this repo — source, scripts, and tooling — is **TypeScript (`.ts`)**,
run via Node's native type-stripping (`node script.ts`, Node ≥23.6.0 — see the
`engines` floor in `package.json` and the note in `.npmrc`). When a task could be
done in several languages, choose TypeScript; do not introduce `.js`, `.mjs`,
`.cjs` or a second runtime just because it's conventional elsewhere.

The only hard-blocking exception is a tool whose own loader requires another
format — e.g. `eslint.config.mjs`, since ESLint's flat-config loader resolves the
config as an ES module and can't load a `.ts` file directly. Per `AGENTS.md`, stop
and get approval before adding any off-language file, and note the reason at the
top of it.
