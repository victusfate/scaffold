// scaffold-linter: js
import js from '@eslint/js';
import globals from 'globals';

// Plain JS/ESM linting — no TypeScript parser. Use the `ts` variant
// (lint-ts.yml + typescript-eslint) for repos with .ts/.tsx sources.
export default [
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
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    // Node + browser globals so console/process/window aren't flagged no-undef.
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      // Honor the `_`-prefix convention for intentionally-unused args/vars/catch
      // bindings (e.g. `_ctx`, or `catch (_e)`).
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_',
      }],
      // scaffold quality thresholds — mirror the four-dimension rubric
      'max-lines': ['warn', { max: 500 }],
      'max-params': ['warn', 4],
      'complexity': ['warn', 10],
      'no-magic-numbers': ['warn', { ignore: [0, 1], ignoreArrayIndexes: true }],
    },
  },
  {
    // Tests: a literal like `200` in a status assertion or a fixture value is
    // the spec itself, not a hidden constant — naming it adds indirection
    // without insight. Disable no-magic-numbers for test files only.
    files: ['**/*.{test,spec}.{js,mjs,cjs,jsx,ts,tsx,mts,cts}', '**/{test,tests,__tests__}/**'],
    rules: { 'no-magic-numbers': 'off' },
  },
];
