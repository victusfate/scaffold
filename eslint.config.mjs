// Scaffold's own ESLint config — dogfoods the type-aware linter we ship to
// consumers (lib/linters/ts/eslint.config.mjs), so our tooling is held to the
// same bar. Scaffold's source is now TypeScript (.ts, run via Node's native
// type-stripping), so the type-aware `ts` variant is the right fit.
//
// Unlike the shipped template (which ignores tools/**), scaffold *wants* to lint
// its own tools/ and scripts/ — that's the whole point of dogfooding. The root
// tsconfig.json includes exactly those paths so projectService can build a
// program for every linted file.
//
// lib/linters/** is ignored: those are template configs, not source — the JS
// and TS templates are themselves flat-config files that would otherwise be
// discovered as nested configs and confuse ESLint's config resolution.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['lib/linters/**', '**/*.scaffold-new', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Match the shipped template's rubric thresholds (warn — informational).
      'max-lines': ['warn', { max: 500 }],
      'max-params': ['warn', 4],
      'complexity': ['warn', 10],
      'no-magic-numbers': ['warn', { ignore: [0, 1], ignoreArrayIndexes: true }],
      // See lib/linters/ts/eslint.config.mjs — autofix strips assertions tsc needs.
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
    },
  },
  {
    // Config and plain-JS files aren't part of the TS program.
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    ...tseslint.configs.disableTypeChecked,
  },
);
