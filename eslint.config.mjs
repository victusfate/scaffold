// Scaffold's own ESLint config — dogfoods the plain-JS linter we ship to
// consumers (lib/linters/js/eslint.config.mjs), so our tooling is held to the
// same bar. Scaffold's source is all ESM .mjs, so the JS variant is the right
// fit; the type-aware `ts` variant is for consumer repos with .ts/.tsx sources.
//
// lib/linters/** is ignored: those are template configs, not source — the JS
// and TS templates are themselves flat-config files that would otherwise be
// discovered as nested configs and confuse ESLint's config resolution.
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['lib/linters/**', '**/*.scaffold-new'] },
  js.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      // Match the shipped template's rubric thresholds (warn — informational).
      'max-lines': ['warn', { max: 500 }],
      'max-params': ['warn', 4],
      'complexity': ['warn', 10],
      'no-magic-numbers': ['warn', { ignore: [0, 1], ignoreArrayIndexes: true }],
    },
  },
];
