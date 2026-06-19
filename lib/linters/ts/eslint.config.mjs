// scaffold-linter: ts
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

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
      // scaffold quality thresholds — mirror the four-dimension rubric
      'max-lines': ['warn', { max: 500 }],
      'max-params': ['warn', 4],
      'complexity': ['warn', 10],
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
