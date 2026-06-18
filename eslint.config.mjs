// Scaffold's own ESLint config — dogfoods the JS/TS linter we ship to consumers
// (lib/linters/js/eslint.config.mjs), so our tooling is held to the same bar.
//
// lib/linters/** is ignored: those are template configs, not source. The JS
// template there is itself a flat-config file that would otherwise be discovered
// as a nested config and confuse the typescript-eslint parser's root resolution.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['lib/linters/**', '**/*.scaffold-new'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
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
);
