# npm-workspaces TypeScript template (opt-in)

A starting layout for a multi-package TypeScript repo run with Node's native
type stripping. `/add-linter` does not apply it automatically; copy it when a
repo grows past one package.

```
package.json              # workspaces: ["packages/*"] + aggregate scripts
packages/
  tsconfig.json           # ONE shared program: every package's src/ and test/
  <name>/
    package.json          # per-package test + test:coverage (with floors)
    src/index.ts
    test/index.test.ts
```

## Adopt it

1. Copy `package.json` and `packages/` into the repo root. Merge the
   `workspaces` field and the scripts into an existing root `package.json`
   rather than overwriting it, and rename the `my-monorepo` scope.
2. Rename `packages/example` to your first package, and add its source and test:

   ```ts
   // packages/<name>/src/index.ts
   export function greet(name: string): string {
     return `hello, ${name}`;
   }
   ```

   ```ts
   // packages/<name>/test/index.test.ts
   import { test } from 'node:test';
   import assert from 'node:assert/strict';
   import { greet } from '../src/index.ts';

   void test('greet names the caller', () => {
     assert.equal(greet('world'), 'hello, world');
   });
   ```

3. `npm install`, then `npm run check`. This runs typecheck, then lint, then
   tests with coverage floors.

## Why it is shaped this way

- **One shared `packages/tsconfig.json`** covers every package's `src/` and
  `test/`. `tsc -p packages` type-checks the tests too, and type-aware ESLint
  (`projectService`) finds the program for test files.
- **`erasableSyntaxOnly`** makes `tsc` reject syntax that Node's type stripping
  cannot run (enums, `constructor(readonly x: T)` parameter properties). Without
  it they pass `tsc` and crash at runtime with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`.
- **Per-package `test:coverage` floors** (`--test-coverage-lines/branches/functions=80`)
  fail the package's run when coverage drops below 80%. Raise the floors per package as it matures.
- **Root aggregate scripts** fan out with `--workspaces --if-present`, so a
  package without tests does not break the run.
- **`void test(...)`**: `node:test`'s `test()` returns a promise the runner
  awaits. `void` tells `no-floating-promises` that this is intended.
- Packages import each other by name (`@my-monorepo/example`). The `exports` field
  points at `src/index.ts`, so there is no build step.
