export default {
    collectCoverage: true,
    clearMocks: true,
    coverageDirectory: 'coverage',
    moduleNameMapper: {
        '^@posthog/plugin-utils$': '<rootDir>/../plugin-utils/src',
        '^(\\.{1,2}/.*)\\.js$': '$1',
    },
    silent: true,
    verbose: false,
    watchman: false,
}
