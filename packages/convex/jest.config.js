module.exports = {
  collectCoverage: true,
  clearMocks: true,
  fakeTimers: { enableGlobally: true },
  coverageDirectory: 'coverage',
  silent: true,
  verbose: false,
  extensionsToTreatAsEsm: ['.ts'],
  roots: ['<rootDir>/src', '<rootDir>/../../examples/example-convex/convex'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    // Ensure example integration tests resolve @posthog/convex from the
    // workspace source rather than from the example's tarball node_modules.
    '^@posthog/convex/test$': '<rootDir>/src/test',
    '^@posthog/convex/convex\\.config(\\.js)?$': '<rootDir>/dist/component/convex.config',
    '^@posthog/convex$': '<rootDir>/src/client/index',
  },
  transform: {
    // .ts files: keep ESM imports (modules: false) for jest ESM mode
    '^.+\\.tsx?$': [
      'babel-jest',
      {
        configFile: false,
        presets: [['@babel/preset-env', { targets: { node: '20.0' }, modules: false }], '@babel/preset-typescript'],
        plugins: ['./babel-plugin-import-meta-glob.cjs'],
      },
    ],
    // .js files (e.g. _generated/): convert ESM to CJS
    '^.+\\.js$': [
      'babel-jest',
      {
        configFile: false,
        presets: [['@babel/preset-env', { targets: { node: '20.0' } }]],
      },
    ],
  },
  // src/test.ts is a test helper, not a test suite
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/src/test\\.ts$'],
}
