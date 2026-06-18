// scaffold-linter: js
import js from '@eslint/js';
import globals from 'globals';

// Plain JS/ESM linting — no TypeScript parser. Use the `ts` variant
// (lint-ts.yml + typescript-eslint) for repos with .ts/.tsx sources.
export default [
  js.configs.recommended,
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    // Node + browser globals so console/process/window aren't flagged no-undef.
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      // scaffold quality thresholds — mirror the four-dimension rubric
      'max-lines': ['warn', { max: 500 }],
      'max-params': ['warn', 4],
      'complexity': ['warn', 10],
      'no-magic-numbers': ['warn', { ignore: [0, 1], ignoreArrayIndexes: true }],
    },
  },
];
