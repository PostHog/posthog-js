export default {
    clearMocks: true,
    moduleNameMapper: {
        '^@posthog/plugin-utils$': '<rootDir>/../plugin-utils/src',
        '^(\\.{1,2}/.*)\\.js$': '$1',
    },
    silent: true,
    verbose: false,
    watchman: false,
}
