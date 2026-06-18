// scaffold-linter: js
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// typescript-eslint's helper composes flat configs and registers the TS parser,
// so .ts/.tsx files actually parse instead of erroring on type syntax. Plain
// .js/.mjs/.cjs files fall through to the JS recommended set.
export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
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
);
