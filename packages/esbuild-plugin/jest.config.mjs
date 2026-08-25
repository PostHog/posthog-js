export default {
    collectCoverage: true,
    clearMocks: true,
    coverageDirectory: 'coverage',
    moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.js$': '$1',
    },
    silent: true,
    verbose: false,
    watchman: false,
}
