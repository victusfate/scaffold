// scaffold-linter: ts
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const MAX_FILE_LINES = 500;
const MAX_COMPLEXITY = 10;

// Type-aware TypeScript linting. `projectService: true` lets typescript-eslint
// discover this repo's tsconfig.json (shipped alongside this config) and build a
// program per file, so type-checked rules work without a brittle `project` path.
// Plain .js/.mjs/.cjs files fall through to the JS recommended set.
export default tseslint.config(
  {
    ignores: [
      // scaffold-vendored tooling synced into consumer repos — and crucially
      // lib/linters/**, whose template configs would otherwise be discovered as
      // a second eslint root. Drop tools/** if you keep your own code there.
      'lib/linters/**',
      'tools/**',
      '**/*.scaffold-new',
      // Common build output — safe defaults; adjust per repo in the tune step.
      'dist/**',
      'build/**',
      'coverage/**',
      // Repo tune (type-aware linting): standalone TS files outside your
      // tsconfig `include` (e.g. `*.config.ts`, `scripts/**`) aren't in the TS
      // program, so `projectService` errors on them. Ignore the ones your
      // tsconfig doesn't cover. Example — uncomment and adjust to your layout:
      //   '*.config.ts',
      //   '*.config.mts',
      //   'scripts/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      // Node + browser globals so console/process/window aren't flagged no-undef.
      globals: { ...globals.node, ...globals.browser },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // typescript-eslint's parser resolves ambient/global types (Cloudflare
      // Workers, vitest, etc.) differently than tsc, so this rule's autofix
      // strips `as` assertions tsc actually requires — breaking the build on
      // `eslint --fix`. tsc --strict is authoritative; defer to it.
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      // Honor the `_`-prefix convention for intentionally-unused args/vars/catch
      // bindings (e.g. `_ctx`, `_controller` in Worker handler signatures, or
      // `catch (_e)`) — recommended flags these as errors without an escape hatch.
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_',
      }],
      // scaffold quality thresholds — mirror the four-dimension rubric
      'max-lines': ['warn', { max: MAX_FILE_LINES }],
      'max-params': ['warn', 4],
      'complexity': ['warn', MAX_COMPLEXITY],
      'no-magic-numbers': ['warn', { ignore: [0, 1], ignoreArrayIndexes: true }],
    },
  },
  {
    // Type-aware rules need a program; config and JS files aren't in one.
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    // Tests: a literal like `200` in a status assertion or a fixture value is
    // the spec itself, not a hidden constant — naming it adds indirection
    // without insight. Disable no-magic-numbers for test files only.
    files: ['**/*.{test,spec}.{js,mjs,cjs,jsx,ts,tsx,mts,cts}', '**/{test,tests,__tests__}/**'],
    rules: { 'no-magic-numbers': 'off' },
  },
);
