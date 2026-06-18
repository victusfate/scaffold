export const registry = {
  js: {
    extensions: ['.js', '.mjs', '.cjs'],
    linter: 'ESLint',
    configFile: 'eslint.config.mjs',
    workflowFile: 'lint-js.yml',
    marker: '// scaffold-linter: js',
    metricsOnly: false,
    // npm packages the shipped config imports — added to the consumer's
    // package.json devDependencies on adopt, so the starter runs locally.
    devDependencies: {
      eslint: '^10.5.0',
      '@eslint/js': '^10.0.1',
      globals: '^17.6.0',
    },
  },
  // TypeScript is its own variant: a type-aware ESLint config that also lints
  // plain JS via fall-through. `ts` supersedes `js` in detection (see detect.mjs)
  // so a repo with both .ts and .js gets one config, not two. Ships a minimal
  // tsconfig.json (extraFiles) so projectService can resolve a TS program.
  ts: {
    extensions: ['.ts', '.tsx'],
    linter: 'ESLint (typescript-eslint)',
    configFile: 'eslint.config.mjs',
    workflowFile: 'lint-ts.yml',
    extraFiles: ['tsconfig.json'],
    marker: '// scaffold-linter: ts',
    metricsOnly: false,
    devDependencies: {
      eslint: '^10.5.0',
      '@eslint/js': '^10.0.1',
      'typescript-eslint': '^8.61.1',
      globals: '^17.6.0',
    },
  },
  python: {
    extensions: ['.py'],
    linter: 'Ruff',
    configFile: 'ruff.toml',
    workflowFile: 'lint-python.yml',
    marker: '# scaffold-linter: python',
    metricsOnly: false,
  },
  go: {
    extensions: ['.go'],
    linter: 'golangci-lint',
    configFile: '.golangci.yml',
    workflowFile: 'lint-go.yml',
    marker: '# scaffold-linter: go',
    metricsOnly: false,
  },
  rust: {
    extensions: ['.rs'],
    linter: 'Clippy',
    configFile: 'clippy.toml',
    workflowFile: 'lint-rust.yml',
    marker: '# scaffold-linter: rust',
    metricsOnly: false,
  },
  ruby: {
    extensions: ['.rb'],
    linter: 'RuboCop',
    configFile: '.rubocop.yml',
    workflowFile: 'lint-ruby.yml',
    marker: '# scaffold-linter: ruby',
    metricsOnly: false,
  },
  shell: {
    extensions: ['.sh', '.bash'],
    linter: 'Shellcheck',
    configFile: '.shellcheckrc',
    workflowFile: 'lint-shell.yml',
    marker: '# scaffold-linter: shell',
    metricsOnly: false,
  },
  elixir: {
    extensions: ['.ex', '.exs'],
    linter: 'Credo',
    configFile: '.credo.exs',
    workflowFile: 'lint-elixir.yml',
    marker: '# scaffold-linter: elixir',
    metricsOnly: false,
  },
  zig: {
    extensions: ['.zig'],
    linter: 'zig fmt',
    workflowFile: 'lint-zig.yml',
    marker: '# scaffold-linter: zig',
    metricsOnly: true,
  },
  mojo: {
    extensions: ['.mojo'],
    linter: 'mojo format',
    workflowFile: 'lint-mojo.yml',
    marker: '# scaffold-linter: mojo',
    metricsOnly: true,
  },
};
